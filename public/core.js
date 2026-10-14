'use strict';
/* AFTER 8 core: helpers, API client, router, menu, AFTER 8 CLUB, sign-in. No innerHTML anywhere: all text is inserted as text nodes. */
const state = { lang: 'en', me: null, menu: null, cleanups: [] };

const t = (path, ...args) => {
  const get = (d) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), d);
  const v = get(I18N[state.lang]) ?? get(I18N.en) ?? path;
  return typeof v === 'function' ? v(...args) : v;
};
const $ = (s, r = document) => r.querySelector(s);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  return el;
}
function starSvg() {
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 ? 4.4 : 11.5, a = (Math.PI * i) / 8 - Math.PI / 2;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  const s = svgEl('svg', { viewBox: '0 0 24 24', class: 'star', 'aria-hidden': 'true', focusable: 'false' });
  s.append(svgEl('polygon', { points: pts.join(' ') }));
  return s;
}

class ApiError extends Error {
  constructor(code, message, status, extra) { super(message || code); this.code = code; this.status = status; this.extra = extra; }
}
async function api(path, { method = 'GET', body } = {}) {
  if (window.__A8_PREVIEW__) {
    if (path === '/api/menu') return window.__A8_PREVIEW__.menu;
    if (path === '/api/me') return { user: null };
    throw new ApiError('preview', '', 0);
  }
  let res;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new ApiError('network', '', 0); }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(data?.error?.code || 'server', data?.error?.message || '', res.status, data?.error);
  return data;
}
const errText = (e) => (I18N[state.lang].err[e.code]) || e.message || I18N.en.err.server;
const nm = (o, f = 'name') => (state.lang === 'ar' && o[`${f}_ar`]) || o[`${f}_en`] || '';
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const onCleanup = (fn) => state.cleanups.push(fn);
const runCleanups = () => { for (const f of state.cleanups.splice(0)) { try { f(); } catch { /* ignore */ } } };
const dateFmt = (ms) => new Intl.DateTimeFormat(state.lang === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(ms));
const dayFmt = (ms) => new Intl.DateTimeFormat(state.lang === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeZone: 'Africa/Cairo' }).format(new Date(ms));

function fmtPrice(p) {
  if (p == null) return h('span', { class: 'ask' }, t('menu.ask'));
  return h('span', { class: 'price' }, h('span', { class: 'num' }, String(p)), h('span', { class: 'cur' }, t('menu.currency')));
}

/* ---------- shell ---------- */
function setLang(lang) {
  state.lang = lang;
  try { localStorage.setItem('a8lang', lang); } catch { /* private mode */ }
  render();
}
function wordmark() { return h('span', { class: 'wm', lang: 'en', dir: 'ltr' }, 'AFTER ', h('span', { class: 'eight' }, '8')); }

function header(route) {
  return h('header', { class: 'top' },
    h('a', { class: 'logo', href: '#/', 'aria-label': 'AFTER 8: ' + t('nav.home') }, wordmark()),
    h('div', { class: 'top-actions' },
      h('button', { class: 'pill', type: 'button', lang: state.lang === 'ar' ? 'en' : 'ar', onclick: () => setLang(state.lang === 'ar' ? 'en' : 'ar') }, t('switchTo')),
      route === 'club' ? h('a', { class: 'btn small ghost', href: '#/' }, t('nav.menu')) : h('a', { class: 'btn small', href: '#/club' }, t('nav.club'))));
}
function footer() {
  return h('footer', { class: 'foot' },
    h('p', { class: 'foot-tag', lang: 'en', dir: 'ltr' }, state.menu?.tagline || ''),
    h('p', { class: 'foot-links' }, h('a', { href: '#/staff' }, t('nav.staff')), ' · ', h('a', { href: '#/admin' }, t('nav.admin'))));
}

