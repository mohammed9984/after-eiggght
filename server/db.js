import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('customer','staff','owner')),
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,            -- normalized email or phone
  pass_hash TEXT NOT NULL,
  member_code TEXT NOT NULL UNIQUE,      -- manual-entry fallback for the QR
  cycle INTEGER NOT NULL DEFAULT 1,      -- current stamp card number (bumps on redemption)
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',         -- owner-facing review note
  ar_reviewed INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL DEFAULT '',
  desc_en TEXT NOT NULL DEFAULT '',
  desc_ar TEXT NOT NULL DEFAULT '',
  price INTEGER,                         -- whole EGP, NULL when unknown
  price_status TEXT NOT NULL DEFAULT 'verify' CHECK (price_status IN ('confirmed','verify')),
  review_note TEXT NOT NULL DEFAULT '',
  ar_reviewed INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 1,
  reward_eligible INTEGER NOT NULL DEFAULT 0,
  is_new INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  CHECK (price_status = 'verify' OR price IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  staff_id INTEGER NOT NULL REFERENCES users(id),
  cycle INTEGER NOT NULL,
  amount_egp INTEGER NOT NULL,
  receipt_ref TEXT NOT NULL,
  idem_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS visits_receipt ON visits(receipt_ref);
CREATE INDEX IF NOT EXISTS visits_user ON visits(user_id, created_at);

CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  cycle INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available','redeemed')),
  earned_at INTEGER NOT NULL,
  earned_visit_id INTEGER NOT NULL REFERENCES visits(id),
  redeemed_at INTEGER,
  redeemed_by INTEGER REFERENCES users(id),
  redeemed_item_id INTEGER,
  redeemed_item_name TEXT,
  redeem_idem_key TEXT UNIQUE,
  UNIQUE (user_id, cycle)                -- one reward per card, enforced by the database
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  at INTEGER NOT NULL
);
`;

export function openDb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'after8.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

export function audit(db, actorId, action, entity, entityId, detail = {}) {
  db.prepare('INSERT INTO audit_log (actor_id, action, entity, entity_id, detail, at) VALUES (?,?,?,?,?,?)')
    .run(actorId ?? null, action, entity, entityId == null ? null : String(entityId), JSON.stringify(detail), Date.now());
}
