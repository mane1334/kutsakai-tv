// apps/api/src/db.ts — SQLite local + snapshots no R2 (persistência free).
// O disco do Render Free é efémero: a cada restart a data.db some.
// Em vez de migrar para Turso/Neon (que obrigaria reescrever TODOS os
// db.prepare para async), o ficheiro .db faz snapshot para o Cloudflare R2:
// restore no arranque (só se o disco estiver vazio) + upload periódico.
// Sem env R2_* configurado, comporta-se como antes (dev local não muda).
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { r2Configured, r2DownloadDb } from './persist-r2.js';

const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data.db');

// garante que a pasta existe (ex. /data no Docker/Fly)
try {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
} catch { /* noop */ }

// disco vazio (restart no Render) + R2 configurado → repõe o snapshot.
// Nunca toca num ficheiro local existente (dev local está a salvo).
if (!fs.existsSync(dbPath) && r2Configured()) {
  console.log('[db] disco vazio, a repor snapshot do R2…');
  const snap = await r2DownloadDb();
  if (snap) {
    fs.writeFileSync(dbPath, snap);
    console.log(`[db] snapshot reposto (${(snap.length / 1048576).toFixed(1)}MB)`);
  } else {
    console.log('[db] sem snapshot no R2 — arranque limpo (seed automático)');
  }
}

export const db = new DatabaseSync(dbPath);
// concorrência: WAL + espera em vez de "database is locked"
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;`);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  country TEXT,
  language TEXT DEFAULT 'pt',
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  languages TEXT DEFAULT '["pt"]',
  countries TEXT DEFAULT '[]',
  regions TEXT DEFAULT '[]',
  categories TEXT DEFAULT '[]',
  quality_mode TEXT DEFAULT 'auto',
  data_saver INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo TEXT,
  stream_url TEXT UNIQUE NOT NULL,
  country TEXT,
  region TEXT,
  languages TEXT DEFAULT '[]',
  categories TEXT DEFAULT '[]',
  resolution TEXT,
  bitrate INTEGER,
  codec TEXT,
  status TEXT DEFAULT 'unknown',
  reliability_score REAL DEFAULT 0,
  last_checked TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS favorites (user_id TEXT, channel_id TEXT, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(user_id, channel_id));
CREATE TABLE IF NOT EXISTS watch_history (id TEXT PRIMARY KEY, user_id TEXT, channel_id TEXT, started_at TEXT DEFAULT (datetime('now')), ended_at TEXT, duration_sec INTEGER DEFAULT 0, data_consumed_mb REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS user_channel_events (id TEXT PRIMARY KEY, user_id TEXT, channel_id TEXT, type TEXT, weight INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS recommendations (id TEXT PRIMARY KEY, user_id TEXT, channel_id TEXT, score REAL, reason TEXT, generated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, user_id TEXT, plan TEXT DEFAULT 'free', status TEXT DEFAULT 'active', started_at TEXT DEFAULT (datetime('now')), expires_at TEXT);
CREATE TABLE IF NOT EXISTS stream_checks (id TEXT PRIMARY KEY, channel_id TEXT, checked_at TEXT DEFAULT (datetime('now')), status TEXT, latency_ms INTEGER, resolution TEXT, bitrate INTEGER, error TEXT);
CREATE TABLE IF NOT EXISTS refresh_tokens (id TEXT PRIMARY KEY, user_id TEXT, token TEXT UNIQUE, expires_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS epg_programs (id TEXT PRIMARY KEY, channel_name TEXT, title TEXT, start TEXT, stop TEXT, description TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS idx_epg_unique ON epg_programs(channel_name, start, stop);
CREATE INDEX IF NOT EXISTS idx_epg_time ON epg_programs(start, stop);
CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, currency TEXT DEFAULT 'MZN', duration_days INTEGER NOT NULL DEFAULT 0, max_devices INTEGER DEFAULT 1, max_quality TEXT DEFAULT '720p', features TEXT DEFAULT '[]', is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS plan_channels (plan_id TEXT NOT NULL, channel_id TEXT NOT NULL, added_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(plan_id, channel_id));
CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, subscription_id TEXT, plan_id TEXT, provider TEXT NOT NULL, provider_transaction_id TEXT, amount REAL NOT NULL, currency TEXT DEFAULT 'MZN', status TEXT DEFAULT 'PENDING', metadata TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), completed_at TEXT);
`);

// migrações leves (tabelas antigas): adiciona colunas se ainda não existirem
for (const sql of [
  `ALTER TABLE subscriptions ADD COLUMN plan_id TEXT`,
  `ALTER TABLE subscriptions ADD COLUMN auto_renew INTEGER DEFAULT 0`,
  `ALTER TABLE subscriptions ADD COLUMN payment_provider TEXT`,
  `ALTER TABLE channels ADD COLUMN access_level TEXT DEFAULT 'FREE'`,
]) {
  try { db.exec(sql); } catch { /* coluna já existe */ }
}

if (process.env.NODE_ENV === 'production' && !process.env.SQLITE_PATH) {
  console.warn('[db] SQLITE_PATH não definido em produção — a usar ./data.db (efémero no Render Free; o snapshot R2 repõe no arranque). Define SQLITE_PATH=/data/data.db com disco, se um dia tiveres volume.');
}
if (process.env.NODE_ENV === 'production' && !r2Configured()) {
  console.warn('[db] R2_* sem configurar — SEM persistência: cada restart perde users/pagamentos. Cria o bucket e define as envs (ver DEPLOY.md).');
}
