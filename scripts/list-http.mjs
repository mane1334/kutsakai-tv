import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const db = new DatabaseSync('apps/api/data.db', { readOnly: true });
const rows = db.prepare(
  `SELECT name, status, access_level, reliability_score, stream_url
   FROM channels
   WHERE lower(trim(stream_url)) LIKE 'http://%'
   ORDER BY CASE status WHEN 'online' THEN 0 WHEN 'degraded' THEN 1 WHEN 'unknown' THEN 2 ELSE 3 END,
            reliability_score DESC, name`
).all();
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = ['name;status;access_level;reliability;stream_url',
  ...rows.map((r) => [r.name, r.status, r.access_level, r.reliability_score, r.stream_url].map(esc).join(';'))].join('\n');
fs.writeFileSync('scripts/http-channels.csv', csv);
const byStatus = {};
for (const r of rows) byStatus[r.status || 'null'] = (byStatus[r.status || 'null'] || 0) + 1;
console.log(JSON.stringify({ rows: rows.length, byStatus }, null, 2));
console.log('--- ONLINE (tocam hoje via relay) ---');
for (const r of rows.filter((x) => x.status === 'online')) console.log(`- ${r.name} [${r.access_level}] :: ${r.stream_url}`);
db.close();
