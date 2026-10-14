// Builds ONE self-contained HTML file of the customer menu (real design + real transcribed menu data).
// Club / staff / owner screens need the backend and say so; nothing is faked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a8-prev-'));
const app = createApp(loadConfig({ DATA_DIR: dir, PORT: '0' }));
await new Promise((r) => app.server.listen(0, r));
const menu = await (await fetch(`http://127.0.0.1:${app.server.address().port}/api/menu`)).json();
await app.close(); fs.rmSync(dir, { recursive: true, force: true });

const pub = new URL('../public/', import.meta.url).pathname;
const read = (f) => fs.readFileSync(pub + f, 'utf8');
const js = ['i18n.js', 'core.js', 'staff.js', 'admin.js', 'boot.js'].map(read).join('\n;\n');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
let html = read('index.html')
  .replace(/<link rel="icon"[^>]*>\n?/, '')
  .replace('<link rel="stylesheet" href="/styles.css">', `<style>${read('styles.css')}</style>`)
  .replace(/<script src="[^"]+" defer><\/script>\n?/g, '')
  .replace('</body>', `<script>window.__A8_PREVIEW__ = { menu: ${safe(JSON.stringify(menu))} };\n${safe(js)}</script>\n</body>`);
const out = process.argv[2] || 'after8-preview.html';
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB, ${menu.categories.length} categories, ${menu.categories.reduce((n, c) => n + c.items.length, 0)} items)`);
