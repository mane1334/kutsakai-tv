import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseM3U, dedupByUrl } from '../../../packages/m3u-parser/index.js';

const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), '..', 'api', 'data.db');
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000; PRAGMA synchronous=NORMAL;`);

db.exec(`CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, logo TEXT, stream_url TEXT UNIQUE NOT NULL,
  country TEXT, region TEXT, languages TEXT DEFAULT '[]', categories TEXT DEFAULT '[]',
  resolution TEXT, bitrate INTEGER, codec TEXT, status TEXT DEFAULT 'unknown',
  reliability_score REAL DEFAULT 0, last_checked TEXT, updated_at TEXT DEFAULT (datetime('now'))
);`);

const SOURCES = [
  'https://iptv-org.github.io/iptv/countries/mz.m3u',
  'https://iptv-org.github.io/iptv/countries/ao.m3u',
  'https://iptv-org.github.io/iptv/countries/pt.m3u',
  'https://iptv-org.github.io/iptv/countries/br.m3u',
  'https://iptv-org.github.io/iptv/languages/por.m3u',
  'https://iptv-org.github.io/iptv/languages/eng.m3u',
  'https://iptv-org.github.io/iptv/categories/news.m3u',
  'https://iptv-org.github.io/iptv/categories/sports.m3u',
  'https://iptv-org.github.io/iptv/categories/movies.m3u',
  'https://iptv-org.github.io/iptv/categories/documentary.m3u',
];

function channelId(streamUrl: string): string {
  const h = createHash('sha256').update(streamUrl.trim()).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function countryFromUrl(src: string): string | null {
  const m = /countries\/([a-z]{2})\.m3u/.exec(src);
  return m ? m[1] : null;
}

// país -> região (as 3 regiões do onboarding/catálogo)
const AFRICA = new Set(['mz', 'ao', 'cv', 'gw', 'st', 'za', 'zm', 'zw', 'na', 'bw', 'sz', 'ls', 'mg', 'mu', 'km', 'sc', 'tz', 'ke', 'ug', 'rw', 'bi', 'et', 'so', 'dj', 'sd', 'ss', 'eg', 'ly', 'tn', 'dz', 'ma', 'mr', 'ml', 'sn', 'gm', 'gn', 'sl', 'lr', 'ci', 'bf', 'ne', 'tg', 'bj', 'ng', 'gh', 'cm', 'cf', 'td', 'cg', 'cd', 'ga', 'gq']);
const EUROPA = new Set(['pt', 'es', 'fr', 'uk', 'de', 'it', 'nl', 'be', 'lu', 'ie', 'ch', 'at', 'pl', 'cz', 'sk', 'hu', 'ro', 'bg', 'gr', 'hr', 'si', 'rs', 'ba', 'mk', 'al', 'se', 'no', 'dk', 'fi', 'is', 'ee', 'lv', 'lt', 'ua', 'md', 'by', 'ru', 'tr', 'cy', 'mt']);
const AMERICA = new Set(['br', 'us', 'ca', 'mx', 'ar', 'cl', 'co', 've', 'pe', 'uy', 'py', 'bo', 'ec', 'pa', 'cr', 'cu', 'do', 'jm', 'ht', 'pr', 'gt', 'hn', 'sv', 'ni']);

export function regionFromCountry(cc: string | null): string | null {
  if (!cc) return null;
  const c = cc.toLowerCase();
  if (AFRICA.has(c)) return 'africa';
  if (EUROPA.has(c)) return 'europa';
  if (AMERICA.has(c)) return 'america';
  return null;
}

let total = 0;
for (const src of SOURCES) {
  console.log('fetch', src);
  try {
    const res = await fetch(src);
    if (!res.ok) { console.log('skip', src, res.status); continue; }
    const text = await res.text();
    const items = dedupByUrl(parseM3U(text));
    const country = countryFromUrl(src);
    const region = regionFromCountry(country);
    const stmt = db.prepare(`INSERT INTO channels (id,name,logo,stream_url,country,region,languages,categories,status)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(stream_url) DO UPDATE SET id=excluded.id, name=excluded.name, logo=excluded.logo, country=COALESCE(channels.country,excluded.country), region=COALESCE(channels.region,excluded.region)`);
    let n = 0;
    for (const it of items) {
      const langs: string[] = src.includes('/languages/') ? [src.split('/').pop()!.replace('.m3u', '')] : [];
      const cats: string[] = src.includes('/categories/') ? [src.split('/').pop()!.replace('.m3u', '')] : (it.groupTitle ? [it.groupTitle] : []);
      const streamUrl = it.url.trim();
      stmt.run(channelId(streamUrl), it.name, it.logo || null, streamUrl, country, region, JSON.stringify(langs), JSON.stringify(cats), 'unknown');
      n++;
    }
    console.log(` -> ${n} canais`);
    total += n;
  } catch (e: any) { console.log('erro', src, e.message); }
}
console.log(`SYNC DONE total=${total}`);
