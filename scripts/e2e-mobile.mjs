// Real-browser walkthrough at phone size. Needs the server running (BASE) and Playwright installed.
// Usage: BASE=http://localhost:3100 DATA_DB=/tmp/a8-preview/after8.db node scripts/e2e-mobile.mjs
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const req = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = req('playwright')); } catch { ({ chromium } = createRequire('/home/claude/.npm-global/lib/node_modules/')('playwright')); }

const BASE = process.env.BASE || 'http://localhost:3100';
const DB = process.env.DATA_DB || '/tmp/a8-preview/after8.db';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const OWNER = { login: 'owner@after8.test', password: 'preview-owner-pass-1' };
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); };

async function apiClient() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
}
const browser = await chromium.launch();
const mk = () => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB' });
const problems = [];
const watch = (page, tag) => {
  page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 422|fonts\.(googleapis|gstatic)|ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION)|storefront\.jpg|favicon|404/.test(m.text())) problems.push(`${tag} console: ${m.text()}`); });
};
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const a11y = (page) => page.evaluate(() => {
  const bad = [];
  document.querySelectorAll('img').forEach((i) => { if (!i.hasAttribute('alt')) bad.push('img without alt'); });
  document.querySelectorAll('input:not([type=hidden]),select,textarea').forEach((el) => { const ok = el.getAttribute('aria-label') || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label'); if (!ok) bad.push(`unlabelled ${el.tagName} ${el.name || ''}`); });
  document.querySelectorAll('button,a').forEach((el) => { if (!(el.textContent.trim() || el.getAttribute('aria-label'))) bad.push('unnamed ' + el.tagName); });
  const small = [...document.querySelectorAll('button,a.btn,.chip,.pill,input:not([type=checkbox]):not([type=radio])')].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.height && (r.height < 43.5); }).map((e) => e.textContent.trim().slice(0, 20) || e.tagName);
  return { bad, small };
});

// ---------- set-up through the API (owner configures reward items, rules) ----------
const owner = await apiClient();
await owner('POST', '/api/auth/login', OWNER);
await owner('POST', '/api/admin/staff', { name: 'Sara', login: 'sara@after8.test', password: 'staff-pass-12345' });
await owner('PATCH', '/api/admin/settings', { min_spend_egp: 50, cooldown_minutes: 0 });
const menuAdmin = (await owner('GET', '/api/admin/menu')).body.categories;
const desserts = menuAdmin.find((c) => c.slug === 'dessert').items;
await owner('PATCH', `/api/admin/items/${desserts[0].id}`, { reward_eligible: true });
await owner('PATCH', `/api/admin/items/${desserts[4].id}`, { reward_eligible: true });

// ---------- 1. public menu ----------
{
  const ctx = await mk(); const page = await ctx.newPage(); watch(page, 'menu');
  await page.goto(BASE + '/?t=7'); await page.waitForSelector('.cat');
  check('menu: categories render (hides empty page-1 categories)', (await page.locator('.cat').count()) === 11, `${await page.locator('.cat').count()} categories`);
  check('menu: table number from QR shown', (await page.locator('.table-pill').textContent()).includes('7'));
  check('menu: no horizontal scroll at 390px', await noHScroll(page));
  check('menu: AFTER 8 CLUB link prominent in hero area', await page.locator('.club-banner').isVisible());
  check('menu: unverified prices show "Ask at the counter"', (await page.locator('.item:has-text("Cloud Matcha") .ask').count()) === 1);
  await page.waitForTimeout(1300); await page.screenshot({ path: OUT + '01-menu-top-en.png' });
  await page.getByRole('button', { name: 'Mojito' }).click(); await page.waitForTimeout(900);
  const y = await page.evaluate(() => document.querySelector('#cat-mojito').getBoundingClientRect().top);
  check('menu: category chip scrolls to its section', y < 200 && y > 0, `top=${Math.round(y)}`);
  await page.screenshot({ path: OUT + '02-menu-mojito-en.png' });
  await page.screenshot({ path: OUT + '03-menu-full-en.png', fullPage: true });
  const aa = await a11y(page); check('menu: a11y basics (alt text, labels, names)', aa.bad.length === 0, aa.bad.join('; '));
  check('menu: touch targets >= 44px', aa.small.length === 0, aa.small.join(', '));
  await page.getByRole('button', { name: 'العربية' }).click(); await page.waitForSelector('html[dir=rtl]');
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
  check('menu: Arabic switches to RTL, Arabic names + currency', (await page.locator('.item').first().textContent()).includes('باشن') && (await page.locator('.price .cur').first().textContent()) === 'ج.م');
  check('menu (ar): no horizontal scroll', await noHScroll(page));
  await page.screenshot({ path: OUT + '04-menu-top-ar.png' });
  await page.locator('#cat-matcha-corner').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '05-menu-matcha-ar.png' });
  await ctx.close();
}

