// scripts/turso-push.mjs — migração única: data.db local -> Turso Cloud (via batch).
// Uso:
//   TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." SQLITE_PATH=apps/api/data.db node scripts/turso-push.mjs
// Idempotente (INSERT OR REPLACE): podes correr 2x.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';

const TURSO_URL = process.env.TURSO_DATABASE_URL || '';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || '';
if (!TURSO_URL || !TURSO_TOKEN) { console.error('Falta TURSO_*'); process.exit(1); }
const localPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data.db');
if (!fs.existsSync(localPath)) { console.error(`Local não encontrado: ${localPath}`); process.exit(1); }

const TABLES = ['users','user_preferences','channels','favorites','watch_history','user_channel_events','recommendations','subscriptions','stream_checks','refresh_tokens','epg_programs','plans','plan_channels','payments'];
const SKIP = new Set(String(process.env.SKIP_TABLES || '').split(',').map((s) => s.trim()).filter(Boolean));

const local = new DatabaseSync(localPath);
const remote = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

// 1. schema (igual ao db.ts) — CREATE TABLE/INDEX IF NOT EXISTS
const tables = local.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL`).all();
for (const r of tables) {
  try { await remote.execute(r.sql); }
  catch (e) { console.warn('schema skip:', String(e?.message || e).slice(0, 100)); }
}
for (const r of local.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL`).all()) {
  try { await remote.execute(r.sql); } catch { /* já existe */ }
}

// 2. dados em batch de 100 (1 round-trip por batch em vez de 1 por linha)
let total = 0;
for (const t of TABLES) {
  if (SKIP.has(t)) { console.log(`- ${t}: skip (SKIP_TABLES)`); continue; }
  let rows = [];
  try { rows = local.prepare(`SELECT * FROM ${t}`).all(); }
  catch { console.log(`- ${t}: ausente, skip`); continue; }
  if (!rows.length) { console.log(`- ${t}: 0 linhas`); continue; }
  const cols = Object.keys(rows[0]);
  const ph = `(${cols.map(() => '?').join(',')})`;
  const sql = `INSERT OR REPLACE INTO ${t} (${cols.join(',')}) VALUES ${ph}`;
  let n = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    try {
      await remote.batch(chunk.map((r) => ({ sql, args: cols.map((c) => r[c] ?? null) })));
      n += chunk.length;
      process.stdout.write(`\r- ${t}: ${n}/${rows.length}`);
    } catch (e) {
      console.error(`\n- ${t}: batch falhou em ${n}:`, String(e?.message || e).slice(0, 200));
      break;
    }
  }
  console.log('');
  total += n;
}
console.log(`DONE total=${total}`);
try { local.close(); } catch {}
