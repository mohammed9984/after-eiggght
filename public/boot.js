'use strict';
(async function boot() {
  let saved = null;
  try { saved = localStorage.getItem('a8lang'); } catch { /* ignore */ }
  state.lang = saved === 'ar' || saved === 'en' ? saved : (navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
  try { state.me = (await api('/api/me')).user; } catch { state.me = null; }
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  render();
})();