function routeName() {
  const m = (location.hash || '#/').match(/^#\/([a-z]*)/);
  return ['club', 'staff', 'admin'].includes(m?.[1]) ? m[1] : 'menu';
}
function render() {
  runCleanups();
  const dict = I18N[state.lang];
  document.documentElement.lang = state.lang;
  document.documentElement.dir = dict.dir;
  $('#skip').textContent = dict.skip;
  const route = routeName();
  document.title = route === 'club' ? 'AFTER 8 CLUB' : route === 'staff' ? 'AFTER 8 · ' + t('staff.title') : route === 'admin' ? 'AFTER 8 · ' + t('admin.title') : 'AFTER 8';
  const main = h('main', { id: 'app', tabindex: '-1', class: 'route-' + route });
  $('#root').replaceChildren(header(route), main, footer());
  ({ menu: viewMenu, club: viewClub, staff: viewStaff, admin: viewAdmin })[route](main);
}

/* ---------- menu ---------- */
async function loadMenu() {
  state.menu = await api('/api/menu');
  return state.menu;
}
function viewMenu(main) {
  const table = (location.search.match(/[?&]t=(\d{1,3})\b/) || [])[1];
  main.append(
    h('section', { class: 'hero' },
      h('img', { class: 'hero-photo', src: '/assets/storefront.jpg', alt: '', onerror: (e) => e.target.remove(), decoding: 'async' }),
      h('div', { class: 'hero-inner' },
        h('p', { class: 'hero-brand' }, wordmark()),
        h('h1', { class: 'hero-title' }, t('hero.menu')),
        h('p', { class: 'hero-script', lang: 'en', dir: 'ltr' }, state.menu?.tagline || ''),
        table && h('p', { class: 'table-pill' }, `${t('hero.table')} ${table}`))),
    h('a', { class: 'club-banner', href: '#/club' },
      starSvg(),
      h('span', { class: 'cb-text' }, h('strong', null, t('banner.title')), h('span', null, t('banner.text'))),
      h('span', { class: 'cb-cta' }, t('banner.cta'))));
  const body = h('div', { class: 'menu-body' }, h('p', { class: 'loading', role: 'status' }, t('menu.loading')));
  main.append(body);
  const paint = () => {
    const m = state.menu;
    const chips = h('nav', { class: 'chips', 'aria-label': t('menu.categories') });
    const sections = m.categories.map((c) => {
      const id = 'cat-' + c.slug;
      return h('section', { class: 'cat', id, 'aria-labelledby': 'h-' + c.slug },
        h('h2', { id: 'h-' + c.slug }, nm(c), starSvg()),
        h('ul', { class: 'items' }, c.items.map((it) =>
          h('li', { class: 'item' + (it.available ? '' : ' off') },
            h('div', { class: 'item-main' },
              h('span', { class: 'item-name' }, nm(it), it.is_new && h('span', { class: 'badge' }, t('menu.isNew'))),
              nm(it, 'desc') && h('p', { class: 'item-desc' }, nm(it, 'desc')),
              !it.available && h('p', { class: 'item-off' }, t('menu.unavailable'))),
            fmtPrice(it.price)))));
    });
    const chipEls = m.categories.map((c, i) => {
      const b = h('button', { type: 'button', class: 'chip', 'data-target': 'cat-' + c.slug, 'aria-current': i === 0 ? 'true' : null,
        onclick: () => { $('#cat-' + c.slug).scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }); } }, nm(c));
      chips.append(b);
      return b;
    });
    body.replaceChildren(chips, ...sections, h('p', { class: 'menu-foot' }, t('menu.footer')));
    // highlight the chip for the section in view
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) {
        chipEls.forEach((c) => c.removeAttribute('aria-current'));
        const active = chipEls.find((c) => c.dataset.target === en.target.id);
        if (active) { active.setAttribute('aria-current', 'true'); chips.scrollTo({ left: active.offsetLeft - chips.clientWidth / 2 + active.clientWidth / 2, behavior: 'auto' }); }
      }
    }, { rootMargin: '-130px 0px -65% 0px' });
    body.querySelectorAll('.cat').forEach((s) => io.observe(s));
    onCleanup(() => io.disconnect());
  };
  const go = () => loadMenu().then(() => { if (routeName() === 'menu') { paint(); const f = $('.foot-tag'); if (f) f.textContent = state.menu.tagline; const s = $('.hero-script'); if (s) s.textContent = state.menu.tagline; } })
    .catch(() => body.replaceChildren(h('div', { class: 'error-box', role: 'alert' }, h('p', null, t('menu.error')), h('button', { class: 'btn', type: 'button', onclick: () => { body.replaceChildren(h('p', { class: 'loading' }, t('menu.loading'))); go(); } }, t('menu.retry')))));
  if (state.menu) paint(); else go();
}

