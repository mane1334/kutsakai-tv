import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), '..', 'api', 'data.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');

db.exec(`CREATE TABLE IF NOT EXISTS stream_checks (
  id TEXT PRIMARY KEY, channel_id TEXT, checked_at TEXT DEFAULT (datetime('now')),
  status TEXT, latency_ms INTEGER, resolution TEXT, bitrate INTEGER, error TEXT
);`);

const LIMIT = parseInt(process.env.MONITOR_LIMIT || '120');
const rows: any[] = db.prepare(`SELECT * FROM channels WHERE status != 'offline' ORDER BY last_checked ASC LIMIT ?`).all(LIMIT) as any[];

console.log(`checking ${rows.length} canais...`);
for (const c of rows) {
  const t0 = Date.now();
  let status = 'offline', error: string | null = null;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(c.stream_url, { method: 'GET', signal: ctrl.signal, redirect: 'follow' } as any);
    clearTimeout(to);
    const ms = Date.now() - t0;
    if (res.ok || (res.status >= 200 && res.status < 400)) {
      status = ms > 3000 ? 'degraded' : 'online';
      try { (res as any).body?.cancel?.(); } catch {}
      db.prepare(`INSERT INTO stream_checks (id,channel_id,status,latency_ms) VALUES (?,?,?,?)`).run(randomUUID(), c.id, status, ms);
    } else {
      error = `http ${res.status}`;
      db.prepare(`INSERT INTO stream_checks (id,channel_id,status,error) VALUES (?,?,?,?)`).run(randomUUID(), c.id, 'offline', error);
    }
  } catch (e: any) {
    error = String(e.message || 'fetch failed').slice(0, 200);
    db.prepare(`INSERT INTO stream_checks (id,channel_id,status,error) VALUES (?,?,?,?)`).run(randomUUID(), c.id, 'offline', error);
  }
  const week: any = db.prepare(`SELECT COUNT(*) t, SUM(CASE WHEN status='online' THEN 1 ELSE 0 END) o FROM stream_checks WHERE channel_id=? AND checked_at > datetime('now','-7 days')`).get(c.id) as any;
  const rel = week?.t ? (100 * (week.o || 0)) / week.t : (status === 'online' ? 100 : 0);
  db.prepare(`UPDATE channels SET status=?, reliability_score=?, last_checked=datetime('now') WHERE id=?`).run(status, rel, c.id);
  console.log(`${status} ${c.name}`);
}
console.log('MONITOR DONE');
