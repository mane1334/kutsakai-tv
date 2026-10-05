// scripts/turso-verify.mjs — compara contagens local vs Turso Cloud.
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';

const local = new DatabaseSync(process.env.SQLITE_PATH || 'apps/api/data.db');
const remote = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const TABLES = ['users','user_preferences','channels','favorites','watch_history','user_channel_events','subscriptions','stream_checks','refresh_tokens','epg_programs','plans','plan_channels','payments'];
for (const t of TABLES) {
  let ln = '—';
  try { ln = local.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; } catch {}
  let rn = '—';
  try { rn = (await remote.execute(`SELECT COUNT(*) n FROM ${t}`)).rows[0].n; }
  catch (e) { rn = 'ERRO:' + String(e?.message || e).slice(0, 60); }
  console.log(String(ln) === String(rn) ? 'OK    ' : 'DIFERE', t.padEnd(22), 'local=' + ln, 'turso=' + rn);
}
try { local.close(); } catch {}
