// Auto-seed para free tier sem Shell (ex. Render Free).
// Se a tabela channels estiver vazia, importa as listas iptv-org em background
// logo após o arranque. Desliga com AUTO_SEED=0.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { parseM3U, dedupByUrl } from '../../../packages/m3u-parser/index.js';

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

const AFRICA = new Set(['mz', 'ao', 'cv', 'gw', 'st', 'za', 'zm', 'zw', 'na', 'bw', 'sz', 'ls', 'mg', 'mu', 'km', 'sc', 'tz', 'ke', 'ug', 'rw', 'bi', 'et', 'so', 'dj', 'sd', 'ss', 'eg', 'ly', 'tn', 'dz', 'ma', 'mr', 'ml', 'sn', 'gm', 'gn', 'sl', 'lr', 'ci', 'bf', 'ne', 'tg', 'bj', 'ng', 'gh', 'cm', 'cf', 'td', 'cg', 'cd', 'ga', 'gq']);
const EUROPA = new Set(['pt', 'es', 'fr', 'uk', 'de', 'it', 'nl', 'be', 'lu', 'ie', 'ch', 'at', 'pl', 'cz', 'sk', 'hu', 'ro', 'bg', 'gr', 'hr', 'si', 'rs', 'ba', 'mk', 'al', 'se', 'no', 'dk', 'fi', 'is', 'ee', 'lv', 'lt', 'ua', 'md', 'by', 'ru', 'tr', 'cy', 'mt']);
const AMERICA = new Set(['br', 'us', 'ca', 'mx', 'ar', 'cl', 'co', 've', 'pe', 'uy', 'py', 'bo', 'ec', 'pa', 'cr', 'cu', 'do', 'jm', 'ht', 'pr', 'gt', 'hn', 'sv', 'ni']);

function countryFromUrl(src: string): string | null {
  const m = /countries\/([a-z]{2})\.m3u/.exec(src);
  return m ? m[1] : null;
}
function regionFromCountry(cc: string | null): string | null {
  if (!cc) return null;
  const c = cc.toLowerCase();
  if (AFRICA.has(c)) return 'africa';
  if (EUROPA.has(c)) return 'europa';
  if (AMERICA.has(c)) return 'america';
  return null;
}

let running = false;

export async function autoSeedIfEmpty() {
  if (process.env.AUTO_SEED === '0') return;
  if (running) return;
  let count = 0;
  try {
    count = (db.prepare('SELECT COUNT(*) n FROM channels').get() as any).n;
  } catch { return; }
  if (count > 0) {
    console.log(`[seed] ${count} canais já na DB, skip`);
    return;
  }
  running = true;
  console.log('[seed] DB vazia — a importar listas iptv-org em background...');
  let total = 0;
  for (const src of SOURCES) {
    try {
      const res = await fetch(src);
      if (!res.ok) { console.log('[seed] skip', src, res.status); continue; }
      const text = await res.text();
      const items = dedupByUrl(parseM3U(text));
      const country = countryFromUrl(src);
      const region = regionFromCountry(country);
      const stmt = db.prepare(`INSERT INTO channels (id,name,logo,stream_url,country,region,languages,categories,status)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(stream_url) DO UPDATE SET name=excluded.name, logo=excluded.logo, country=COALESCE(channels.country,excluded.country), region=COALESCE(channels.region,excluded.region)`);
      let n = 0;
      for (const it of items) {
        const langs: string[] = src.includes('/languages/') ? [src.split('/').pop()!.replace('.m3u', '')] : [];
        const cats: string[] = src.includes('/categories/') ? [src.split('/').pop()!.replace('.m3u', '')] : ((it as any).groupTitle ? [(it as any).groupTitle] : []);
        stmt.run(randomUUID(), (it as any).name, (it as any).logo || null, (it as any).url, country, region, JSON.stringify(langs), JSON.stringify(cats), 'unknown');
        n++;
      }
      total += n;
      console.log(`[seed] ${src} -> ${n}`);
    } catch (e: any) { console.log('[seed] erro', src, e?.message); }
  }
  console.log(`[seed] DONE total=${total}`);
  running = false;
}
