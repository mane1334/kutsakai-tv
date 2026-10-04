"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Hls from 'hls.js';
import { API, apiGet, authFetch, logout, tryRefresh, tokenExpiring } from '../../lib/api';

const I = {
  up: <svg viewBox="0 0 24 24"><path d="M6 14l6-6 6 6" /></svg>,
  down: <svg viewBox="0 0 24 24"><path d="M6 10l6 6 6-6" /></svg>,
  play: <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>,
  pause: <svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>,
  mute: <svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4V5zM22 9l-6 6M16 9l6 6" /></svg>,
  vol: <svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" /></svg>,
  star: <svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.8-5.4 2.8 1-6.1L3.2 9.5l6.1-.9L12 3z" /></svg>,
  info: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>,
  grid: <svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>,
  x: <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>,
};

const prettyCat = (c: any) => ((c.categories?.[0] || 'geral').split(/[;/,]/)[0] || 'geral').trim().toUpperCase();
const statusChip = (s: string) =>
  s === 'online' ? <span className="chip chip-pos">NO AR</span>
  : s === 'degraded' ? <span className="chip chip-warn">INSTÁVEL</span>
  : s === 'offline' ? <span className="chip chip-neg">EM BAIXA</span>
  : <span className="chip chip-mut">A VERIFICAR</span>;

function parseT(s?: string): number | null {
  if (!s) return null;
  const t = new Date(s.replace(' ', 'T')).getTime();
  return isNaN(t) ? null : t;
}

function playableStreamUrl(raw: string): string {
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && raw.startsWith('http://')) {
    return `https://${raw.slice('http://'.length)}`;
  }
  return raw;
}

