// apps/api/src/db.ts — SQLite local OU réplica embebida Turso (libsql, API síncrona).
// Sem TURSO_DATABASE_URL: comporta-se como antes (node:sqlite local + snapshot R2).
// Com TURSO_DATABASE_URL + TURSO_AUTH_TOKEN: réplica embebida:
//   - leituras: ficheiro local (microssegundos)
//   - escritas: vão ao primário na cloud e refletem local (readYourWrites)
//   - pull periódico + sync() inicial obrigatório (ficheiro vazio não sincroniza sozinho)
// Zero reescrita: mantém db.prepare().get/run/all + db.exec em todo o lado.
import path from 'node:path';
import fs from 'node:fs';
import { r2Configured, r2DownloadDb } from './persist-r2.js';

const TURSO_URL =
  process.env.TURSO_DATABASE_URL || process.env.TURSO_SYNC_URL || process.env.LIBSQL_URL || '';
const TURSO_TOKEN =
  process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || '';
const SYNC_PERIOD_SEC = Math.max(60, Number(process.env.TURSO_SYNC_INTERVAL || 300));

export const isTurso = () => !!(TURSO_URL && TURSO_TOKEN);

const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data.db');

// garante que a pasta existe (ex. /data no Docker/Fly, /tmp no Render)
try {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
} catch { /* noop */ }

// R2 snapshot só faz sentido no modo local. Com Turso a cloud É a persistência.
if (!isTurso() && !fs.existsSync(dbPath) && r2Configured()) {
  console.log('[db] disco vazio, a repor snapshot do R2…');
  const snap = await r2DownloadDb();
  if (snap) {
    fs.writeFileSync(dbPath, snap);
    console.log(`[db] snapshot reposto (${(snap.length / 1048576).toFixed(1)}MB)`);
  } else {
    console.log('[db] sem snapshot no R2 — arranque limpo (seed automático)');
  }
}

// --- abre a DB (mesma API síncrona nos dois modos) ---
let _db: any;
if (isTurso()) {
  // import dinâmico para não partir dev local sem o binário nativo
  const { default: LibsqlDatabase } = await import('libsql');
  console.log(`[db] modo TURSO réplica embebida: file=${dbPath} sync=${TURSO_URL.replace(/:\/\/.*@/, '://***@')}`);
  const openReplica = () => new LibsqlDatabase(dbPath, {
    syncUrl: TURSO_URL,
    authToken: TURSO_TOKEN,
    syncInterval: SYNC_PERIOD_SEC,
    readYourWrites: true,
    offline: false,
  } as any);
  try {
    _db = openReplica();
  } catch (e: any) {
    // ficheiro .db local anterior (sqlite puro) não tem metadados de sync:
    // guarda backup e recomeça a réplica do zero (a cloud é a fonte da verdade
    // após o push inicial; o backup fica em <path>.pre-turso.bak).
    if (String(e?.message || e).includes('InvalidLocalState') || String(e?.message || e).includes('metadata file does not')) {
      const bak = `${dbPath}.pre-turso.bak`;
      try { fs.renameSync(dbPath, bak); console.log(`[db] ficheiro local sem metadados Turso → backup em ${bak}`); } catch {}
      try { fs.rmSync(`${dbPath}-shm`, { force: true }); fs.rmSync(`${dbPath}-wal`, { force: true }); } catch {}
      _db = openReplica();
    } else throw e;
  }
  // 1º sync OBRIGATÓRIO: ficheiro vazio nunca faz pull sozinho.
  // Sem isto: registo ok (vai ao primário) mas arranque limpo parece vazio.
  try {
    _db.sync();
    console.log('[db] sync inicial Turso ok');
  } catch (e: any) {
    console.warn('[db] sync inicial falhou (segue com réplica local):', e?.message || e);
  }
  // pull periódico para apanhar escritas de outras instâncias (pagamentos aprovados, etc.)
  const iv = setInterval(() => {
    try { _db.sync(); } catch (e: any) {
      console.warn('[db] sync periódico falhou:', e?.message || e);
    }
  }, SYNC_PERIOD_SEC * 1000);
  (iv as any).unref?.();
} else {
  const { DatabaseSync } = await import('node:sqlite');
  if (!TURSO_URL && process.env.NODE_ENV === 'production') {
    console.log('[db] modo local (sem TURSO_* — define TURSO_DATABASE_URL + TURSO_AUTH_TOKEN para persistência real)');
  }
  _db = new DatabaseSync(dbPath);
}

export const db = _db as {
  prepare(sql: string): { get(...p: any[]): any; all(...p: any[]): any[]; run(...p: any[]): { changes: number | bigint }; };
  exec(sql: string): void;
  close(): void;
};

/** Força um pull/push imediato. No modo local é no-op. */
export function syncNow(label = 'manual') {
  if (!isTurso()) return;
  try {
    (_db as any).sync();
  } catch (e: any) {
    console.warn(`[db] sync(${label}) falhou:`, e?.message || e);
  }
}

// concorrência: WAL + espera em vez de "database is locked"
try {
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;`);
} catch (e: any) {
  console.warn('[db] pragma falhou:', e?.message);
}

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

// DDL vai ao primário; faz sync para a réplica refletir de imediato.
if (isTurso()) syncNow('ddl');

if (process.env.NODE_ENV === 'production' && !isTurso() && !process.env.SQLITE_PATH) {
  console.warn('[db] SQLITE_PATH não definido em produção — a usar ./data.db (efémero no Render Free; o snapshot R2 repõe no arranque). Define SQLITE_PATH=/data/data.db com disco, se um dia tiveres volume.');
}
if (process.env.NODE_ENV === 'production' && !isTurso() && !r2Configured()) {
  console.warn('[db] R2_* sem configurar e sem Turso — SEM persistência: cada restart perde users/pagamentos. Define TURSO_* (recomendado) ou R2_* (ver DEPLOY.md).');
}
