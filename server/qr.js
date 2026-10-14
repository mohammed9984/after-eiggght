import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const QRCode = require('./vendor/qrcode/index.js');
const ECC = require('./vendor/qrcode/QRErrorCorrectLevel.js');

/** Returns an SVG string for `text`. Pure server-side generation; nothing is faked. */
export function qrSvg(text, { margin = 3, ecc = 'M', dark = '#1E1B19', light = '#FFFFFF' } = {}) {
  let qr = null;
  for (let type = 2; type <= 40; type++) {
    try {
      const q = new QRCode(type, ECC[ecc]);
      q.addData(text);
      q.make();
      qr = q;
      break;
    } catch (e) {
      if (type === 40) throw new Error('QR data too long');
    }
  }
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (qr.isDark(r, c)) {
        let run = 1;
        while (c + run < n && qr.isDark(r, c + run)) run++;
        d += `M${c + margin} ${r + margin}h${run}v1h-${run}z`;
        c += run;
      } else c++;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img"><rect width="${size}" height="${size}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