/* ---------- sign in / sign up ---------- */
function authForm({ intro, allowSignup = true, onDone }) {
  let mode = 'signin';
  const wrap = h('section', { class: 'panel auth' });
  const draw = () => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const name = h('input', { id: 'f-name', name: 'name', autocomplete: 'name', required: true, maxlength: 80 });
    const login = h('input', { id: 'f-login', name: 'login', autocomplete: 'username', inputmode: 'email', required: true, dir: 'ltr', maxlength: 254 });
    const pw = h('input', { id: 'f-pw', name: 'password', type: 'password', autocomplete: mode === 'signin' ? 'current-password' : 'new-password', required: true, minlength: mode === 'signin' ? 1 : 8, maxlength: 200, dir: 'ltr' });
    const submit = h('button', { class: 'btn block', type: 'submit' }, mode === 'signin' ? t('auth.signin') : t('auth.signup'));
    const form = h('form', { novalidate: false, onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; submit.disabled = true; submit.textContent = t('auth.working');
      try {
        const r = await api(mode === 'signin' ? '/api/auth/login' : '/api/auth/signup', { method: 'POST', body: { name: name.value, login: login.value, password: pw.value } });
        state.me = r.user; onDone(r.user);
      } catch (ex) { err.textContent = errText(ex); submit.disabled = false; submit.textContent = mode === 'signin' ? t('auth.signin') : t('auth.signup'); }
    } },
      mode === 'signup' && h('div', { class: 'field' }, h('label', { for: 'f-name' }, t('auth.name')), name),
      h('div', { class: 'field' }, h('label', { for: 'f-login' }, t('auth.login')), login),
      h('div', { class: 'field' }, h('label', { for: 'f-pw' }, t('auth.password')), pw, mode === 'signup' && h('small', null, t('auth.hint'))),
      err, submit);
    wrap.replaceChildren(
      h('h1', { class: 'page-title' }, mode === 'signin' ? t('auth.signin') : t('auth.signup')),
      h('p', { class: 'lede' }, intro), form,
      allowSignup && h('button', { class: 'linkish', type: 'button', onclick: () => { mode = mode === 'signin' ? 'signup' : 'signin'; draw(); $('#f-login').focus(); } },
        mode === 'signin' ? t('auth.noAccount') : t('auth.haveAccount')));
  };
  draw();
  return wrap;
}
async function signOut() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  state.me = null; location.hash = '#/club'; render();
}

/* ---------- AFTER 8 CLUB ---------- */
function stampRow(n, required, animate) {
  const items = [];
  for (let i = 1; i <= required; i++) {
    const on = i <= n;
    items.push(h('li', { class: 'stamp' + (on ? ' on' : ''), style: null, 'aria-label': `${i}${on ? ' ✓' : ''}` },
      on ? h('span', { class: 'eight', lang: 'en' }, '8') : h('span', { class: 'num', 'aria-hidden': 'true' }, String(i))));
  }
  items.push(h('li', { class: 'stamp gift', 'aria-label': t('club.sixth') }, starSvg(), h('span', { class: 'gift-l' }, t('club.sixth'))));
  const ol = h('ol', { class: 'stamps' + (animate ? ' animate' : '') }, items);
  [...ol.children].forEach((li, i) => li.style.setProperty('--i', i));
  return ol;
}

