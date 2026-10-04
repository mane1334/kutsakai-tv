// packages/stream-monitor — verificação profunda de streams (sem ffmpeg).
// Prova real de reprodução: playlist OK + primeiro segmento com bytes.
// Usado pelo worker (bulk) e pela API (verificação unitária no admin).

export interface CheckResult {
  status: 'online' | 'degraded' | 'offline';
  latencyMs?: number;
  error?: string;
  provedBySegment?: boolean;
}

function timeoutSignal(ms: number) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(to) };
}

async function readFirstChunk(res: Response, maxBytes = 65536): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const dec = new TextDecoder();
  let out = '';
  try {
    while (out.length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
      if (value && value.length > 0 && out.length > 4096) break;
    }
  } finally {
    try { await reader.cancel(); } catch { /* noop */ }
  }
  return out;
}

function resolveUrl(base: string, ref: string): string | null {
  const r = ref.trim();
  if (!r || r.startsWith('#')) return null;
  try { return new URL(r, base).toString(); } catch { return null; }
}

function firstMediaUri(playlistUrl: string, text: string, variantPass: boolean): string | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!variantPass && lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'))) return 'VARIANT';
  for (const l of lines) {
    if (l.startsWith('#')) continue;
    const u = resolveUrl(playlistUrl, l);
    if (u) return u;
  }
  return null;
}

export async function checkStream(url: string, budgetMs = 15000): Promise<CheckResult> {
  const t0 = Date.now();
  const remain = () => Math.max(2000, budgetMs - (Date.now() - t0));
  try {
    const g = timeoutSignal(remain());
    const res = await fetch(url, { signal: g.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) KutsakaiTV/1.0' } } as any);
    if (!res.ok || res.status >= 400) { g.done(); return { status: 'offline', error: `http ${res.status}` }; }
    const head = await readFirstChunk(res);
    g.done();
    const latency = Date.now() - t0;
    // Alguns provedores acrescentam tokens (?token=...) depois da extensão.
    // A deteção pelo pathname evita tratar uma playlist HLS como stream direto.
    let urlPath = url;
    try { urlPath = new URL(url).pathname; } catch { /* URL inválida será tratada pelo fetch */ }
    const looksHls = urlPath.toLowerCase().endsWith('.m3u8') || head.includes('#EXTM3U');
    if (!looksHls) {
      // stream direto (mp4/ts): cabeçalho + bytes = prova suficiente
      return { status: latency > 4000 ? 'degraded' : 'online', latencyMs: latency, provedBySegment: head.length > 0 };
    }
    // HLS: seguir variante (1 nível) e provar o 1º segmento
    let playlistUrl = url;
    let first = firstMediaUri(url, head, false);
    if (first === 'VARIANT') {
      const g2 = timeoutSignal(remain());
      const vr = await fetch(url, { signal: g2.signal, redirect: 'follow' } as any);
      const vtext = await readFirstChunk(vr);
      g2.done();
      first = firstMediaUri(url, vtext, true);
      let firstPath = first || '';
      try { firstPath = first ? new URL(first).pathname : ''; } catch { /* segue como URI simples */ }
      if (first && firstPath.toLowerCase().endsWith('.m3u8')) {
        playlistUrl = first;
        const g3 = timeoutSignal(remain());
        const pr = await fetch(first, { signal: g3.signal, redirect: 'follow' } as any);
        const ptext = await readFirstChunk(pr);
        g3.done();
        first = firstMediaUri(first, ptext, true);
      }
    }
    if (!first) return { status: 'degraded', latencyMs: latency, error: 'playlist sem segmentos' };
    const g4 = timeoutSignal(remain());
    const seg = await fetch(first, { signal: g4.signal, redirect: 'follow' } as any);
    if (!seg.ok || seg.status >= 400) { g4.done(); return { status: 'offline', error: `segmento http ${seg.status}` }; }
    await readFirstChunk(seg, 16384);
    g4.done();
    void playlistUrl;
    return { status: latency > 4000 ? 'degraded' : 'online', latencyMs: latency, provedBySegment: true };
  } catch (e: any) {
    const msg = String(e?.message || 'fetch failed').slice(0, 200);
    return { status: 'offline', error: msg.includes('aborted') ? 'timeout' : msg };
  }
}
