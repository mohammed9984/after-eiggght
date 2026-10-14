import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { openDb, tx, audit } from './db.js';
import { seedIfEmpty } from './seed.js';
import { qrSvg } from './qr.js';
import {
  HttpError, sha256, hashPassword, verifyPassword, makeSigned, verifySigned, newMemberCode, fmtMemberCode,
  normalizeMemberCode, normalizeLogin, rateLimited, cairoDay, str, int, bool,
} from './util.js';

const STAMPS_REQUIRED = 5;                       // fixed by the programme rules
const QR_TTL = 90, GRANT_TTL = 120;              // seconds
const SESSION_TTL = { customer: 30 * 864e5, staff: 12 * 36e5, owner: 12 * 36e5 };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

export function createApp(config) {
  const db = openDb(config.dataDir);
  seedIfEmpty(db);

  // ---- secrets & owner bootstrap -------------------------------------------------
  const getMeta = (k) => db.prepare('SELECT value FROM meta WHERE key=?').get(k)?.value;
  let secret = config.sessionSecret || getMeta('secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('secret', secret);
  }

  const newUser = (role, name, login, password) => {
    let code;
    do { code = newMemberCode(); } while (db.prepare('SELECT 1 FROM users WHERE member_code=?').get(code));
    const pub = crypto.randomUUID();
    const r = db.prepare(`INSERT INTO users (public_id,role,name,login,pass_hash,member_code,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(pub, role, name, login, hashPassword(password), code, Date.now());
    return { id: Number(r.lastInsertRowid), public_id: pub, member_code: code };
  };

  function ensureOwner() {
    if (db.prepare("SELECT 1 FROM users WHERE role='owner'").get()) return;
    const n = normalizeLogin(config.ownerEmail);
    if (!n || n.type !== 'email' || config.ownerPassword.length < 10) return;
    const u = newUser('owner', 'Owner', n.login, config.ownerPassword);
    audit(db, u.id, 'owner.bootstrap', 'user', u.id);
  }
  ensureOwner();
  const ownerConfigured = () => Boolean(db.prepare("SELECT 1 FROM users WHERE role='owner'").get());

  // ---- settings ------------------------------------------------------------------
  const readSettings = () => {
    const o = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map((r) => [r.key, r.value]));
    return {
      stamps_required: STAMPS_REQUIRED,
      min_spend_egp: Number(o.min_spend_egp ?? 0),
      cooldown_minutes: Number(o.cooldown_minutes ?? 240),
      redeem_requires_new_day: o.redeem_requires_new_day === '1',
      tagline: o.tagline ?? '', reward_text_en: o.reward_text_en ?? '', reward_text_ar: o.reward_text_ar ?? '',
    };
  };

  // ---- sessions ------------------------------------------------------------------
  const COOKIE = 'a8s';
  const cookieOf = (req) => (req.headers.cookie || '').split(/;\s*/).map((p) => p.split('=')).find(([k]) => k === COOKIE)?.[1];
  const setCookie = (res, token, maxAgeSec) =>
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${config.secureCookies ? '; Secure' : ''}`);
  function startSession(res, user) {
    const token = crypto.randomBytes(32).toString('base64url');
    const ttl = SESSION_TTL[user.role];
    db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(sha256(token), user.id, Date.now() + ttl, Date.now());
    setCookie(res, token, Math.floor(ttl / 1000));
  }
  function userFromReq(req) {
    const t = cookieOf(req);
    if (!t) return null;
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(sha256(t), Date.now());
    return row || null;
  }
  const publicUser = (u) => ({ id: u.public_id, name: u.name, role: u.role, login: u.login });

  // ---- loyalty core (all rules live here, on the server) ---------------------------
  function cardState(user) {
    const stamps = db.prepare('SELECT COUNT(*) AS n FROM visits WHERE user_id=? AND cycle=?').get(user.id, user.cycle).n;
    const reward = db.prepare(`SELECT * FROM rewards WHERE user_id=? AND status='available'`).get(user.id);
    const s = readSettings();
    let rewardOut = null;
    if (reward) {
      const sameDay = cairoDay(Date.now()) <= cairoDay(reward.earned_at);
      const lockedToday = s.redeem_requires_new_day && sameDay;
      rewardOut = { status: 'available', earned_at: reward.earned_at, redeemable_now: !lockedToday, text_en: s.reward_text_en, text_ar: s.reward_text_ar };
    }
    const redeemed = db.prepare(`SELECT COUNT(*) AS n FROM rewards WHERE user_id=? AND status='redeemed'`).get(user.id).n;
    return { stamps: Math.min(stamps, STAMPS_REQUIRED), required: STAMPS_REQUIRED, card_number: user.cycle, reward: rewardOut, rewards_redeemed: redeemed };
  }

  function awardStamp(staff, customer, { amount, receipt, idem }) {
    const s = readSettings();
    return tx(db, () => {
      const prior = db.prepare('SELECT * FROM visits WHERE idem_key=?').get(idem);
      if (prior) {
        if (prior.user_id !== customer.id) throw new HttpError(409, 'idem_conflict', 'That request key was already used for another customer.');
        return { replayed: true, card: cardState(db.prepare('SELECT * FROM users WHERE id=?').get(customer.id)) };
      }
      const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(customer.id);
      if (!fresh.active || fresh.role !== 'customer') throw new HttpError(409, 'not_customer', 'This account cannot collect stamps.');
      if (db.prepare(`SELECT 1 FROM rewards WHERE user_id=? AND status='available'`).get(fresh.id))
        throw new HttpError(409, 'reward_pending', 'This card is full. Redeem the reward before adding more stamps.');
      if (amount <= 0 || amount < s.min_spend_egp)
        throw new HttpError(422, 'below_min_spend', `The bill must be at least ${Math.max(1, s.min_spend_egp)} EGP to earn a stamp.`);
      if (db.prepare('SELECT 1 FROM visits WHERE receipt_ref=?').get(receipt))
        throw new HttpError(409, 'receipt_used', 'This receipt number has already been used for a stamp.');
      const last = db.prepare('SELECT MAX(created_at) AS t FROM visits WHERE user_id=?').get(fresh.id).t;
      const waitMs = s.cooldown_minutes * 60000 - (Date.now() - (last || 0));
      if (last && waitMs > 0)
        throw new HttpError(409, 'too_soon', `A stamp was already added recently. Try again in ${Math.ceil(waitMs / 60000)} min.`, { wait_minutes: Math.ceil(waitMs / 60000) });
      const v = db.prepare(`INSERT INTO visits (user_id,staff_id,cycle,amount_egp,receipt_ref,idem_key,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(fresh.id, staff.id, fresh.cycle, amount, receipt, idem, Date.now());
      const n = db.prepare('SELECT COUNT(*) AS n FROM visits WHERE user_id=? AND cycle=?').get(fresh.id, fresh.cycle).n;
      if (n >= STAMPS_REQUIRED)
        db.prepare(`INSERT INTO rewards (user_id,cycle,status,earned_at,earned_visit_id) VALUES (?,?,'available',?,?)`)
          .run(fresh.id, fresh.cycle, Date.now(), v.lastInsertRowid);
      audit(db, staff.id, 'stamp.add', 'user', fresh.public_id, { amount, receipt, stamps: n });
      return { replayed: false, card: cardState(fresh) };
    });
  }

  function redeemReward(staff, customer, { itemId, idem }) {
    const s = readSettings();
    return tx(db, () => {
      const prior = db.prepare('SELECT * FROM rewards WHERE redeem_idem_key=?').get(idem);
      if (prior) {
        if (prior.user_id !== customer.id) throw new HttpError(409, 'idem_conflict', 'That request key was already used for another customer.');
        return { replayed: true, item: prior.redeemed_item_name, card: cardState(db.prepare('SELECT * FROM users WHERE id=?').get(customer.id)) };
      }
      const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(customer.id);
      const rw = db.prepare(`SELECT * FROM rewards WHERE user_id=? AND status='available'`).get(fresh.id);
      if (!rw) throw new HttpError(409, 'no_reward', 'There is no unredeemed reward on this card.');
      if (s.redeem_requires_new_day && cairoDay(Date.now()) <= cairoDay(rw.earned_at))
        throw new HttpError(409, 'reward_not_yet', 'The reward was earned today. It can be redeemed on the next visit.');
      const item = db.prepare('SELECT * FROM items WHERE id=? AND available=1 AND reward_eligible=1').get(itemId);
      if (!item) throw new HttpError(422, 'item_not_eligible', 'Choose an available, reward-eligible item.');
      const r = db.prepare(`UPDATE rewards SET status='redeemed', redeemed_at=?, redeemed_by=?, redeemed_item_id=?, redeemed_item_name=?, redeem_idem_key=?
        WHERE id=? AND status='available'`).run(Date.now(), staff.id, item.id, item.name_en, idem, rw.id);
      if (r.changes !== 1) throw new HttpError(409, 'no_reward', 'This reward was already redeemed.');
      db.prepare('UPDATE users SET cycle=cycle+1 WHERE id=?').run(fresh.id);
      audit(db, staff.id, 'reward.redeem', 'user', fresh.public_id, { item: item.name_en });
      return { replayed: false, item: item.name_en, card: cardState(db.prepare('SELECT * FROM users WHERE id=?').get(fresh.id)) };
    });
  }

  // ---- menu helpers ----------------------------------------------------------------
  const mapItem = (r, admin) => ({
    id: r.id, category_id: r.category_id, name_en: r.name_en, name_ar: r.name_ar, desc_en: r.desc_en, desc_ar: r.desc_ar,
    price: admin ? r.price : (r.price_status === 'confirmed' ? r.price : null),
    available: !!r.available, is_new: !!r.is_new,
    ...(admin ? { price_status: r.price_status, review_note: r.review_note, ar_reviewed: !!r.ar_reviewed, reward_eligible: !!r.reward_eligible, sort: r.sort } : {}),
  });
  function publicMenu() {
    const cats = db.prepare('SELECT * FROM categories WHERE visible=1 ORDER BY sort,id').all();
    const items = db.prepare('SELECT * FROM items ORDER BY sort,id').all();
    return {
      currency: 'EGP', tagline: readSettings().tagline,
      categories: cats.map((c) => ({ id: c.id, slug: c.slug, name_en: c.name_en, name_ar: c.name_ar,
        items: items.filter((i) => i.category_id === c.id).map((i) => mapItem(i, false)) })).filter((c) => c.items.length),
    };
  }
  function adminMenu() {
    const cats = db.prepare('SELECT * FROM categories ORDER BY sort,id').all();
    const items = db.prepare('SELECT * FROM items ORDER BY sort,id').all();
    return { categories: cats.map((c) => ({ id: c.id, slug: c.slug, name_en: c.name_en, name_ar: c.name_ar, note: c.note, visible: !!c.visible,
      ar_reviewed: !!c.ar_reviewed, sort: c.sort, items: items.filter((i) => i.category_id === c.id).map((i) => mapItem(i, true)) })) };
  }

  function itemFields(b, existing = {}) {
    const m = { ...existing };
    if ('name_en' in b) m.name_en = str(b.name_en, { name: 'English name', required: true, max: 120 });
    if ('name_ar' in b) m.name_ar = str(b.name_ar, { name: 'Arabic name', max: 120 });
    if ('desc_en' in b) m.desc_en = str(b.desc_en, { name: 'English description', max: 400 });
    if ('desc_ar' in b) m.desc_ar = str(b.desc_ar, { name: 'Arabic description', max: 400 });
    if ('price' in b) m.price = int(b.price, { name: 'Price', min: 0, max: 100000, nullable: true });
    if ('review_note' in b) m.review_note = str(b.review_note, { name: 'Review note', max: 500 });
    for (const k of ['available', 'reward_eligible', 'is_new', 'ar_reviewed']) if (k in b) m[k] = bool(b[k]);
    if ('sort' in b) m.sort = int(b.sort, { name: 'Sort', min: 0, max: 100000 });
    if ('price_status' in b) {
      if (!['confirmed', 'verify'].includes(b.price_status)) throw new HttpError(400, 'invalid', 'Invalid price status');
      m.price_status = b.price_status;
    }
    if ('category_id' in b) {
      m.category_id = int(b.category_id, { name: 'Category' });
      if (!db.prepare('SELECT 1 FROM categories WHERE id=?').get(m.category_id)) throw new HttpError(400, 'invalid', 'Unknown category');
    }
    if (m.price == null) {
      // Never silently downgrade an explicit "confirmed" request: that would hide the owner's mistake.
      if (b.price_status === 'confirmed') throw new HttpError(422, 'price_required', 'Enter a price before marking it confirmed.');
      m.price_status = 'verify';
    }
    return m;
  }

  // ---- routes ----------------------------------------------------------------------
  const routes = [];
  const route = (method, p, roles, fn) => {
    const keys = [];
    const re = new RegExp('^' + p.replace(/:([a-z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, roles, fn });
  };
  const ok = (data = {}) => ({ status: 200, body: data });

  route('GET', '/api/status', null, () => {
    const warnings = [];
    if (!ownerConfigured()) warnings.push('owner_missing');
    if (!config.baseUrlConfigured) warnings.push('base_url_missing');
    if (!config.secureCookies) warnings.push('insecure_cookies');
    return ok({ ok: true, base_url: config.baseUrl, owner_configured: ownerConfigured(), base_url_configured: config.baseUrlConfigured, secure_cookies: config.secureCookies, warnings });
  });
  route('GET', '/api/menu', null, () => ({ status: 200, body: publicMenu(), headers: { 'Cache-Control': 'public, max-age=30' } }));
  route('GET', '/api/qr/menu', null, ({ url }) => {
    const t = url.searchParams.get('table');
    const table = t && /^\d{1,3}$/.test(t) ? `?t=${t}` : '';
    return { status: 200, raw: qrSvg(`${config.baseUrl}/${table}`), type: 'image/svg+xml', headers: { 'Cache-Control': 'public, max-age=3600' } };
  });

  // auth
  route('POST', '/api/auth/signup', null, ({ req, body, res }) => {
    if (rateLimited('signup:' + req.socket.remoteAddress, 8, 600000)) throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again later.');
    const name = str(body.name, { name: 'Name', required: true, max: 80 });
    const n = normalizeLogin(body.login);
    if (!n) throw new HttpError(400, 'bad_login', 'Enter a valid email address or mobile number.');
    const pw = str(body.password, { name: 'Password', required: true, max: 200 });
    if (pw.length < 8) throw new HttpError(400, 'weak_password', 'Password must be at least 8 characters.');
    if (db.prepare('SELECT 1 FROM users WHERE login=?').get(n.login)) throw new HttpError(409, 'exists', 'An account with this email or number already exists.');
    const u = newUser('customer', name, n.login, pw);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
    startSession(res, user);
    return { status: 201, body: { user: publicUser(user) } };
  });
  route('POST', '/api/auth/login', null, ({ req, body, res }) => {
    if (rateLimited('login:' + req.socket.remoteAddress, 12, 600000)) throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again later.');
    const n = normalizeLogin(body.login);
    const user = n && db.prepare('SELECT * FROM users WHERE login=?').get(n.login);
    const pw = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
    const good = user ? verifyPassword(pw, user.pass_hash) : (verifyPassword(pw, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86)), false);
    if (!user || !good || !user.active) throw new HttpError(401, 'bad_credentials', 'Incorrect email/number or password.');
    startSession(res, user);
    return ok({ user: publicUser(user) });
  });
  route('POST', '/api/auth/logout', null, ({ req, res }) => {
    const t = cookieOf(req);
    if (t) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(t));
    setCookie(res, '', 0);
    return ok();
  });
  route('GET', '/api/me', null, ({ user }) => ok({ user: user ? publicUser(user) : null }));

  // customer
  route('GET', '/api/me/card', ['customer'], ({ user }) => {
    const history = db.prepare('SELECT created_at, cycle FROM visits WHERE user_id=? ORDER BY id DESC LIMIT 12').all(user.id);
    const rewards = db.prepare(`SELECT status, earned_at, redeemed_at, redeemed_item_name FROM rewards WHERE user_id=? ORDER BY id DESC LIMIT 5`).all(user.id);
    return ok({ ...cardState(user), name: user.name, member_code: fmtMemberCode(user.member_code), history, rewards });
  });
  route('GET', '/api/me/qr', ['customer'], ({ user }) => {
    const token = makeSigned(secret, 'A8T1', [user.public_id], QR_TTL);
    return { status: 200, body: { token, svg: qrSvg(token, { ecc: 'M' }), expires_in: QR_TTL, member_code: fmtMemberCode(user.member_code) }, headers: { 'Cache-Control': 'no-store' } };
  });

  // staff
  const grantFor = (staff, customer) => makeSigned(secret, 'A8G1', [customer.public_id, String(staff.id)], GRANT_TTL);
  function customerFromGrant(staff, grant) {
    const v = verifySigned(secret, 'A8G1', grant);
    if (!v || v.parts[1] !== String(staff.id)) throw new HttpError(401, 'grant_expired', 'Scan or enter the customer code again.');
    const c = db.prepare("SELECT * FROM users WHERE public_id=? AND role='customer' AND active=1").get(v.parts[0]);
    if (!c) throw new HttpError(404, 'not_found', 'Customer not found.');
    return c;
  }
  route('POST', '/api/staff/lookup', ['staff', 'owner'], ({ user, body }) => {
    if (rateLimited('lookup:' + user.id, 40, 60000)) throw new HttpError(429, 'rate_limited', 'Too many lookups. Wait a minute.');
    const cred = str(body.credential, { name: 'Code', required: true, max: 300 });
    let customer = null;
    if (cred.startsWith('A8T1.')) {
      const v = verifySigned(secret, 'A8T1', cred);
      if (!v) throw new HttpError(422, 'qr_expired', 'This QR code has expired. Ask the customer to reopen their card.');
      customer = db.prepare("SELECT * FROM users WHERE public_id=? AND role='customer' AND active=1").get(v.parts[0]);
    } else {
      if (/^https?:\/\//i.test(cred)) throw new HttpError(422, 'not_member_qr', 'That is the public menu QR. It never awards stamps. Scan the customer’s AFTER 8 CLUB QR.');
      const code = normalizeMemberCode(cred);
      if (code) customer = db.prepare("SELECT * FROM users WHERE member_code=? AND role='customer' AND active=1").get(code);
    }
    if (!customer) throw new HttpError(404, 'not_found', 'No customer matches that code.');
    const card = cardState(customer);
    const items = card.reward ? db.prepare('SELECT id,name_en,name_ar FROM items WHERE available=1 AND reward_eligible=1 ORDER BY sort,id').all() : [];
    const s = readSettings();
    return ok({ grant: grantFor(user, customer), customer: { name: customer.name, member_code: fmtMemberCode(customer.member_code) }, card,
      reward_items: items, rules: { min_spend_egp: s.min_spend_egp, cooldown_minutes: s.cooldown_minutes } });
  });
  route('POST', '/api/staff/stamp', ['staff', 'owner'], ({ user, body }) => {
    const customer = customerFromGrant(user, body.grant);
    const amount = int(body.amount, { name: 'Bill amount', min: 1, max: 100000 });
    const receipt = str(body.receipt_ref, { name: 'Receipt number', required: true, max: 40 }).toUpperCase();
    const idem = str(body.idem_key, { name: 'Request key', required: true, max: 80 });
    return ok(awardStamp(user, customer, { amount, receipt, idem }));
  });
  route('POST', '/api/staff/redeem', ['staff', 'owner'], ({ user, body }) => {
    const customer = customerFromGrant(user, body.grant);
    return ok(redeemReward(user, customer, { itemId: int(body.item_id, { name: 'Item' }), idem: str(body.idem_key, { name: 'Request key', required: true, max: 80 }) }));
  });
  route('GET', '/api/staff/recent', ['staff', 'owner'], ({ user }) => {
    const rows = db.prepare(`SELECT a.action, a.at, a.detail, u.name FROM audit_log a LEFT JOIN users u ON u.public_id=a.entity_id
      WHERE a.actor_id=? AND a.action IN ('stamp.add','reward.redeem') ORDER BY a.id DESC LIMIT 15`).all(user.id);
    return ok({ recent: rows.map((r) => ({ action: r.action, at: r.at, customer: r.name, detail: JSON.parse(r.detail) })) });
  });

  // owner: menu
  route('GET', '/api/admin/menu', ['owner'], () => ok(adminMenu()));
  route('POST', '/api/admin/categories', ['owner'], ({ user, body }) => {
    const en = str(body.name_en, { name: 'English name', required: true, max: 80 });
    const slug = en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';
    let s = slug, i = 2;
    while (db.prepare('SELECT 1 FROM categories WHERE slug=?').get(s)) s = `${slug}-${i++}`;
    const sort = (db.prepare('SELECT MAX(sort) AS m FROM categories').get().m ?? -1) + 1;
    const id = db.prepare('INSERT INTO categories (slug,name_en,name_ar,sort) VALUES (?,?,?,?)').run(s, en, str(body.name_ar, { name: 'Arabic name', max: 80 }), sort).lastInsertRowid;
    audit(db, user.id, 'category.create', 'category', id, { en });
    return { status: 201, body: { id: Number(id) } };
  });
  route('PATCH', '/api/admin/categories/:id', ['owner'], ({ user, body, params }) => {
    const c = db.prepare('SELECT * FROM categories WHERE id=?').get(params.id);
    if (!c) throw new HttpError(404, 'not_found', 'Category not found');
    const m = { name_en: c.name_en, name_ar: c.name_ar, note: c.note, visible: c.visible, ar_reviewed: c.ar_reviewed, sort: c.sort };
    if ('name_en' in body) m.name_en = str(body.name_en, { name: 'English name', required: true, max: 80 });
    if ('name_ar' in body) m.name_ar = str(body.name_ar, { name: 'Arabic name', max: 80 });
    if ('note' in body) m.note = str(body.note, { name: 'Note', max: 500 });
    if ('visible' in body) m.visible = bool(body.visible);
    if ('ar_reviewed' in body) m.ar_reviewed = bool(body.ar_reviewed);
    if ('sort' in body) m.sort = int(body.sort, { name: 'Sort', max: 10000 });
    db.prepare('UPDATE categories SET name_en=?,name_ar=?,note=?,visible=?,ar_reviewed=?,sort=? WHERE id=?').run(m.name_en, m.name_ar, m.note, m.visible, m.ar_reviewed, m.sort, c.id);
    audit(db, user.id, 'category.update', 'category', c.id, body);
    return ok();
  });
  route('DELETE', '/api/admin/categories/:id', ['owner'], ({ user, params }) => {
    if (db.prepare('SELECT 1 FROM items WHERE category_id=?').get(params.id)) throw new HttpError(409, 'not_empty', 'Move or delete this category’s items first.');
    db.prepare('DELETE FROM categories WHERE id=?').run(params.id);
    audit(db, user.id, 'category.delete', 'category', params.id);
    return ok();
  });
  route('POST', '/api/admin/items', ['owner'], ({ user, body }) => {
    const m = itemFields({ price: null, ...body });
    if (!m.category_id) throw new HttpError(400, 'invalid', 'Category is required');
    const sort = (db.prepare('SELECT MAX(sort) AS m FROM items WHERE category_id=?').get(m.category_id).m ?? -1) + 1;
    const id = db.prepare(`INSERT INTO items (category_id,name_en,name_ar,desc_en,desc_ar,price,price_status,review_note,ar_reviewed,available,reward_eligible,is_new,sort,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(m.category_id, m.name_en, m.name_ar ?? '', m.desc_en ?? '', m.desc_ar ?? '', m.price, m.price_status ?? 'verify',
      m.review_note ?? '', m.ar_reviewed ?? 0, m.available ?? 1, m.reward_eligible ?? 0, m.is_new ?? 0, sort, Date.now()).lastInsertRowid;
    audit(db, user.id, 'item.create', 'item', id, { name: m.name_en, price: m.price });
    return { status: 201, body: { id: Number(id) } };
  });
  route('PATCH', '/api/admin/items/:id', ['owner'], ({ user, body, params }) => {
    const it = db.prepare('SELECT * FROM items WHERE id=?').get(params.id);
    if (!it) throw new HttpError(404, 'not_found', 'Item not found');
    const m = itemFields(body, it);
    db.prepare(`UPDATE items SET category_id=?,name_en=?,name_ar=?,desc_en=?,desc_ar=?,price=?,price_status=?,review_note=?,ar_reviewed=?,available=?,reward_eligible=?,is_new=?,sort=?,updated_at=? WHERE id=?`)
      .run(m.category_id, m.name_en, m.name_ar, m.desc_en, m.desc_ar, m.price, m.price_status, m.review_note, m.ar_reviewed, m.available, m.reward_eligible, m.is_new, m.sort, Date.now(), it.id);
    audit(db, user.id, 'item.update', 'item', it.id, { changed: Object.keys(body), name: m.name_en, price: m.price });
    return ok();
  });
  route('DELETE', '/api/admin/items/:id', ['owner'], ({ user, params }) => {
    db.prepare('DELETE FROM items WHERE id=?').run(params.id);
    audit(db, user.id, 'item.delete', 'item', params.id);
    return ok();
  });

  // owner: settings, users, stats, audit
  route('GET', '/api/admin/settings', ['owner'], () => ok(readSettings()));
  route('PATCH', '/api/admin/settings', ['owner'], ({ user, body }) => {
    const set = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    if ('min_spend_egp' in body) set.run('min_spend_egp', String(int(body.min_spend_egp, { name: 'Minimum spend', max: 10000 })));
    if ('cooldown_minutes' in body) set.run('cooldown_minutes', String(int(body.cooldown_minutes, { name: 'Cooldown', max: 1440 })));
    if ('redeem_requires_new_day' in body) set.run('redeem_requires_new_day', String(bool(body.redeem_requires_new_day)));
    for (const k of ['tagline', 'reward_text_en', 'reward_text_ar']) if (k in body) set.run(k, str(body[k], { name: k, max: 160 }));
    audit(db, user.id, 'settings.update', 'settings', null, body);
    return ok(readSettings());
  });
  route('GET', '/api/admin/users', ['owner'], ({ url }) => {
    const role = url.searchParams.get('role') === 'staff' ? 'staff' : 'customer';
    const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 60);
    const rows = db.prepare(`SELECT id,public_id,name,login,role,active,member_code,created_at FROM users WHERE role IN (${role === 'staff' ? "'staff'" : "'customer'"})
      AND (?='' OR lower(name) LIKE ? OR login LIKE ? OR member_code LIKE ?) ORDER BY id DESC LIMIT 50`).all(q, `%${q}%`, `%${q}%`, `%${q.toUpperCase().replace(/[^A-Z0-9]/g, '')}%`);
    return ok({ users: rows.map((r) => ({ id: r.id, name: r.name, login: r.login, active: !!r.active, member_code: fmtMemberCode(r.member_code), created_at: r.created_at })) });
  });
  route('POST', '/api/admin/staff', ['owner'], ({ user, body }) => {
    const n = normalizeLogin(body.login);
    if (!n) throw new HttpError(400, 'bad_login', 'Enter a valid email or mobile number.');
    const pw = str(body.password, { name: 'Password', required: true, max: 200 });
    if (pw.length < 10) throw new HttpError(400, 'weak_password', 'Staff passwords must be at least 10 characters.');
    if (db.prepare('SELECT 1 FROM users WHERE login=?').get(n.login)) throw new HttpError(409, 'exists', 'That login is already in use.');
    const u = newUser('staff', str(body.name, { name: 'Name', required: true, max: 80 }), n.login, pw);
    audit(db, user.id, 'staff.create', 'user', u.public_id, { login: n.login });
    return { status: 201, body: { id: u.id } };
  });
  route('PATCH', '/api/admin/users/:id', ['owner'], ({ user, body, params }) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(params.id);
    if (!u || u.role === 'owner') throw new HttpError(404, 'not_found', 'User not found');
    if ('active' in body) {
      db.prepare('UPDATE users SET active=? WHERE id=?').run(bool(body.active), u.id);
      if (!bool(body.active)) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    }
    let temp = null;
    if (body.reset_password) {
      temp = crypto.randomBytes(9).toString('base64url');
      db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hashPassword(temp), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    }
    audit(db, user.id, 'user.update', 'user', u.public_id, { active: body.active, reset_password: !!body.reset_password });
    return ok(temp ? { temp_password: temp } : {});
  });
  route('GET', '/api/admin/stats', ['owner'], () => {
    const today = cairoDay(Date.now());
    const visits = db.prepare('SELECT created_at FROM visits').all();
    return ok({
      customers: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='customer'").get().n,
      stamps_total: visits.length,
      stamps_today: visits.filter((v) => cairoDay(v.created_at) === today).length,
      rewards_available: db.prepare("SELECT COUNT(*) AS n FROM rewards WHERE status='available'").get().n,
      rewards_redeemed: db.prepare("SELECT COUNT(*) AS n FROM rewards WHERE status='redeemed'").get().n,
      reward_items: db.prepare('SELECT COUNT(*) AS n FROM items WHERE available=1 AND reward_eligible=1').get().n,
    });
  });
  route('GET', '/api/admin/audit', ['owner'], () => {
    const rows = db.prepare(`SELECT a.id,a.action,a.entity,a.entity_id,a.detail,a.at,u.name AS actor FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 80`).all();
    return ok({ log: rows.map((r) => ({ ...r, detail: JSON.parse(r.detail) })) });
  });

  // ---- http plumbing ----------------------------------------------------------------
  const SEC = {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  };
  const gzCache = new Map();
  function send(req, res, status, buf, type, extra = {}) {
    const h = { ...SEC, 'Content-Type': type, ...extra };
    const wantsGz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && buf.length > 1024 && /text|json|javascript|svg/.test(type);
    if (wantsGz) { h['Content-Encoding'] = 'gzip'; h['Vary'] = 'Accept-Encoding'; buf = zlib.gzipSync(buf); }
    h['Content-Length'] = buf.length;
    res.writeHead(status, h);
    res.end(req.method === 'HEAD' ? undefined : buf);
  }
  const sendJson = (req, res, status, obj, extra) => send(req, res, status, Buffer.from(JSON.stringify(obj)), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', ...extra });

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > 100_000) { reject(new HttpError(413, 'too_large', 'Request too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(j && typeof j === 'object' && !Array.isArray(j) ? j : {}); }
        catch { reject(new HttpError(400, 'bad_json', 'Invalid JSON')); }
      });
      req.on('error', reject);
    });
  }

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.join(config.publicDir, path.normalize(rel));
    if (!file.startsWith(config.publicDir + path.sep)) return sendJson(req, res, 403, { error: { code: 'forbidden', message: 'Forbidden' } });
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return sendJson(req, res, 404, { error: { code: 'not_found', message: 'Not found' } });
      const type = MIME[path.extname(file)] || 'application/octet-stream';
      const etag = `"${st.size}-${Math.floor(st.mtimeMs)}"`;
      const cache = rel === '/index.html' ? 'no-cache' : 'public, max-age=3600';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ...SEC, ETag: etag, 'Cache-Control': cache }); return res.end(); }
      fs.readFile(file, (e2, buf) => (e2 ? sendJson(req, res, 500, { error: { code: 'io', message: 'Read error' } }) : send(req, res, 200, buf, type, { ETag: etag, 'Cache-Control': cache })));
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (!url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) return sendJson(req, res, 405, { error: { code: 'method', message: 'Method not allowed' } });
        return serveStatic(req, res, url.pathname);
      }
      const r = routes.map((rt) => ({ rt, m: rt.method === req.method && url.pathname.match(rt.re) })).find((x) => x.m);
      if (!r) return sendJson(req, res, 404, { error: { code: 'not_found', message: 'Not found' } });
      const params = Object.fromEntries(r.rt.keys.map((k, i) => [k, r.m[i + 1]]));
      let body = {};
      if (req.method !== 'GET') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'bad_origin', 'Cross-site request blocked');
        if (!/^application\/json/i.test(req.headers['content-type'] || '') && Number(req.headers['content-length'] || 0) > 0)
          throw new HttpError(415, 'content_type', 'Send JSON');
        body = await readBody(req);
      }
      const user = userFromReq(req);
      if (r.rt.roles) {
        if (!user) throw new HttpError(401, 'auth_required', 'Please sign in.');
        if (!r.rt.roles.includes(user.role)) throw new HttpError(403, 'forbidden', 'You do not have permission to do that.');
      }
      const out = await r.rt.fn({ req, res, url, body, params, user });
      if (out.raw !== undefined) return send(req, res, out.status, Buffer.from(out.raw), out.type, out.headers);
      return sendJson(req, res, out.status, out.body, out.headers);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(req, res, e.status, { error: { code: e.code, message: e.message, ...(e.extra || {}) } });
      if (e && /UNIQUE constraint/.test(e.message)) return sendJson(req, res, 409, { error: { code: 'conflict', message: 'That value is already in use.' } });
      console.error(e);
      return sendJson(req, res, 500, { error: { code: 'server', message: 'Something went wrong on the server.' } });
    }
  });

  // expired sessions housekeeping
  const sweep = setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now()), 3600_000);
  sweep.unref();

  return { server, db, close: () => new Promise((r) => { clearInterval(sweep); server.close(() => { db.close(); r(); }); server.closeAllConnections?.(); }) };
}
