export interface ParsedChannel {
  name: string;
  logo?: string;
  groupTitle?: string;
  tvgId?: string;
  url: string;
}

function splitName(line: string): string {
  // vírgula separadora é a última vírgula FORA de aspas (user-agent tem vírgula dentro de aspas)
  let inQ = false, idx = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) idx = i;
  }
  return idx >= 0 ? line.slice(idx + 1).trim() : '';
}

export function parseM3U(content: string): ParsedChannel[] {
  const lines = content.split(/\r?\n/);
  const out: ParsedChannel[] = [];
  let meta: ParsedChannel | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF')) {
      const name = splitName(line);
      const logo = /tvg-logo="([^"]*)"/.exec(line)?.[1];
      const groupTitle = /group-title="([^"]*)"/.exec(line)?.[1];
      const tvgId = /tvg-id="([^"]*)"/.exec(line)?.[1];
      meta = { name, logo, groupTitle, tvgId, url: '' };
    } else if (line && !line.startsWith('#') && meta) {
      meta.url = line;
      if (meta.name && meta.url && !meta.name.includes('like Gecko')) out.push(meta);
      meta = null;
    }
  }
  return out;
}

const COUNTRY_LANG: Record<string, string[]> = {
  mz: ['por'], ao: ['por'], pt: ['por'], br: ['por'],
  us: ['eng'], gb: ['eng'], uk: ['eng'], ca: ['eng'], au: ['eng'], ie: ['eng'], za: ['eng'],
  es: ['spa'], mx: ['spa'], ar: ['spa'], co: ['spa'],
  fr: ['fra'], de: ['deu'], it: ['ita'],
};

export function inferLanguages(country: string | null, explicit: string[]): string[] {
  if (explicit.length) return [...new Set(explicit.map((l) => l.toLowerCase()))];
  if (country && COUNTRY_LANG[country.toLowerCase()]) return COUNTRY_LANG[country.toLowerCase()];
  return [];
}

export function normCat(c: string): string {
  return c.trim().toLowerCase();
}

export function dedupByUrl(channels: ParsedChannel[]): ParsedChannel[] {
  const seen = new Set<string>();
  return channels.filter((c) => {
    const key = c.url.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
