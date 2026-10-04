import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), '..', 'api', 'data.db');
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000; PRAGMA synchronous=NORMAL;`);
db.exec(`CREATE TABLE IF NOT EXISTS epg_programs (id TEXT PRIMARY KEY, channel_name TEXT, title TEXT, start TEXT, stop TEXT, description TEXT);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_epg_channel ON epg_programs(channel_name);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_epg_time ON epg_programs(start, stop);`);

const GUIDES = [
  'https://iptv-epg.org/files/epg-pt.xml',
  'https://iptv-epg.org/files/epg-br.xml',
  'https://iptv-epg.org/files/epg-za.xml',
  'https://iptv-epg.org/files/epg-mz.xml',
];

function parseTime(s: string): string | null {
  // "20260930180000 +0000" -> ISO
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:00`;
}

let total = 0;
function withRetry(fn: () => void, tries = 5) {
  let last: any = null;
  for (let i = 0; i < tries; i++) {
    try { fn(); return; } catch (e: any) {
      last = e;
      if (!String(e?.message || e).includes('locked')) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * (i + 1));
    }
  }
  throw last;
}
withRetry(() => db.exec("DELETE FROM epg_programs WHERE stop < datetime('now','-1 day')"));
for (const url of GUIDES) {
  console.log('fetch', url);
  try {
    const res = await fetch(url);
    if (!res.ok) { console.log('skip', res.status); continue; }
    const xml = await res.text();
    const progRe = /<programme\s+([^>]+)>([\s\S]*?)<\/programme>/g;
    const ins = db.prepare('INSERT OR IGNORE INTO epg_programs (id,channel_name,title,start,stop,description) VALUES (?,?,?,?,?,?)');
    let n = 0;
    let m: RegExpExecArray | null;
    while ((m = progRe.exec(xml)) && n < 12000) {
      const attrs = m[1], body = m[2];
      const ch = /channel="([^"]+)"/.exec(attrs)?.[1] || '';
      const start = /start="([^"]+)"/.exec(attrs)?.[1] || '';
      const stop = /stop="([^"]+)"/.exec(attrs)?.[1] || '';
      const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(body)?.[1]?.trim().slice(0, 200) || 'Sem título';
      const desc = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(body)?.[1]?.trim().slice(0, 500) || null;
      const s = parseTime(start), e = parseTime(stop);
      if (!s || !e) continue;
      try {
        ins.run(randomUUID(), ch.slice(0, 120), title, s, e, desc);
      } catch (err: any) {
        if (!String(err?.message || err).includes('locked')) throw err;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
        ins.run(randomUUID(), ch.slice(0, 120), title, s, e, desc);
      }
      n++;
    }
    console.log(` -> ${n} programas`);
    total += n;
  } catch (e: any) { console.log('erro', e.message); }
}
console.log(`EPG DONE total=${total}`);
