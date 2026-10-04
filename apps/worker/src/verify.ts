import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { checkStream } from '../../../packages/stream-monitor/index.js';

// Verificação profunda: prova o 1º segmento (corrige "offline" que funciona).
// Ordem: offline primeiro, depois os há mais tempo sem verificar.
const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), '..', 'api', 'data.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');

const LIMIT = parseInt(process.env.VERIFY_LIMIT || '100');
const rows: any[] = db.prepare(`
  SELECT * FROM channels
  ORDER BY CASE WHEN status='offline' THEN 0 ELSE 1 END, last_checked ASC
  LIMIT ?`).all(LIMIT) as any[];

console.log(`verifying ${rows.length} canais (deep)...`);
let fixed = 0, online = 0;
for (const c of rows) {
  const before = c.status;
  const r = await checkStream(c.stream_url);
  db.prepare(`INSERT INTO stream_checks (id,channel_id,status,latency_ms,error) VALUES (?,?,?,?,?)`)
    .run(randomUUID(), c.id, r.status, r.latencyMs || null, r.error || null);
  const week: any = db.prepare(`SELECT COUNT(*) t, SUM(CASE WHEN status='online' THEN 1 ELSE 0 END) o FROM stream_checks WHERE channel_id=? AND checked_at > datetime('now','-7 days')`).get(c.id) as any;
  const rel = week?.t ? (100 * (week.o || 0)) / week.t : (r.status === 'online' ? 100 : 0);
  db.prepare(`UPDATE channels SET status=?, reliability_score=?, last_checked=datetime('now') WHERE id=?`).run(r.status, rel, c.id);
  if (before === 'offline' && r.status !== 'offline') fixed++;
  if (r.status === 'online') online++;
  console.log(`${before} -> ${r.status} ${r.provedBySegment ? '[segmento]' : ''} ${c.name}${r.error ? ` (${r.error})` : ''}`);
}
console.log(`VERIFY DONE online=${online}/${rows.length} corrigidos=${fixed}`);