function viewClub(main) {
  if (!state.me) {
    main.append(h('div', { class: 'page narrow' }, authForm({ intro: t('auth.clubIntro'), onDone: () => render() })));
    return;
  }
  if (state.me.role !== 'customer') {
    main.append(h('div', { class: 'page narrow' }, h('section', { class: 'panel' },
      h('h1', { class: 'page-title' }, t('club.title')), h('p', { class: 'lede' }, t('club.staffNote')),
      h('a', { class: 'btn block', href: '#/staff' }, t('club.openStaff')),
      state.me.role === 'owner' && h('a', { class: 'btn block ghost', href: '#/admin' }, t('club.openAdmin')),
      h('button', { class: 'linkish', type: 'button', onclick: signOut }, t('club.signout')))));
    return;
  }
  const page = h('div', { class: 'page narrow' }, h('h1', { class: 'page-title sr-or-visible' }, t('club.title')), h('p', { class: 'loading', role: 'status' }, t('menu.loading')));
  main.append(page);
  api('/api/me/card').then((c) => {
    const rw = c.reward;
    const rewardText = state.lang === 'ar' ? rw?.text_ar : rw?.text_en;
    const card = h('section', { class: 'loyalty-card', 'aria-label': t('club.title') },
      h('p', { class: 'lc-hello' }, `${t('club.hello')}, `, h('strong', null, c.name)),
      stampRow(c.stamps, c.required, !reduceMotion()),
      h('p', { class: 'lc-progress', role: 'status' }, t('club.stampsOf', c.stamps, c.required)),
      rw
        ? h('div', { class: 'reward on' }, h('p', { class: 'reward-title' }, t('club.rewardTitle')), h('p', null, rewardText), h('p', { class: 'reward-state' }, rw.redeemable_now ? t('club.rewardNow') : t('club.rewardNext')))
        : h('p', { class: 'lc-hint' }, t('club.progressHint', c.required - c.stamps)));
    const qrImg = h('img', { class: 'qr', alt: t('club.qrAlt'), width: 232, height: 232 });
    const codeEl = h('p', { class: 'member-code', dir: 'ltr' }, c.member_code);
    const qrBox = h('section', { class: 'panel qr-panel' },
      h('h2', null, t('club.qrTitle')), h('div', { class: 'qr-frame' }, qrImg), h('p', { class: 'lede' }, t('club.qrHint')),
      h('p', { class: 'code-label' }, t('club.code')), codeEl, h('p', { class: 'small-note' }, t('club.codeHint')));
    let timer;
    const loadQr = async () => {
      try {
        const q = await api('/api/me/qr');
        qrImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(q.svg);
        timer = setTimeout(loadQr, Math.max(15, q.expires_in - 40) * 1000);
      } catch (e) { if (e.status === 401) { state.me = null; render(); } else timer = setTimeout(loadQr, 10000); }
    };
    loadQr();
    const vis = () => { if (!document.hidden) { clearTimeout(timer); loadQr(); } };
    document.addEventListener('visibilitychange', vis);
    onCleanup(() => { clearTimeout(timer); document.removeEventListener('visibilitychange', vis); });
    page.replaceChildren(
      h('h1', { class: 'page-title' }, t('club.title')), card, qrBox,
      h('p', { class: 'small-note rules' }, t('club.rules')),
      h('section', { class: 'panel' }, h('h2', null, t('club.history')),
        c.history.length ? h('ul', { class: 'plain-list' }, c.history.map((v) => h('li', null, dateFmt(v.created_at)))) : h('p', { class: 'lede' }, t('club.none')),
        c.rewards.some((r) => r.status === 'redeemed') && h('div', null, h('h3', null, t('club.past')),
          h('ul', { class: 'plain-list' }, c.rewards.filter((r) => r.status === 'redeemed').map((r) => h('li', null, `${t('club.redeemedOn')} ${dayFmt(r.redeemed_at)}`))))),
      h('button', { class: 'linkish', type: 'button', onclick: signOut }, t('club.signout')));
  }).catch((e) => {
    if (e.status === 401) { state.me = null; render(); return; }
    page.replaceChildren(h('div', { class: 'error-box', role: 'alert' }, h('p', null, errText(e)), h('button', { class: 'btn', type: 'button', onclick: render }, t('menu.retry'))));
  });
}