// ---------- 2. customer signs up, sees card + QR ----------
const ctxC = await mk(); const cust = await ctxC.newPage(); watch(cust, 'club');
let memberCode;
{
  await cust.goto(BASE + '/#/club'); await cust.waitForSelector('form');
  await cust.screenshot({ path: OUT + '06-club-signin.png' });
  await cust.getByRole('button', { name: 'New here? Create an account' }).click();
  await cust.getByLabel('Your name').fill('Mona Hassan'); await cust.getByLabel('Email or mobile number').fill('0100 555 1234'); await cust.getByLabel('Password').fill('mona-pass-2026');
  await cust.locator('form button[type=submit]').click(); await cust.waitForSelector('.loyalty-card');
  await cust.waitForFunction(() => { const i = document.querySelector('img.qr'); return i && i.complete && i.naturalWidth > 0; });
  memberCode = (await cust.locator('.member-code').textContent()).trim();
  check('club: sign-up shows 5-stamp card + personal QR + member code', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(memberCode), memberCode);
  check('club: card starts at 0 of 5', (await cust.locator('.lc-progress').textContent()).includes('0 of 5'));
  check('club: no horizontal scroll', await noHScroll(cust));
  await cust.waitForTimeout(1300); await cust.screenshot({ path: OUT + '07-club-card-empty.png' });
  await cust.locator('.qr-panel').scrollIntoViewIfNeeded(); await cust.screenshot({ path: OUT + '08-club-qr.png' });
  const aa = await a11y(cust); check('club: a11y basics', aa.bad.length === 0, aa.bad.join('; '));
}

// ---------- 3. staff validates a visit through the real UI ----------
const ctxS = await mk(); const staff = await ctxS.newPage(); watch(staff, 'staff');
{
  await staff.goto(BASE + '/#/staff'); await staff.waitForSelector('form');
  await staff.getByLabel('Email or mobile number').fill('sara@after8.test'); await staff.getByLabel('Password').fill('staff-pass-12345');
  await staff.locator('form button[type=submit]').click(); await staff.waitForSelector('#m-code');
  await staff.getByRole('button', { name: 'Scan with camera' }).click(); await staff.waitForTimeout(500);
  check('staff: camera path degrades to a clear message when QR scanning is unsupported/blocked', (await staff.locator('.form-error').first().textContent()).length > 10, await staff.locator('.form-error').first().textContent());
  await staff.screenshot({ path: OUT + '09-staff-scan.png' });
  await staff.locator('#m-code').fill('https://after8.example/?t=3'); await staff.getByRole('button', { name: 'Find customer' }).click(); await staff.waitForTimeout(400);
  check('staff: the public menu QR is refused (never awards stamps)', (await staff.locator('.form-error').first().textContent()).includes('never awards'));
  await staff.locator('#m-code').fill(memberCode.toLowerCase()); await staff.getByRole('button', { name: 'Find customer' }).click(); await staff.waitForSelector('.customer-panel');
  check('staff: manual member code finds the customer', (await staff.locator('.customer-panel').textContent()).includes('Mona Hassan'));
  await staff.waitForTimeout(1300); await staff.screenshot({ path: OUT + '10-staff-customer.png' });
  await staff.locator('#s-amt').fill('20'); await staff.locator('#s-rec').fill('INV-5001'); await staff.getByRole('button', { name: /add stamp/i }).click(); await staff.waitForTimeout(500);
  check('staff: below-minimum bill is rejected by the server', (await staff.locator('.customer-panel .form-error').textContent()).includes('minimum'));
  await staff.locator('#s-amt').fill('145'); await staff.getByRole('button', { name: /add stamp/i }).click(); await staff.waitForSelector('.form-ok:not(:empty)');
  check('staff: validated stamp added (1 of 5)', (await staff.locator('.customer-panel .lc-progress').textContent()).includes('1 of 5'));
  await staff.waitForTimeout(1300); await staff.screenshot({ path: OUT + '11-staff-stamped.png' });
  await cust.reload(); await cust.waitForSelector('.loyalty-card');
  check('club: customer sees the new stamp after staff validation', (await cust.locator('.lc-progress').textContent()).includes('1 of 5'));
  await cust.waitForTimeout(1300); await cust.screenshot({ path: OUT + '12-club-card-1.png' });
}

