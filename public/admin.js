'use strict';
/* Owner dashboard (English UI). Every change is validated and audited on the server. */
function viewAdmin(main) {
  main.setAttribute('dir', 'ltr'); main.setAttribute('lang', 'en');
  const wrap = h('div', { class: 'page wide admin' });
  main.append(wrap);
  if (!state.me) {
    wrap.append(authForm({ intro: 'Owner sign in.', allowSignup: false, onDone: () => render() }));
    api('/api/status').then((s) => { if (s.warnings?.includes('owner_missing')) wrap.prepend(setupBox(s)); }).catch(() => {});
    return;
  }
  if (state.me.role !== 'owner') { wrap.append(h('section', { class: 'panel' }, h('p', { class: 'lede' }, 'This area is for the owner account.'), h('a', { class: 'btn', href: '#/' }, 'Back to menu'))); return; }

  const TABS = [['overview', 'Overview'], ['menu', 'Menu'], ['review', 'To verify'], ['loyalty', 'Loyalty'], ['team', 'People'], ['tables', 'Table QR'], ['activity', 'Activity']];
  let tab = 'overview';
  const openItems = new Set();
  const nav = h('nav', { class: 'tabs', 'aria-label': 'Dashboard sections' });
  const panel = h('div', { class: 'tab-panel' });
  const flash = h('p', { class: 'form-ok', role: 'status' });
  wrap.append(h('div', { class: 'admin-head' }, h('h1', { class: 'page-title' }, t('admin.title')), h('button', { class: 'linkish', type: 'button', onclick: signOut }, 'Sign out')), nav, flash, panel);

  const say = (m, bad) => { flash.className = bad ? 'form-error' : 'form-ok'; flash.textContent = m; if (m) setTimeout(() => { if (flash.textContent === m) flash.textContent = ''; }, 4000); };
  const act = async (fn, okMsg) => { try { const r = await fn(); state.menu = null; if (okMsg) say(okMsg); return r; } catch (e) { say(e.message || errText(e), true); throw e; } };
  const field = (label, input, hint) => { const id = 'a' + Math.random().toString(36).slice(2, 8); input.id = id; return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('small', null, hint)); };
  const check = (label, on) => { const i = h('input', { type: 'checkbox', checked: !!on }); return { i, el: h('label', { class: 'check' }, i, h('span', null, label)) }; };
  const txt = (v, ph) => h('input', { value: v ?? '', placeholder: ph, maxlength: 400 });

  function drawNav() {
    nav.replaceChildren(...TABS.map(([k, label]) => h('button', { type: 'button', class: 'tab', 'aria-current': k === tab ? 'page' : null, onclick: () => { tab = k; drawNav(); draw(); } }, label)));
  }
  const draw = () => { panel.replaceChildren(h('p', { class: 'loading', role: 'status' }, 'Loading…')); ({ overview, menu, review, loyalty, team, tables, activity })[tab]().catch((e) => panel.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, errText(e)))); };

  /* ----- overview ----- */
  async function overview() {
    const [st, s] = await Promise.all([api('/api/admin/stats'), api('/api/status')]);
    const stat = (n, l) => h('div', { class: 'stat' }, h('strong', null, String(n)), h('span', null, l));
    panel.replaceChildren(
      s.warnings.length ? setupBox(s) : h('p', { class: 'note-box ok' }, 'Server configuration looks complete.'),
      h('div', { class: 'stats' }, stat(st.customers, 'Customers'), stat(st.stamps_today, 'Stamps today'), stat(st.stamps_total, 'Stamps total'), stat(st.rewards_available, 'Rewards waiting'), stat(st.rewards_redeemed, 'Rewards redeemed')),
      st.reward_items === 0 ? h('p', { class: 'note-box' }, 'No items are marked reward-eligible yet, so staff cannot redeem rewards. Tick “Reward item” on the products you want to offer (Menu tab).') : null);
  }

  /* ----- menu ----- */
  async function menu() {
    const { categories } = await api('/api/admin/menu');
    const catOpts = categories.map((c) => h('option', { value: c.id }, c.name_en));
    const out = categories.map((c) => {
      const catForm = h('div', { class: 'edit hidden' });
      const buildCatForm = () => {
        const en = txt(c.name_en), ar = txt(c.name_ar), vis = check('Visible to customers', c.visible), arOk = check('Arabic name reviewed', c.ar_reviewed);
        ar.setAttribute('dir', 'rtl');
        catForm.replaceChildren(h('div', { class: 'form-grid' }, field('English name', en), field('Arabic name', ar)), vis.el, arOk.el,
          h('button', { class: 'btn small', type: 'button', onclick: () => act(() => api(`/api/admin/categories/${c.id}`, { method: 'PATCH', body: { name_en: en.value, name_ar: ar.value, visible: vis.i.checked, ar_reviewed: arOk.i.checked } }), 'Category saved').then(menu) }, 'Save category'));
      };
      buildCatForm();
      return h('section', { class: 'admin-cat' },
        h('div', { class: 'cat-head' }, h('h2', null, c.name_en, h('span', { class: 'ar', lang: 'ar', dir: 'rtl' }, c.name_ar), !c.visible && h('span', { class: 'badge muted' }, 'Hidden')),
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => catForm.classList.toggle('hidden') }, 'Edit category')),
        c.note && h('p', { class: 'note-box' }, c.note), catForm,
        h('ul', { class: 'admin-items' }, c.items.map((it) => itemRow(it, catOpts, c))),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => act(() => api('/api/admin/items', { method: 'POST', body: { category_id: c.id, name_en: 'New item', price: null } })).then((r) => { openItems.add(r.id); menu(); }) }, '+ Add item'));
    });
    const newCat = txt('', 'New category name (English)');
    panel.replaceChildren(...out, h('section', { class: 'admin-cat' }, h('h2', null, 'Add category'), field('Name', newCat),
      h('button', { class: 'btn small', type: 'button', onclick: () => newCat.value.trim() && act(() => api('/api/admin/categories', { method: 'POST', body: { name_en: newCat.value } }), 'Category added').then(menu) }, 'Add category')));
  }
  function itemRow(it, catOpts, c) {
    const form = h('div', { class: 'edit' + (openItems.has(it.id) ? '' : ' hidden') });
    const buildForm = () => {
      const en = txt(it.name_en), ar = txt(it.name_ar), de = txt(it.desc_en, 'Optional description'), da = txt(it.desc_ar, 'وصف اختياري');
      ar.setAttribute('dir', 'rtl'); da.setAttribute('dir', 'rtl');
      const price = h('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: it.price ?? '' });
      const conf = check('Price confirmed', it.price_status === 'confirmed');
      const note = h('textarea', { rows: 2, maxlength: 500 }, it.review_note);
      const av = check('Available today', it.available), rw = check('Reward item', it.reward_eligible), nw = check('NEW badge', it.is_new), arOk = check('Arabic name reviewed', it.ar_reviewed);
      const cat = h('select', null, ...catOpts.map((o) => o.cloneNode(true))); cat.value = String(it.category_id);
      form.replaceChildren(
        h('div', { class: 'form-grid' }, field('English name', en), field('Arabic name', ar), field('Description (EN)', de), field('Description (AR)', da), field('Price (EGP)', price), field('Category', cat)),
        field('Review note (clear this when the item is verified)', note),
        h('div', { class: 'checks' }, conf.el, av.el, rw.el, nw.el, arOk.el),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn small', type: 'button', onclick: () => { openItems.add(it.id); act(() => api(`/api/admin/items/${it.id}`, { method: 'PATCH', body: {
            name_en: en.value, name_ar: ar.value, desc_en: de.value, desc_ar: da.value, price: price.value === '' ? null : price.value,
            price_status: conf.i.checked ? 'confirmed' : 'verify', review_note: note.value, available: av.i.checked, reward_eligible: rw.i.checked, is_new: nw.i.checked,
            ar_reviewed: arOk.i.checked, category_id: cat.value } }), 'Saved').then(menu).catch(() => {}); } }, 'Save'),
          h('button', { class: 'btn small danger', type: 'button', onclick: () => { if (confirm(`Delete “${it.name_en}”?`)) act(() => api(`/api/admin/items/${it.id}`, { method: 'DELETE' }), 'Deleted').then(menu); } }, 'Delete')));
    };
    buildForm();
    const quick = check('Available', it.available);
    quick.i.addEventListener('change', () => act(() => api(`/api/admin/items/${it.id}`, { method: 'PATCH', body: { available: quick.i.checked } }), quick.i.checked ? 'Marked available' : 'Marked unavailable').catch(() => { quick.i.checked = !quick.i.checked; }));
    return h('li', { class: 'admin-item' },
      h('div', { class: 'ai-row' },
        h('div', { class: 'ai-name' }, h('strong', null, it.name_en), h('span', { class: 'ar', lang: 'ar', dir: 'rtl' }, it.name_ar),
          h('span', { class: 'ai-badges' },
            it.price_status === 'verify' && h('span', { class: 'badge warn' }, 'Price to verify'), it.review_note && it.price_status !== 'verify' && h('span', { class: 'badge warn' }, 'Note'),
            !it.ar_reviewed && h('span', { class: 'badge muted' }, 'AR draft'), it.reward_eligible && h('span', { class: 'badge' }, 'Reward'))),
        h('span', { class: 'ai-price' }, it.price == null ? '—' : `${it.price} EGP`), quick.el,
        h('button', { class: 'btn small ghost', type: 'button', 'aria-expanded': openItems.has(it.id) ? 'true' : 'false', onclick: (e) => { form.classList.toggle('hidden'); const o = !form.classList.contains('hidden'); o ? openItems.add(it.id) : openItems.delete(it.id); e.target.setAttribute('aria-expanded', String(o)); } }, 'Edit')),
      it.review_note && h('p', { class: 'ai-note' }, it.review_note), form);
  }

  /* ----- to verify ----- */
  async function review() {
    const [{ categories }, st, settings] = await Promise.all([api('/api/admin/menu'), api('/api/admin/stats'), api('/api/admin/settings')]);
    const photo = await new Promise((res) => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = '/assets/storefront.jpg'; });
    const blocks = [];
    const emptyCats = categories.filter((c) => !c.items.length);
    if (emptyCats.length) blocks.push(['Categories with no items', emptyCats.map((c) => `${c.name_en}: ${c.note || 'add items in the Menu tab'}`)]);
    const flagged = categories.flatMap((c) => c.items.filter((i) => i.price_status === 'verify' || i.review_note).map((i) => `${i.name_en} (${c.name_en}): ${i.price_status === 'verify' ? 'no price shown to customers yet. ' : ''}${i.review_note}`));
    if (flagged.length) blocks.push(['Items needing a decision', flagged]);
    const arPending = categories.map((c) => ({ c, n: c.items.filter((i) => !i.ar_reviewed).length })).filter((x) => x.n);
    const extra = [];
    if (/feels/.test(settings.tagline)) extra.push('Tagline reads “' + settings.tagline + '” exactly as printed on the menu. Confirm the wording in Loyalty settings.');
    if (st.reward_items === 0) extra.push('No reward items chosen: staff cannot redeem rewards until you tick “Reward item” on some products.');
    if (!photo) extra.push('No storefront photo found. Add public/assets/storefront.jpg (and optionally interior.jpg); the hero uses it automatically.');
    extra.push('Burgundy (#8C2420) was sampled from the printed menu lettering, not from a storefront photo.');
    blocks.push(['Brand and set-up', extra]);
    panel.replaceChildren(
      ...blocks.map(([title, list]) => h('section', { class: 'panel' }, h('h2', null, title), h('ul', { class: 'plain-list' }, list.map((x) => h('li', null, x))))),
      h('section', { class: 'panel' }, h('h2', null, 'Arabic names written for this build (drafts)'),
        arPending.length ? h('div', null, h('p', { class: 'lede' }, 'Check the Arabic wording, then mark each category as reviewed.'),
          arPending.map(({ c, n }) => h('div', { class: 'row-actions' }, h('span', null, `${c.name_en}: ${n} to review`),
            h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { await act(async () => { for (const i of c.items.filter((x) => !x.ar_reviewed)) await api(`/api/admin/items/${i.id}`, { method: 'PATCH', body: { ar_reviewed: true } }); await api(`/api/admin/categories/${c.id}`, { method: 'PATCH', body: { ar_reviewed: true } }); }, `${c.name_en} marked reviewed`); review(); } }, 'Mark reviewed'))))
          : h('p', { class: 'note-box ok' }, 'All Arabic names are marked reviewed.')));
  }

  /* ----- loyalty ----- */
  async function loyalty() {
    const s = await api('/api/admin/settings');
    const min = h('input', { type: 'number', min: 0, step: 1, value: s.min_spend_egp }), cd = h('input', { type: 'number', min: 0, step: 5, value: s.cooldown_minutes });
    const nd = check('Reward can only be redeemed on a later day than the one it was earned (the “sixth visit”)', s.redeem_requires_new_day);
    const re = txt(s.reward_text_en), ra = txt(s.reward_text_ar); ra.setAttribute('dir', 'rtl');
    const tg = txt(s.tagline);
    panel.replaceChildren(h('section', { class: 'panel' }, h('h2', null, 'AFTER 8 CLUB rules'),
      h('p', { class: 'lede' }, `A card has ${s.stamps_required} stamps. Each stamp is added by staff after a paid visit. The sixth visit redeems the reward, then a new card starts.`),
      h('div', { class: 'form-grid' }, field('Minimum bill for a stamp (EGP)', min, '0 means any paid bill qualifies'), field('Minutes between stamps for one customer', cd, 'Stops accidental double stamps')),
      nd.el, h('div', { class: 'form-grid' }, field('Reward wording (EN)', re), field('Reward wording (AR)', ra), field('Tagline', tg)),
      h('p', { class: 'small-note' }, 'Which products can be claimed as the reward is set per product in the Menu tab (“Reward item”).'),
      h('button', { class: 'btn', type: 'button', onclick: () => act(() => api('/api/admin/settings', { method: 'PATCH', body: { min_spend_egp: min.value, cooldown_minutes: cd.value, redeem_requires_new_day: nd.i.checked, reward_text_en: re.value, reward_text_ar: ra.value, tagline: tg.value } }), 'Settings saved') }, 'Save rules')));
  }

  /* ----- people ----- */
  async function team() {
    const [{ users: staff }] = await Promise.all([api('/api/admin/users?role=staff')]);
    const nm1 = txt(''), lg = txt('', 'email or mobile'), pw = h('input', { type: 'text', minlength: 10, autocomplete: 'off', placeholder: '10+ characters' });
    const tempBox = h('p', { class: 'note-box hidden', role: 'status' });
    const userRow = (u) => h('li', { class: 'admin-item' }, h('div', { class: 'ai-row' },
      h('div', { class: 'ai-name' }, h('strong', null, u.name), h('span', null, `${u.login} · ${u.member_code}`), !u.active && h('span', { class: 'badge muted' }, 'Disabled')),
      h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { const r = await act(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { reset_password: true } })); tempBox.textContent = `Temporary password for ${u.name}: ${r.temp_password}  (shown once; their sessions were signed out)`; tempBox.classList.remove('hidden'); } }, 'Reset password'),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => act(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }), u.active ? 'Disabled' : 'Enabled').then(team) }, u.active ? 'Disable' : 'Enable')));
    const q = txt('', 'Search name, email/mobile or member code'); const results = h('ul', { class: 'admin-items' });
    q.addEventListener('input', () => { clearTimeout(q._t); q._t = setTimeout(async () => { if (q.value.trim().length < 2) { results.replaceChildren(); return; } const r = await api(`/api/admin/users?role=customer&q=${encodeURIComponent(q.value.trim())}`); results.replaceChildren(...r.users.map(userRow)); }, 250); });
    panel.replaceChildren(
      h('section', { class: 'panel' }, h('h2', null, 'Staff accounts'), h('ul', { class: 'admin-items' }, staff.length ? staff.map(userRow) : h('li', { class: 'lede' }, 'No staff yet.')),
        h('h3', null, 'Add staff member'), h('div', { class: 'form-grid' }, field('Name', nm1), field('Login (email or mobile)', lg), field('Password', pw)),
        h('button', { class: 'btn small', type: 'button', onclick: () => act(() => api('/api/admin/staff', { method: 'POST', body: { name: nm1.value, login: lg.value, password: pw.value } }), 'Staff account created').then(team).catch(() => {}) }, 'Create staff account')),
      tempBox, h('section', { class: 'panel' }, h('h2', null, 'Find a customer'), field('Search', q), results));
  }

  /* ----- table QR ----- */
  async function tables() {
    const s = await api('/api/status');
    const count = h('input', { type: 'number', min: 1, max: 60, value: 12 }); const grid = h('div', { class: 'qr-grid' });
    const draw2 = () => {
      const n = Math.max(1, Math.min(60, Number(count.value) || 1));
      grid.replaceChildren(...Array.from({ length: n }, (_, i) => h('figure', { class: 'qr-card' }, h('img', { src: `/api/qr/menu?table=${i + 1}`, alt: `Menu QR for table ${i + 1}`, width: 160, height: 160, loading: 'lazy' }), h('figcaption', null, h('strong', { lang: 'en' }, 'AFTER 8'), ` · Table ${i + 1}`))));
    };
    count.addEventListener('input', draw2); draw2();
    panel.replaceChildren(h('section', { class: 'panel' }, h('h2', null, 'Table QR codes'),
      h('p', { class: 'lede' }, 'These open the public menu only. They never award stamps (stamps need a signed-in staff member to validate a paid visit).'),
      h('p', { class: s.base_url_configured ? 'note-box ok' : 'note-box' }, `Codes point to ${s.base_url}` + (s.base_url_configured ? '' : '. That is not a public address: set BASE_URL before printing.')),
      field('How many tables', count), h('button', { class: 'btn small', type: 'button', onclick: () => window.print() }, 'Print'), grid));
  }

  /* ----- activity ----- */
  async function activity() {
    const { log } = await api('/api/admin/audit');
    panel.replaceChildren(h('section', { class: 'panel' }, h('h2', null, 'Recent activity'), h('ul', { class: 'plain-list' },
      log.map((l) => h('li', null, `${dateFmt(l.at)} · ${l.actor || 'system'} · ${l.action}${l.detail?.name ? ' · ' + l.detail.name : ''}${l.detail?.amount ? ' · ' + l.detail.amount + ' EGP' : ''}`)))));
  }

  drawNav(); draw();
}

function setupBox(s) {
  const steps = [];
  if (s.warnings.includes('owner_missing')) steps.push(['Owner account not created.', 'Set OWNER_EMAIL and OWNER_PASSWORD (10+ characters) in the server environment (or a .env file), then restart. The owner is created on the next start; no default password exists.']);
  if (s.warnings.includes('base_url_missing')) steps.push(['Public address not set.', 'Set BASE_URL=https://your-domain and restart so table QR codes point to the live site.']);
  if (s.warnings.includes('insecure_cookies')) steps.push(['Site is not on https.', 'Serve the site over https (required for staff camera scanning on phones, and for Secure cookies).']);
  return h('section', { class: 'panel setup', role: 'region', 'aria-label': 'Set-up needed' }, h('h2', null, 'Set-up needed'),
    h('ol', { class: 'plain-list' }, steps.map(([a, b]) => h('li', null, h('strong', null, a), ' ', b))));
}