export default function TV() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [list, setList] = useState<any[]>([]);
  const [idx, setIdx] = useState(0);
  const [epg, setEpg] = useState<any>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guide, setGuide] = useState<Record<string, any>>({});
  const [guideLoading, setGuideLoading] = useState(false);
  const [favs, setFavs] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [q, setQ] = useState('');
  const [gate, setGate] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [upsell, setUpsell] = useState<null | { reason: string }>(null);
  const [fromPrice, setFromPrice] = useState<number | null>(null);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    setMobile(mq.matches);
    const fn = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const startRef = useRef<number>(Date.now());
  const infoTimer = useRef<any>(null);

  const current = list[idx] || null;
  const auth = () => (token ? { Authorization: `Bearer ${token}` } : {});
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    // o access token dura 15 min: renova ANTES de pedir lista/gate, senão o servidor
    // trata a conta paga como anónima e bloqueia os canais PREMIUM.
    const onTok = (e: any) => setToken(e?.detail || '');
    window.addEventListener('kutsakai:token', onTok);
    (async () => {
      let t = localStorage.getItem('access') || '';
      if (t && tokenExpiring(t)) t = (await tryRefresh()) || '';
      setToken(t);
      setTokenReady(true);
    })();
    return () => window.removeEventListener('kutsakai:token', onTok);
  }, []);

  useEffect(() => {
    if (!tokenReady) return; // evita lista anónima (só FREE) a sobrepor a lista autenticada
    const h: any = token ? { Authorization: `Bearer ${token}` } : {};
    const qp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const wantedId = qp?.get('channel') || null;
    if (qp?.get('guide') === '1' || qp?.get('guia') === '1') setGuideOpen(true);
    // Lista base: sem filtro de status (= online+degraded+unknown, sem offline) para igualar o catálogo.
    // Limite máximo da API é 100 por página.
    fetch(`${API}/channels?limit=100`, { headers: h }).then(r => r.json()).then(d => {
      const data = d.data || [];
      if (!wantedId) { setList(data); return; }
      const i = data.findIndex((c: any) => c.id === wantedId);
      if (i >= 0) { setList(data); setIdx(i); return; }
      // O canal pesquisado no catálogo pode estar fora do top-100: busca direta pelo id
      // e coloca-o no topo para garantir que abre o canal certo.
      fetch(`${API}/channels/${wantedId}`, { headers: h }).then(r => r.json()).then(single => {
        if (single && single.id) { setList([single, ...data]); setIdx(0); }
        else setList(data);
      }).catch(() => setList(data));
    });
    if (token) {
      fetch(`${API}/me/favorites`, { headers: auth() as any }).then(r => r.json())
        .then(d => Array.isArray(d) && setFavs(d.map((f: any) => f.id))).catch(() => {});
      fetch(`${API}/me/subscription`, { headers: auth() as any }).then(r => r.json())
        .then(s => setPaid(!!(s.active && s.plan && s.plan.duration_days > 0))).catch(() => {});
    } else setPaid(false);
    fetch(`${API}/plans`).then(r => r.json()).then(d => {
      const ps = (Array.isArray(d) ? d : []).filter((p: any) => p.duration_days > 0);
      if (ps.length) setFromPrice(Math.min(...ps.map((p: any) => p.price)));
    }).catch(() => {});
  }, [token, tokenReady]);

  // popup de upgrade a cada 5 min para quem não tem pacote pago
  useEffect(() => {
    if (paid) return;
    const t = setInterval(() => {
      if (list.length) setUpsell((u) => u || { reason: 'promo' });
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [paid, list.length]);

  const flashInfo = useCallback(() => {
    setShowInfo(true);
    clearTimeout(infoTimer.current);
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('info') === '1') return;
    infoTimer.current = setTimeout(() => setShowInfo(false), 5000);
  }, []);

  useEffect(() => {
    if (!current?.id) return;
    setGate(null);
    const isPremium = (current.access_level || 'FREE').toUpperCase() === 'PREMIUM';
    if (!isPremium) { flashInfo(); }
    else {
      authFetch(`${API}/channels/${current.id}/authorization`)
        .then(r => r.json()).then(a => {
          if (a.authorized) flashInfo();
          else { setGate(a.reason); setUpsell({ reason: a.reason }); }
        }).catch(() => { setGate('upgrade_required'); setUpsell({ reason: 'upgrade_required' }); });
    }
    fetch(`${API}/channels/${current.id}/epg`).then(r => r.json()).then(setEpg).catch(() => setEpg(null));
    if (token) fetch(`${API}/me/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth() as any) }, body: JSON.stringify({ channelId: current.id, type: 'opened' }) }).catch(() => {});
    startRef.current = Date.now();
  }, [current?.id]);

  useEffect(() => {
    if (!current || !videoRef.current || gate || !current.stream_url) return;
    const video = videoRef.current;
    let hls: any = null;
    let disposed = false;
    setStreamError(null);
    setStreamLoading(true);
    setPlaying(false);
    let networkRetries = 0;
    const streamUrl = playableStreamUrl(current.stream_url);
    const isHls = (() => {
      try { return new URL(streamUrl).pathname.toLowerCase().endsWith('.m3u8'); }
      catch { return streamUrl.toLowerCase().split(/[?#]/)[0].endsWith('.m3u8'); }
    })();
    const onError = () => {
      if (!disposed) {
        setStreamLoading(false);
        setStreamError('O sinal não respondeu. Tenta novamente ou escolhe outro canal.');
      }
    };
    const onLoaded = () => { if (!disposed) setStreamLoading(false); };
    video.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', onLoaded);
    if (Hls.isSupported() && isHls) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 1,
        levelLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 1,
      });
      hls.on(Hls.Events.ERROR, (_event: string, data: any) => {
        if (data?.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 1) {
            networkRetries += 1;
            hls.startLoad();
          }
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else onError();
        }
      });
      hls.attachMedia(video);
      hls.loadSource(streamUrl);
      video.play().catch(() => { /* autoplay pode exigir clique; os controlos continuam disponíveis */ });
    } else {
      video.src = streamUrl;
      video.load();
      video.play().catch(() => { /* autoplay pode exigir clique; os controlos continuam disponíveis */ });
    }
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      const sec = Math.round((Date.now() - startRef.current) / 1000);
      if (!token || sec < 3) return;
      fetch(`${API}/me/history`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth() as any) }, body: JSON.stringify({ channelId: current.id, durationSec: sec, dataConsumedMB: +(sec * 0.55).toFixed(2) }) }).catch(() => {});
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      disposed = true;
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', onLoaded);
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [current?.id, current?.stream_url, gate]);

  const zap = useCallback((dir: 1 | -1) => {
    setList((l) => { setIdx((i) => (i + dir + l.length) % Math.max(l.length, 1)); return l; });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowDown') { e.preventDefault(); zap(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); zap(-1); }
      else if (e.key === 'm') toggleMute();
      else if (e.key === 'i') flashInfo();
      else if (e.key === 'g') setGuideOpen((v) => !v);
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zap, playing, muted]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  };
  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };
  const toggleFav = async () => {
    if (!current || !token) return;
    if (favs.includes(current.id)) {
      await fetch(`${API}/me/favorites/${current.id}`, { method: 'DELETE', headers: auth() as any }).catch(() => {});
      setFavs(favs.filter((id) => id !== current.id));
    } else {
      await fetch(`${API}/me/favorites/${current.id}`, { method: 'POST', headers: auth() as any }).catch(() => {});
      setFavs([...favs, current.id]);
    }
  };

  // guia "agora": carrega EPG dos primeiros 40 da lista ao abrir
  useEffect(() => {
    if (!guideOpen || !list.length) return;
    const missing = list.slice(0, 40).filter((c) => !(c.id in guide));
    if (!missing.length) return;
    setGuideLoading(true);
    Promise.all(missing.map((c) =>
      fetch(`${API}/channels/${c.id}/epg`).then(r => r.json()).then(d => [c.id, d] as const).catch(() => [c.id, null] as const)
    )).then((pairs) => {
      setGuide((g) => ({ ...g, ...Object.fromEntries(pairs) }));
      setGuideLoading(false);
    });
  }, [guideOpen, list]);

  const filtered = q
    ? list.map((c, i) => ({ c, i })).filter(({ c }) => c.name.toLowerCase().includes(q.toLowerCase()))
    : list.map((c, i) => ({ c, i }));

  const now = epg?.now;
  const s = parseT(now?.start), e = parseT(now?.stop), t = Date.now();
  const prog = s && e && e > s ? Math.min(100, Math.max(0, ((t - s) / (e - s)) * 100)) : null;

  return (
    <div className="tv-root" style={mobile ? { height: 'auto', minHeight: '100vh', overflow: 'visible' } : undefined}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', flex: 'none' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 800, color: 'var(--text-primary)', textDecoration: 'none', whiteSpace: 'nowrap' }}><img src="/assets/icon.jpg" alt="Kutsakai TV" style={{ width: 24, height: 24, borderRadius: 6 }} />Kutsakai<span style={{ color: 'var(--accent)' }}> TV</span></Link>
        <span className="arch-meta tnum nav-hide-m" style={{ margin: 0 }}>SETAS ZAPPING // ESPAÇO PAUSA // M MUDO // G GUIA</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => setGuideOpen((v) => !v)} className={`rmt-btn ${guideOpen ? 'active' : ''}`} style={{ height: 38 }} title="Guia do que está a passar (G)">{I.grid}<span style={{ fontSize: 12 }}>Guia</span></button>
          <Link href="/plans" className="btn btn-secondary btn-sm nav-hide-m">Planos</Link>
          <Link href="/catalog" className="btn btn-secondary btn-sm">Catálogo</Link>
          {token ? (<><Link href="/favorites" className="btn btn-secondary btn-sm nav-hide-m">★</Link><Link href="/account/settings" className="btn btn-secondary btn-sm nav-hide-m">Conta</Link><button onClick={() => logout((h) => router.push(h))} className="btn btn-secondary btn-sm">Sair</button></>) : (<Link href="/login" className="btn btn-primary btn-sm nav-hide-m">Entrar</Link>)}
        </span>
      </header>

      <div style={{ display: 'flex', flex: mobile ? 'none' : 1, flexDirection: mobile ? 'column' : 'row', minHeight: mobile ? undefined : 0, position: 'relative' }}>
        <aside style={{ width: mobile ? '100%' : 292, minWidth: mobile ? undefined : 292, order: mobile ? 2 : undefined, borderRight: mobile ? 'none' : '1px solid var(--border-subtle)', borderTop: mobile ? '1px solid var(--border-subtle)' : 'none', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '12px 12px 8px', flex: 'none' }}>
            <span className="section-label" style={{ margin: '0 0 8px' }}>[Canais // {filtered.length}]</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="filtrar canais…" className="dl-input" />
          </div>
          <div className="no-scrollbar" style={{ overflowY: 'auto', flex: 1, minHeight: 0, maxHeight: mobile ? '38vh' : undefined, paddingBottom: 12 }}>
            {current && q && !filtered.some(({ c }) => c.id === current.id) && (
              <button key={current.id} onClick={() => setQ('')} className="chan-row active" title="A tocar agora — clica para limpar o filtro">
                <span className="tnum" style={{ fontSize: 11, color: 'var(--accent)', minWidth: 30 }}>▶</span>
                {current.logo
                  ? <img src={current.logo} alt="" loading="lazy" style={{ width: 46, height: 27, objectFit: 'contain', background: '#000', borderRadius: 5, flex: 'none' }} />
                  : <img src="/assets/icon.jpg" alt="" loading="lazy" style={{ width: 46, height: 27, objectFit: 'cover', borderRadius: 5, flex: 'none' }} />}
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{current.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>A TOCAR — LIMPAR FILTRO</span>
                </span>
              </button>
            )}
            {filtered.map(({ c, i }) => (
              <button key={c.id} onClick={() => setIdx(i)} className={`chan-row ${i === idx ? 'active' : ''}`}>
                <span className="tnum" style={{ fontSize: 11, color: 'var(--text-tertiary)', minWidth: 30 }}>{String(i + 1).padStart(3, '0')}</span>
                {c.logo
                  ? <img src={c.logo} alt="" loading="lazy" style={{ width: 46, height: 27, objectFit: 'contain', background: '#000', borderRadius: 5, flex: 'none' }} />
                  : <img src="/assets/icon.jpg" alt="" loading="lazy" style={{ width: 46, height: 27, objectFit: 'cover', borderRadius: 5, flex: 'none' }} />}
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: i === idx ? 700 : 500, color: i === idx ? 'var(--text-primary)' : 'var(--text-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: c.status === 'online' ? '#34d399' : c.status === 'degraded' ? '#fbbf24' : '#5a544a', flex: 'none' }} />
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.04em' }}>{prettyCat(c)}</span>
                  </span>
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '16px 14px', fontSize: 13, color: 'var(--text-tertiary)' }}>
                <div style={{ marginBottom: 8 }}>Nada aqui nos {list.length} carregados — a pesquisa do Modo TV só filtra o que já está carregado.</div>
                <Link href={`/catalog`} className="btn btn-secondary btn-sm">Pesquisar no catálogo completo</Link>
              </div>
            )}
          </div>
        </aside>

        <main style={{ flex: mobile ? 'none' : 1, order: mobile ? 1 : undefined, minWidth: 0, minHeight: 0, padding: mobile ? 12 : 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ flex: mobile ? 'none' : 1, minHeight: 0, background: 'linear-gradient(180deg,#1c1a17,#0b0a08)', borderRadius: 20, padding: 12, border: '1px solid var(--border-subtle)', boxShadow: 'inset 0 1px 0 rgba(255,248,230,0.10), 0 24px 80px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px 8px', flex: 'none' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.2em', color: 'var(--text-tertiary)' }}>VISION·4K</span>
              {current && <span style={{ marginLeft: 12 }}>{statusChip(current.status)}</span>}
              <span style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: '50%', background: current ? '#34d399' : '#fb7185', boxShadow: '0 0 8px currentColor' }} />
            </div>
            <div style={{ position: 'relative', flex: mobile ? 'none' : 1, minHeight: 0, aspectRatio: mobile ? '16/9' : undefined, background: '#000', borderRadius: 12, overflow: 'hidden' }}>
              {gate ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>sinal codificado — plano necessário</div>
              ) : current
                ? <>
                  <video ref={videoRef} controls playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
                  {streamLoading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.42)', color: 'var(--text-body)', fontSize: 13 }}>a ligar ao sinal…</div>}
                  {streamError && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(0,0,0,0.72)', color: 'var(--text-body)', fontSize: 13, textAlign: 'center' }}><span>{streamError}</span><button onClick={() => setStreamError(null)} className="btn btn-secondary btn-sm">Fechar aviso</button></div>}
                </>
                : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>a sintonizar…</div>}
              {current && showInfo && (
                <div className="glass-panel" style={{ position: 'absolute', left: 14, right: 14, bottom: 14, padding: '14px 18px', borderRadius: 14 }}>
                  <div className="tnum" style={{ fontSize: 12, color: 'var(--accent)' }}>{String(idx + 1).padStart(3, '0')} // {prettyCat(current)}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{current.name}</div>
                  {now ? (
                    <>
                      <div style={{ fontSize: 13, color: 'var(--text-body)', marginTop: 2 }}>{now.start?.slice(11, 16)} — {now.stop?.slice(11, 16)} · {now.title}</div>
                      {prog !== null && <div style={{ height: 3, background: 'rgba(255,255,255,0.12)', borderRadius: 99, marginTop: 8 }}><div style={{ width: `${prog}%`, height: '100%', background: 'var(--accent)', borderRadius: 99 }} /></div>}
                    </>
                  ) : <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Sem guia para este canal</div>}
                  {epg?.next?.[0] && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>A seguir: {epg.next[0].title}</div>}
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flex: 'none', borderRadius: 14 }}>
            <button onClick={() => zap(-1)} className="rmt-btn" title="Canal anterior (↑)">{I.up}<span>CH</span></button>
            <button onClick={() => zap(1)} className="rmt-btn" title="Próximo canal (↓)">{I.down}<span>CH</span></button>
            <button onClick={togglePlay} className="rmt-btn" title="Pausa/continuar (espaço)">{playing ? I.pause : I.play}</button>
            <button onClick={toggleMute} className={`rmt-btn ${muted ? 'active' : ''}`} title="Mudo (M)">{muted ? I.mute : I.vol}</button>
            <button onClick={toggleFav} className={`rmt-btn fill-on-active ${current && favs.includes(current.id) ? 'active' : ''}`} title="Favorito">{I.star}</button>
            <button onClick={flashInfo} className="rmt-btn" title="Info (I)">{I.info}</button>
            <button onClick={() => setGuideOpen((v) => !v)} className={`rmt-btn ${guideOpen ? 'active' : ''}`} title="Guia (G)">{I.grid}</button>
            <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-body)' }}>
              {current ? `${String(idx + 1).padStart(3, '0')}/${list.length} // ${Math.round(current.reliability_score || 0)}%` : ''}
            </span>
          </div>
        </main>

        {guideOpen && (
          <aside className="glass-panel" style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 340, maxWidth: '85vw', zIndex: 50, borderRadius: '16px 0 0 16px', background: 'rgba(16,14,12,0.88)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px 10px', flex: 'none' }}>
              <div>
                <span className="section-label" style={{ margin: 0 }}>[Guia — agora]</span>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>A emitir</div>
                <div className="tnum" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {Object.values(guide).filter((g: any) => g?.now).length}/{Math.min(list.length, 40)} COM GUIA
                </div>
              </div>
              <button onClick={() => setGuideOpen(false)} className="rmt-btn" style={{ width: 38, height: 38, marginLeft: 'auto' }} title="Fechar">{I.x}</button>
            </div>
            <div className="no-scrollbar" style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: '0 12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {guideLoading && list.slice(0, 8).map((_, i) => <div key={i} className="skeleton" style={{ height: 64, flex: 'none' }} />)}
              {!guideLoading && list.slice(0, 40).map((c) => {
                const g = guide[c.id];
                const n = g?.now;
                const nxt = !n ? g?.next?.[0] : null;
                const dim = !n && !nxt ? { opacity: 0.55 } : {};
                return (
                  <button key={c.id} onClick={() => { const i = list.findIndex((x) => x.id === c.id); if (i >= 0) setIdx(i); }}
                    style={{ textAlign: 'left', background: c.id === current?.id ? 'var(--accent-subtle)' : 'rgba(255,255,255,0.05)', border: c.id === current?.id ? '1px solid var(--border-accent)' : '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit', ...dim }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                    {n ? (
                      <>
                        <div className="tnum" style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>{n.start?.slice(11, 16)} — {n.stop?.slice(11, 16)}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title}</div>
                      </>
                    ) : nxt ? (
                      <>
                        <div className="tnum" style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>A SEGUIR {nxt.start?.slice(11, 16)}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nxt.title}</div>
                      </>
                    ) : <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>Sem guia</div>}
                  </button>
                );
              })}
            </div>
          </aside>
        )}

        {upsell && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(5,4,3,0.72)', backdropFilter: 'blur(6px)' }}>
            <div className="card featured" style={{ width: '100%', maxWidth: 430, padding: 32, textAlign: 'center', position: 'relative' }}>
              <button onClick={() => setUpsell(null)} className="rmt-btn" style={{ width: 36, height: 36, position: 'absolute', top: 12, right: 12 }} title="Fechar (volta em 5 min)">{I.x}</button>
              <span className="section-label" style={{ marginTop: 8 }}>[{upsell.reason === 'promo' ? 'Kutsakai Premium' : 'Conteúdo premium'}]</span>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                {upsell.reason === 'promo' ? 'Desbloqueia tudo.' : (current?.name || 'Canal premium')}
              </div>
              <p style={{ fontSize: 14 }}>
                {upsell.reason === 'login_required'
                  ? 'Entra para veres se o teu plano cobre este canal.'
                  : upsell.reason === 'promo'
                    ? 'Estás a ver o catálogo grátis. Planos pagos abrem desporto, filmes e mais — sem interrupções.'
                    : 'O teu plano não cobre este canal. Daily, Weekly ou Monthly abrem tudo.'}
              </p>
              {fromPrice !== null && upsell.reason !== 'login_required' && (
                <div className="tnum" style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 12 }}>A PARTIR DE {fromPrice} MT</div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                {upsell.reason === 'login_required' && !token
                  ? <Link href="/login" className="btn btn-primary">Entrar</Link>
                  : <Link href="/plans" className="btn btn-primary">Ver planos</Link>}
                <button onClick={() => setUpsell(null)} className="btn btn-secondary">Agora não</button>
              </div>
              <div className="tnum" style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 12 }}>VOLTAMOS A LEMBRAR EM 5 MIN</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
