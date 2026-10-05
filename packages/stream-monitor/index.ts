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

export interface CodecProbe {
  videoCodec: string | null; // 'avc' | 'hevc' | 'mpeg2video' | 'mpeg1video' | null
  audioCodec: string | null; // 'aac' | 'mp3' | 'ac3' | null
}

// Tipos de stream MPEG-TS (PAT/PMT) → nomes curtos. Só o vídeo interessa
// para compatibilidade: browsers (MSE/hls.js) só decodificam avc/hevc.
const TS_VIDEO: Record<number, string> = { 0x01: 'mpeg1video', 0x02: 'mpeg2video', 0x1b: 'avc', 0x24: 'hevc' };
const TS_AUDIO: Record<number, string> = { 0x03: 'mp3', 0x04: 'mp3', 0x0f: 'aac', 0x11: 'aac', 0x81: 'ac3', 0x87: 'eac3' };

function parsePmtTypes(seg: Uint8Array): { video: number[]; audio: number[] } {
  const PKT = 188;
  const n = Math.floor(seg.length / PKT);
  let pmtPid = -1;
  for (let i = 0; i < n && pmtPid < 0; i++) {
    const o = i * PKT;
    if (seg[o] !== 0x47) continue;
    if ((((seg[o + 1] & 0x1f) << 8) | seg[o + 2]) !== 0) continue;
    try {
      const pbf = seg[o + 3] & 0x20 ? seg[o + 4] + 1 : 0;
      const s = o + 4 + pbf + 1;
      const secLen = ((seg[s + 1] & 0x0f) << 8) | seg[s + 2];
      const nprog = Math.floor((secLen - 9) / 4);
      const last = s + 8 + (nprog - 1) * 4;
      pmtPid = ((seg[last + 2] & 0x1f) << 8) | seg[last + 3];
    } catch { /* pacote parcial */ }
  }
  const out = { video: [] as number[], audio: [] as number[] };
  if (pmtPid < 0) return out;
  for (let i = 0; i < n; i++) {
    const o = i * PKT;
    if (seg[o] !== 0x47) continue;
    if ((((seg[o + 1] & 0x1f) << 8) | seg[o + 2]) !== pmtPid) continue;
    try {
      const pbf = seg[o + 3] & 0x20 ? seg[o + 4] + 1 : 0;
      const s = o + 4 + pbf + 1;
      const secLen = ((seg[s + 1] & 0x0f) << 8) | seg[s + 2];
      const progLen = ((seg[s + 10] & 0x0f) << 8) | seg[s + 11];
      let p = s + 12 + progLen;
      const end = s + 3 + secLen - 4;
      while (p + 4 < end && p + 4 < seg.length) {
        const st = seg[p];
        const il = ((seg[p + 3] & 0x03) << 8) | seg[p + 4];
        if (TS_VIDEO[st]) out.video.push(st);
        if (TS_AUDIO[st]) out.audio.push(st);
        p += 5 + il;
      }
      break;
    } catch { break; }
  }
  return out;
}

async function readBytes(res: Response, maxBytes = 262144): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); total += value.length; }
      if (total >= maxBytes) break;
    }
  } finally {
    try { await reader.cancel(); } catch { /* noop */ }
  }
  const out = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const n = Math.min(c.length, out.length - off);
    out.set(c.subarray(0, n), off);
    off += n;
    if (off >= out.length) break;
  }
  return out;
}

// Sonda leve de codecs: playlist → 1º segmento (~256KB) → tipos da PMT.
// Devolve nulls quando não dá para determinar (playlist variante cifrada,
// segmento inacessível, etc.) — nunca lança.
export async function probeCodecs(url: string, budgetMs = 12000): Promise<CodecProbe> {
  const none: CodecProbe = { videoCodec: null, audioCodec: null };
  const t0 = Date.now();
  const remain = () => Math.max(2000, budgetMs - (Date.now() - t0));
  try {
    const g = timeoutSignal(remain());
    const res = await fetch(url, { signal: g.signal, redirect: 'follow', headers: { 'User-Agent': 'KutsakaiTV/1.0' } } as any);
    if (!res.ok) { g.done(); return none; }
    const head = await readFirstChunk(res);
    g.done();
    let playlistUrl = url;
    let first = firstMediaUri(url, head, false);
    if (first === 'VARIANT') {
      const g2 = timeoutSignal(remain());
      const vr = await fetch(url, { signal: g2.signal, redirect: 'follow', headers: { 'User-Agent': 'KutsakaiTV/1.0' } } as any);
      const vtext = await readFirstChunk(vr);
      g2.done();
      first = firstMediaUri(url, vtext, true);
      if (first && first.toLowerCase().split(/[?#]/)[0].endsWith('.m3u8')) {
        playlistUrl = first;
        const g3 = timeoutSignal(remain());
        const pr = await fetch(first, { signal: g3.signal, redirect: 'follow', headers: { 'User-Agent': 'KutsakaiTV/1.0' } } as any);
        const ptext = await readFirstChunk(pr);
        g3.done();
        void playlistUrl;
        first = firstMediaUri(first, ptext, true);
      }
    }
    if (!first || first === 'VARIANT') return none;
    const g4 = timeoutSignal(remain());
    const seg = await fetch(first, { signal: g4.signal, redirect: 'follow', headers: { 'User-Agent': 'KutsakaiTV/1.0' } } as any);
    if (!seg.ok) { g4.done(); return none; }
    const bytes = await readBytes(seg);
    g4.done();
    if (bytes.length < 188 * 8) return none;
    const types = parsePmtTypes(bytes);
    return {
      videoCodec: types.video.length ? (TS_VIDEO[types.video[0]] || null) : null,
      audioCodec: types.audio.length ? (TS_AUDIO[types.audio[0]] || null) : null,
    };
  } catch { return none; }
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
