import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('base64url');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${h.toString('base64url')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored).split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const want = Buffer.from(h, 'base64url');
  const got = crypto.scryptSync(pw, Buffer.from(s, 'base64url'), want.length);
  return crypto.timingSafeEqual(want, got);
}

// Signed, expiring tokens: PREFIX.part1.part2.exp.sig  (parts must not contain '.')
const sig = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url').slice(0, 24);
export function makeSigned(secret, prefix, parts, ttlSec) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = [prefix, ...parts, exp].join('.');
  return `${body}.${sig(secret, body)}`;
}
export function verifySigned(secret, prefix, token) {
  if (typeof token !== 'string' || token.length > 300) return null;
  const segs = token.split('.');
  if (segs.length < 4 || segs[0] !== prefix) return null;
  const given = segs.pop();
  const want = sig(secret, segs.join('.'));
  const a = Buffer.from(given), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const exp = Number(segs[segs.length - 1]);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  return { parts: segs.slice(1, -1), exp };
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newMemberCode = () => Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
export const fmtMemberCode = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;
export function normalizeMemberCode(input) {
  let s = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length === 10 && s.startsWith('A8')) s = s.slice(2);
  return /^[A-Z0-9]{8}$/.test(s) ? s : null;
}

export function normalizeLogin(raw) {
  const v = String(raw || '').trim();
  if (v.includes('@')) {
    const e = v.toLowerCase();
    return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) && e.length <= 254 ? { login: e, type: 'email' } : null;
  }
  let d = v.replace(/[^\d]/g, '');
  if (d.startsWith('0020')) d = d.slice(4), d = '0' + d;
  else if (d.startsWith('20') && d.length === 12) d = '0' + d.slice(2);
  return /^\d{8,15}$/.test(d) ? { login: d, type: 'phone' } : null;
}

const hits = new Map();
export function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return arr.length > max;
}

export function cairoDay(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

export function str(v, { name, min = 0, max = 200, required = false } = {}) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : null;
  if (s === null) throw new HttpError(400, 'invalid', `${name} must be text`);
  if ((required || min) && s.length < Math.max(min, 1)) throw new HttpError(400, 'invalid', `${name} is required`);
  if (s.length > max) throw new HttpError(400, 'invalid', `${name} is too long`);
  return s;
}
export function int(v, { name, min = 0, max = 1e9, nullable = false } = {}) {
  if (v === null || v === '' || v === undefined) {
    if (nullable) return null;
    throw new HttpError(400, 'invalid', `${name} is required`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, 'invalid', `${name} must be a whole number between ${min} and ${max}`);
  return n;
}
export const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