// ---------- 4. earn the reward, redeem on a later day ----------
{
  const s = await apiClient(); await s('POST', '/api/auth/login', { login: 'sara@after8.test', password: 'staff-pass-12345' });
  for (let i = 2; i <= 5; i++) {
    const l = (await s('POST', '/api/staff/lookup', { credential: memberCode })).body;
    const r = await s('POST', '/api/staff/stamp', { grant: l.grant, amount: 100 + i, receipt_ref: `INV-500${i}`, idem_key: `e2e-${i}` });
    if (r.status !== 200) check('setup: stamp ' + i, false, JSON.stringify(r.body));
  }
  await cust.reload(); await cust.waitForSelector('.reward.on');
  check('club: five validated visits unlock the reward (redeemable next visit)', (await cust.locator('.reward.on').textContent()).includes('next visit'));
  await cust.evaluate(() => window.scrollTo(0, 0)); await cust.waitForTimeout(1300); await cust.screenshot({ path: OUT + '13-club-reward-unlocked.png' });
  await staff.reload(); await staff.waitForSelector('#m-code');
  await staff.locator('#m-code').fill(memberCode); await staff.getByRole('button', { name: 'Find customer' }).click(); await staff.waitForSelector('.customer-panel');
  check('staff: same-day redemption is locked', (await staff.locator('.customer-panel .note-box').textContent()).includes('next visit'));
  const db = new DatabaseSync(DB); db.exec('UPDATE rewards SET earned_at = earned_at - 172800000'); db.close();
  await staff.locator('#m-code').fill(memberCode); await staff.getByRole('button', { name: 'Find customer' }).click(); await staff.waitForSelector('input[name=ri]');
  await staff.screenshot({ path: OUT + '14-staff-redeem.png' });
  await staff.getByRole('button', { name: 'Redeem reward' }).click(); await staff.waitForSelector('.form-ok:not(:empty)');
  check('staff: reward redeemed; card resets to 0', (await staff.locator('.customer-panel .lc-progress').textContent()).includes('0 of 5'));
  await cust.reload(); await cust.waitForSelector('.loyalty-card');
  check('club: customer card reset after redemption', (await cust.locator('.lc-progress').textContent()).includes('0 of 5'));
  const s2 = await apiClient(); await s2('POST', '/api/auth/login', { login: 'sara@after8.test', password: 'staff-pass-12345' });
  const l = (await s2('POST', '/api/staff/lookup', { credential: memberCode })).body;
  const again = await s2('POST', '/api/staff/redeem', { grant: l.grant, item_id: desserts[0].id, idem_key: 'e2e-again' });
  check('server: second redemption attempt is refused', again.status === 409 && again.body.error.code === 'no_reward');
}

// ---------- 5. owner dashboard ----------
const ctxO = await mk(); const adm = await ctxO.newPage(); watch(adm, 'admin');
{
  await adm.goto(BASE + '/#/admin'); await adm.waitForSelector('form');
  await adm.getByLabel('Email or mobile number').fill(OWNER.login); await adm.getByLabel('Password').fill(OWNER.password);
  await adm.locator('form button[type=submit]').click(); await adm.waitForSelector('.tabs');
  await adm.waitForSelector('.stats'); await adm.screenshot({ path: OUT + '15-admin-overview.png' });
  await adm.getByRole('button', { name: 'Menu', exact: true }).click(); await adm.waitForSelector('.admin-cat');
  const row = adm.locator('li.admin-item').filter({ has: adm.locator('.ai-name strong', { hasText: /^Cloud Matcha$/ }) });
  await row.getByRole('button', { name: 'Edit' }).click();
  await row.getByLabel('Price (EGP)').fill('150'); await row.getByLabel('Price confirmed').check(); await row.getByLabel(/Review note/).fill('');
  await row.scrollIntoViewIfNeeded(); await adm.screenshot({ path: OUT + '16-admin-edit-item.png' });
  await row.getByRole('button', { name: 'Save' }).click(); await adm.waitForSelector('.form-ok:not(:empty)');
  const pub = await (await fetch(BASE + '/api/menu')).json();
  check('owner: edited + confirmed price appears on the public menu', pub.categories.find((c) => c.slug === 'matcha-corner').items.find((i) => i.name_en === 'Cloud Matcha').price === 150);
  await adm.getByRole('button', { name: 'To verify' }).click(); await adm.waitForSelector('.panel h2'); await adm.waitForTimeout(300);
  await adm.screenshot({ path: OUT + '17-admin-to-verify.png', fullPage: false });
  await adm.getByRole('button', { name: 'Table QR' }).click(); await adm.waitForSelector('.qr-card img'); await adm.waitForTimeout(300);
  await adm.screenshot({ path: OUT + '18-admin-table-qr.png' });
  check('owner: dashboard has no horizontal scroll on a phone', await noHScroll(adm));
  const aa = await a11y(adm); check('owner: a11y basics', aa.bad.length === 0, aa.bad.join('; '));
  await ctxO.close();
}
// customer cannot reach staff/admin data
{
  const c = await apiClient(); await c('POST', '/api/auth/login', { login: '01005551234', password: 'mona-pass-2026' });
  check('customer is forbidden from staff + owner APIs', (await c('POST', '/api/staff/lookup', { credential: memberCode })).status === 403 && (await c('GET', '/api/admin/menu')).status === 403);
}
check('no unexpected console/page errors', problems.length === 0, problems.join(' | '));
await browser.close();
fs.writeFileSync(OUT + 'results.json', JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
