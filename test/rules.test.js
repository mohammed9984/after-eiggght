import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

let app, base;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a8-'));

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b ?? {}), patch: (u, b) => call('PATCH', u, b ?? {}), del: (u) => call('DELETE', u) };
}

before(async () => {
  const cfg = loadConfig({ DATA_DIR: dir, PORT: '0', OWNER_EMAIL: 'owner@after8.test', OWNER_PASSWORD: 'correct-horse-battery', BASE_URL: 'https://menu.after8.test' });
  app = createApp(cfg);
  await new Promise((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const owner = client(), staff = client(), alice = client(), bob = client();
let qrToken, aliceCode;
const key = () => crypto.randomUUID();

test('public menu is read-only, hides unverified prices and empty categories', async () => {
  const anon = client();
  const m = await anon.get('/api/menu');
  assert.equal(m.status, 200);
  const slugs = m.body.categories.map((c) => c.slug);
  assert.ok(!slugs.includes('hot-coffee'), 'empty categories are hidden from customers');
  const matcha = m.body.categories.find((c) => c.slug === 'matcha-corner').items;
  assert.equal(matcha.find((i) => i.name_en === 'Cloud Matcha').price, null);
  assert.equal(matcha.find((i) => i.name_en === 'Hot Matcha Latte').price, 130);
});

test('public menu QR (and any menu request) never awards stamps', async () => {
  const anon = client();
  const before = app.db.prepare('SELECT COUNT(*) n FROM visits').get().n;
  for (const u of ['/', '/?t=5', '/api/menu', '/api/qr/menu?table=5', '/#/club']) await anon.get(u);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM visits').get().n, before);
  const qr = await fetch(base + '/api/qr/menu?table=5');
  assert.match(await qr.text(), /^<svg/);
  const post = await anon.post('/api/staff/stamp', {});
  assert.equal(post.status, 401);
});

test('roles: owner bootstrapped from env, staff created by owner, customer signs up', async () => {
  assert.equal((await owner.post('/api/auth/login', { login: 'owner@after8.test', password: 'wrong' })).status, 401);
  assert.equal((await owner.post('/api/auth/login', { login: 'owner@after8.test', password: 'correct-horse-battery' })).status, 200);
  assert.equal((await owner.post('/api/admin/staff', { name: 'Sara', login: 'sara@after8.test', password: 'staff-pass-12345' })).status, 201);
  assert.equal((await staff.post('/api/auth/login', { login: 'sara@after8.test', password: 'staff-pass-12345' })).status, 200);
  assert.equal((await alice.post('/api/auth/signup', { name: 'Alice', login: '+20 100 000 0001', password: 'alice-pass-1' })).status, 201);
  assert.equal((await bob.post('/api/auth/signup', { name: 'Bob', login: 'bob@x.test', password: 'bob-pass-123' })).status, 201);
  assert.equal((await client().post('/api/auth/signup', { name: 'Dup', login: '01000000001', password: 'whatever-123' })).status, 409, 'phone formats normalise to one account');
});

test('permissions are enforced per role', async () => {
  assert.equal((await alice.post('/api/staff/lookup', { credential: 'x' })).status, 403);
  assert.equal((await alice.get('/api/admin/menu')).status, 403);
  assert.equal((await staff.get('/api/admin/menu')).status, 403);
  assert.equal((await staff.patch('/api/admin/settings', { min_spend_egp: 1 })).status, 403);
  assert.equal((await staff.get('/api/me/card')).status, 403);
  assert.equal((await owner.get('/api/admin/menu')).status, 200);
});

test('customer QR is signed and short-lived; menu QR is rejected by staff lookup', async () => {
  const q = await alice.get('/api/me/qr');
  assert.equal(q.status, 200);
  qrToken = q.body.token; aliceCode = q.body.member_code;
  assert.match(q.body.svg, /^<svg/);
  const bad = await staff.post('/api/staff/lookup', { credential: qrToken.slice(0, -2) + 'xx' });
  assert.equal(bad.status, 422, 'a tampered QR token is rejected');
  assert.equal(bad.body.error.code, 'qr_expired');
  const menuQr = await staff.post('/api/staff/lookup', { credential: 'https://menu.after8.test/?t=3' });
  assert.equal(menuQr.status, 422);
  assert.equal(menuQr.body.error.code, 'not_member_qr');
});

async function lookup(who, cred) { const r = await who.post('/api/staff/lookup', { credential: cred }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; }

test('stamp rules: receipt unique, idempotent retry, cooldown, min spend', async () => {
  await owner.patch('/api/admin/settings', { min_spend_egp: 50, cooldown_minutes: 240 });
  const l = await lookup(staff, qrToken);
  const k = key();
  const first = await staff.post('/api/staff/stamp', { grant: l.grant, amount: 120, receipt_ref: 'r-1001', idem_key: k });
  assert.equal(first.status, 200);
  assert.equal(first.body.card.stamps, 1);
  const retry = await staff.post('/api/staff/stamp', { grant: l.grant, amount: 120, receipt_ref: 'r-1001', idem_key: k });
  assert.equal(retry.status, 200); assert.equal(retry.body.replayed, true); assert.equal(retry.body.card.stamps, 1);
  const dupReceipt = await staff.post('/api/staff/stamp', { grant: l.grant, amount: 120, receipt_ref: 'R-1001', idem_key: key() });
  assert.equal(dupReceipt.body.error.code, 'receipt_used');
  const soon = await staff.post('/api/staff/stamp', { grant: l.grant, amount: 120, receipt_ref: 'R-1002', idem_key: key() });
  assert.equal(soon.body.error.code, 'too_soon');
  await owner.patch('/api/admin/settings', { cooldown_minutes: 0 });
  const low = await staff.post('/api/staff/stamp', { grant: l.grant, amount: 20, receipt_ref: 'R-1003', idem_key: key() });
  assert.equal(low.body.error.code, 'below_min_spend');
});

test('grants are bound to the staff member who looked the customer up', async () => {
  const l = await lookup(staff, aliceCode);
  const other = client();
  await owner.post('/api/admin/staff', { name: 'Omar', login: 'omar@after8.test', password: 'staff-pass-67890' });
  await other.post('/api/auth/login', { login: 'omar@after8.test', password: 'staff-pass-67890' });
  const r = await other.post('/api/staff/stamp', { grant: l.grant, amount: 100, receipt_ref: 'R-2000', idem_key: key() });
  assert.equal(r.status, 401);
});

test('five paid visits unlock exactly one reward; redeem only on a later day, once', async () => {
  for (let i = 2; i <= 5; i++) {
    const l = await lookup(staff, aliceCode);
    const r = await staff.post('/api/staff/stamp', { grant: l.grant, amount: 100 + i, receipt_ref: `R-30${i}`, idem_key: key() });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.card.stamps, i);
  }
  const card = (await alice.get('/api/me/card')).body;
  assert.equal(card.stamps, 5);
  assert.equal(card.reward.status, 'available');
  assert.equal(card.reward.redeemable_now, false, 'same-day redemption is locked');
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM rewards WHERE status='available'").get().n, 1);

  const l = await lookup(staff, aliceCode);
  const sixth = await staff.post('/api/staff/stamp', { grant: l.grant, amount: 100, receipt_ref: 'R-399', idem_key: key() });
  assert.equal(sixth.body.error.code, 'reward_pending', 'a full card collects no more stamps');

  const noItems = await staff.post('/api/staff/redeem', { grant: l.grant, item_id: 1, idem_key: key() });
  assert.equal(noItems.body.error.code, 'reward_not_yet');

  // Owner picks reward items; simulate the next calendar day by back-dating the reward.
  const items = (await owner.get('/api/admin/menu')).body.categories.find((c) => c.slug === 'dessert').items;
  await owner.patch(`/api/admin/items/${items[0].id}`, { reward_eligible: true });
  app.db.prepare('UPDATE rewards SET earned_at = earned_at - 172800000').run();

  const l2 = await lookup(staff, aliceCode);
  assert.equal(l2.reward_items.length, 1);
  const ineligible = await staff.post('/api/staff/redeem', { grant: l2.grant, item_id: items[1].id, idem_key: key() });
  assert.equal(ineligible.body.error.code, 'item_not_eligible');

  const k = key();
  const redeem = await staff.post('/api/staff/redeem', { grant: l2.grant, item_id: items[0].id, idem_key: k });
  assert.equal(redeem.status, 200);
  assert.equal(redeem.body.card.stamps, 0);
  assert.equal(redeem.body.card.reward, null);
  const replay = await staff.post('/api/staff/redeem', { grant: l2.grant, item_id: items[0].id, idem_key: k });
  assert.equal(replay.body.replayed, true);
  const again = await staff.post('/api/staff/redeem', { grant: l2.grant, item_id: items[0].id, idem_key: key() });
  assert.equal(again.body.error.code, 'no_reward', 'a reward can be redeemed only once');
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM rewards WHERE status='redeemed'").get().n, 1);
});

test('concurrent duplicate stamp requests produce a single stamp', async () => {
  const l = await lookup(staff, 'bob@x.test'.length ? (await bob.get('/api/me/qr')).body.token : '');
  const k = key();
  const rs = await Promise.all(Array.from({ length: 6 }, () => staff.post('/api/staff/stamp', { grant: l.grant, amount: 90, receipt_ref: 'R-RACE', idem_key: k })));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM visits WHERE receipt_ref='R-RACE'").get().n, 1);
});

test('owner edits: price needs confirming, availability flows to the public menu', async () => {
  const menu = (await owner.get('/api/admin/menu')).body.categories.find((c) => c.slug === 'food').items;
  const turkey = menu.find((i) => i.name_en === 'Turkey Croissant');
  assert.equal(turkey.price, null);
  assert.equal(turkey.price_status, 'verify');
  const bad = await owner.patch(`/api/admin/items/${turkey.id}`, { price_status: 'confirmed' });
  assert.equal(bad.body.error.code, 'price_required');
  assert.equal((await owner.patch(`/api/admin/items/${turkey.id}`, { price: 170, price_status: 'confirmed', review_note: '' })).status, 200);
  assert.equal((await owner.patch(`/api/admin/items/${turkey.id}`, { available: false })).status, 200);
  const pub = (await client().get('/api/menu')).body.categories.find((c) => c.slug === 'food').items.find((i) => i.id === turkey.id);
  assert.equal(pub.price, 170); assert.equal(pub.available, false);
  assert.equal((await owner.get('/api/admin/audit')).body.log.some((l) => l.action === 'item.update'), true);
});

test('cross-site writes and non-JSON posts are rejected', async () => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(r.status, 403);
  const r2 = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'login=a&password=b' });
  assert.equal(r2.status, 415);
});
