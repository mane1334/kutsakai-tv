// scripts/turso-restore-json.mjs — repõe o backup JSON da produção na cloud Turso.
// O backup sai de GET /v1/admin/backup (autenticado como admin):
//   { exportedAt, tables: { users, user_preferences, channels, ... } }
// Uso:
//   TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." node scripts/turso-restore-json.mjs ./backup.json [--clean]
// --clean (recomendado na 1ª vez): apaga as tabelas na cloud ANTES de inserir,
//   para não misturar dados locais de teste (users/pagamentos/subscrições com
//   IDs de planos diferentes) com os dados reais da produção.
import fs from 'node:fs';
import { createClient } from '@libsql/client';

const file = process.argv[2];
const clean = process.argv.includes('--clean');
if (!file || !fs.existsSync(file)) { console.error('Uso: node scripts/turso-restore-json.mjs ./backup.json [--clean]'); process.exit(1); }
const incoming = JSON.parse(fs.readFileSync(file, 'utf8'));
const tables = incoming.tables || incoming;
const ORDER = ['users','user_preferences','channels','favorites','watch_history','user_channel_events','recommendations','subscriptions','stream_checks','refresh_tokens','epg_programs','plans','plan_channels','payments'];

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

if (clean) {
  console.log('Limpando tabelas na cloud…');
  for (const t of [...ORDER].reverse()) {
    try { await db.execute(`DELETE FROM ${t}`); console.log(`- ${t}: limpa`); }
    catch (e) { console.log(`- ${t}: skip (${String(e?.message || e).slice(0, 80)})`); }
  }
}
let total = 0;
for (const t of ORDER) {
  const rows = Array.isArray(tables[t]) ? tables[t] : [];
  if (!rows.length) { console.log(`- ${t}: 0 linhas no backup`); continue; }
  const cols = Object.keys(rows[0]);
  const sql = `INSERT OR REPLACE INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  let n = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await db.batch(chunk.map((r) => ({ sql, args: cols.map((c) => r[c] ?? null) })));
    n += chunk.length;
    process.stdout.write(`\r- ${t}: ${n}/${rows.length}`);
  }
  console.log('');
  total += n;
}
// marca codecs já diagnosticados (browsers não decodificam mpeg2video)
await db.execute({ sql: `UPDATE channels SET codec='mpeg2video' WHERE id=?`, args: ['fe22e8c7-1160-aac0-1241-5c5cd9613660'] }).catch(() => {});
console.log(`DONE total=${total} — corre scripts/turso-verify.mjs contra o backup para confirmar`);
