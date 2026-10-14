'use strict';
/* Team screen: authenticated validation of paid visits and reward redemption. */
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); // insecure-context fallback (plain http on a LAN)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function viewStaff(main) {
  if (!state.me) { main.append(h('div', { class: 'page narrow' }, authForm({ intro: t('auth.staffIntro'), allowSignup: false, onDone: () => render() }))); return; }
  if (state.me.role === 'customer') {
    main.append(h('div', { class: 'page narrow' }, h('section', { class: 'panel' }, h('p', { class: 'lede' }, t('staff.notStaff')), h('a', { class: 'btn block', href: '#/club' }, t('nav.club')))));
    return;
  }
  const page = h('div', { class: 'page narrow staff' }, h('h1', { class: 'page-title' }, t('staff.title')));
  const live = h('p', { class: 'form-error', role: 'alert' });
  const scanArea = h('section', { class: 'panel' });
  const resultArea = h('div', { 'aria-live': 'polite' });
  const recentArea = h('section', { class: 'panel' });
  page.append(scanArea, live, resultArea, recentArea, h('button', { class: 'linkish', type: 'button', onclick: signOut }, t('staff.signout')));
  main.append(page);

  let stream = null, scanning = false;
  const video = h('video', { class: 'scan-video', playsinline: true, muted: true, hidden: true, 'aria-label': t('staff.start') });
  const stopScan = () => { scanning = false; if (stream) { stream.getTracks().forEach((tr) => tr.stop()); stream = null; } video.srcObject = null; video.hidden = true; toggleBtn.textContent = t('staff.start'); };
  onCleanup(stopScan);

  async function startScan() {
    live.textContent = '';
    try {
      if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      const formats = await BarcodeDetector.getSupportedFormats();
      if (!formats.includes('qr_code')) throw new Error('unsupported');
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = stream; video.hidden = false; await video.play();
      scanning = true; toggleBtn.textContent = t('staff.stop');
      let last = 0;
      const tick = async () => {
        if (!scanning) return;
        if (performance.now() - last > 180) {
          last = performance.now();
          try { const codes = await det.detect(video); if (codes.length && codes[0].rawValue) { const v = codes[0].rawValue; stopScan(); lookup(v); return; } } catch { /* frame not ready */ }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch (e) { stopScan(); live.textContent = e.message === 'unsupported' ? t('staff.noCamera') : t('staff.camDenied'); }
  }
  const toggleBtn = h('button', { class: 'btn block', type: 'button', onclick: () => (scanning ? stopScan() : startScan()) }, t('staff.start'));
  const manual = h('input', { id: 'm-code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', dir: 'ltr', placeholder: t('staff.manualHint'), maxlength: 300 });
  scanArea.append(h('p', { class: 'lede' }, t('staff.intro')), video, toggleBtn,
    h('form', { class: 'manual', onsubmit: (e) => { e.preventDefault(); if (manual.value.trim()) lookup(manual.value.trim()); } },
      h('div', { class: 'field' }, h('label', { for: 'm-code' }, t('staff.manual')), manual),
      h('button', { class: 'btn block ghost', type: 'submit' }, t('staff.find'))));

  async function lookup(credential) {
    live.textContent = ''; resultArea.replaceChildren();
    try { showCustomer(await api('/api/staff/lookup', { method: 'POST', body: { credential } })); }
    catch (e) { live.textContent = errText(e); }
  }

  function showCustomer(d) {
    const { card, customer, rules } = d;
    let stampKey = uuid(), redeemKey = uuid();
    const msg = h('p', { class: 'form-error', role: 'alert' });
    const ok = h('p', { class: 'form-ok', role: 'status' });
    const actions = h('div');
    const done = (text, newCard) => {
      ok.textContent = text; msg.textContent = '';
      actions.replaceChildren(h('button', { class: 'btn block', type: 'button', onclick: () => { resultArea.replaceChildren(); manual.value = ''; manual.focus(); loadRecent(); } }, t('staff.next')));
      head.replaceChildren(...headContent(newCard)); loadRecent();
    };
    const fail = (e) => {
      if (e.code === 'grant_expired') { resultArea.replaceChildren(); live.textContent = errText(e); return; }
      msg.textContent = errText(e) + (e.extra?.wait_minutes ? ` (${e.extra.wait_minutes} min)` : '');
    };
    const headContent = (c) => [
      h('h2', null, customer.name), h('p', { class: 'code-label', dir: 'ltr' }, customer.member_code),
      h('div', { class: 'loyalty-card compact' }, stampRow(c.stamps, c.required, false), h('p', { class: 'lc-progress' }, t('club.stampsOf', c.stamps, c.required)))];
    const head = h('div', null, ...headContent(card));

    if (card.reward) {
      if (!card.reward.redeemable_now) actions.append(h('p', { class: 'note-box' }, t('staff.rewardLocked')));
      else if (!d.reward_items.length) actions.append(h('p', { class: 'note-box' }, t('staff.noRewardItems')));
      else {
        const radios = d.reward_items.map((it, i) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'ri', value: it.id, checked: i === 0 }), h('span', null, nm(it))));
        actions.append(h('h3', null, t('staff.redeemTitle')),
          h('form', { onsubmit: async (e) => {
            e.preventDefault(); msg.textContent = '';
            const chosen = actions.querySelector('input[name=ri]:checked');
            const btn = e.target.querySelector('button'); btn.disabled = true;
            try { const r = await api('/api/staff/redeem', { method: 'POST', body: { grant: d.grant, item_id: Number(chosen.value), idem_key: redeemKey } }); done(r.replayed ? t('staff.replay') : `${t('staff.redeemed')} ${r.item}`, r.card); }
            catch (ex) { fail(ex); btn.disabled = false; }
          } }, h('fieldset', { class: 'field' }, h('legend', null, t('staff.redeemChoose')), radios), h('button', { class: 'btn block', type: 'submit' }, t('staff.redeem'))));
      }
    } else {
      const amount = h('input', { id: 's-amt', type: 'number', inputmode: 'numeric', min: 1, step: 1, required: true, dir: 'ltr' });
      const receipt = h('input', { id: 's-rec', required: true, maxlength: 40, autocomplete: 'off', dir: 'ltr' });
      actions.append(h('form', { onsubmit: async (e) => {
        e.preventDefault(); msg.textContent = '';
        const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
        try { const r = await api('/api/staff/stamp', { method: 'POST', body: { grant: d.grant, amount: Number(amount.value), receipt_ref: receipt.value, idem_key: stampKey } }); done(r.replayed ? t('staff.replay') : t('staff.added'), r.card); }
        catch (ex) { fail(ex); btn.disabled = false; }
      } },
        h('div', { class: 'field' }, h('label', { for: 's-amt' }, t('staff.amount')), amount),
        h('div', { class: 'field' }, h('label', { for: 's-rec' }, t('staff.receipt')), receipt),
        h('button', { class: 'btn block', type: 'submit' }, t('staff.addStamp'))),
        h('p', { class: 'small-note' }, t('staff.rules', rules)));
    }
    resultArea.replaceChildren(h('section', { class: 'panel customer-panel' }, head, ok, msg, actions));
    resultArea.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  async function loadRecent() {
    try {
      const { recent } = await api('/api/staff/recent');
      recentArea.replaceChildren(h('h2', null, t('staff.recent')), recent.length
        ? h('ul', { class: 'plain-list' }, recent.map((r) => h('li', null, `${r.action === 'stamp.add' ? t('staff.actStamp') : t('staff.actRedeem')} · ${r.customer || ''} · ${dateFmt(r.at)}`)))
        : h('p', { class: 'lede' }, t('club.none')));
    } catch { /* non-critical */ }
  }
  loadRecent();
}
