import fs from 'node:fs';
import path from 'node:path';

// Minimal .env loader (no dependency). Real environment variables win over the file.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2].replace(/\s+#.*$/, '');
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export function loadConfig(overrides = {}) {
  loadDotEnv(path.resolve(process.cwd(), '.env'));
  const e = { ...process.env, ...overrides };
  const port = Number(e.PORT || 3000);
  const baseUrlRaw = (e.BASE_URL || '').trim().replace(/\/+$/, '');
  const baseUrl = baseUrlRaw || `http://localhost:${port}`;
  return {
    port,
    dataDir: path.resolve(e.DATA_DIR || './data'),
    baseUrl,
    baseUrlConfigured: Boolean(baseUrlRaw) && !/localhost|127\.0\.0\.1/.test(baseUrlRaw),
    secureCookies: baseUrl.startsWith('https://'),
    ownerEmail: (e.OWNER_EMAIL || '').trim().toLowerCase(),
    ownerPassword: e.OWNER_PASSWORD || '',
    sessionSecret: e.SESSION_SECRET || '',
    publicDir: path.resolve(new URL('../public', import.meta.url).pathname),
  };
}
