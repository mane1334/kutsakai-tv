"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API, apiGet, authFetch, tryRefresh, tokenExpiring } from '../../lib/api';
import LogoutButton from '../../components/LogoutButton';

const LANG_OPTS = [['', 'todas'], ['por', 'PT'], ['eng', 'EN'], ['spa', 'ES'], ['fra', 'FR']];
const CAT_OPTS = ['', 'news', 'sports', 'movies', 'series', 'music', 'kids', 'documentary', 'entertainment', 'culture', 'religious', 'general'];
const REGION_OPTS = ['', 'africa', 'europa', 'america'];

export default function Catalog() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [channels, setChannels] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [recs, setRecs] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('');
  const [cat, setCat] = useState('');
  const [country, setCountry] = useState('');
  const [region, setRegion] = useState('');
  const [countryOpts, setCountryOpts] = useState<string[]>(['mz', 'ao', 'pt', 'br']);
  const [onlineOnly, setOnlineOnly] = useState(true);
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [favs, setFavs] = useState<string[]>([]);
  const [guide, setGuide] = useState<Record<string, { now: any; next: any }>>({});
  const [onlyGuide, setOnlyGuide] = useState(false);
  const [page, setPage] = useState(1);
  const LIMIT = 60;
  const [paid, setPaid] = useState(false);
  const [lockedCount, setLockedCount] = useState(0);
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    // token de 15 min: renova antes da lista, senão conta paga parece anónima
    // e os PREMIUM vêm com cadeado mesmo tendo subscrição.
    (async () => {
      let t = localStorage.getItem('access') || '';
      if (t && tokenExpiring(t)) t = (await tryRefresh()) || '';
      setToken(t);
      setTokenReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!tokenReady) return;
    const t = setTimeout(() => {
      const p = new URLSearchParams({ limit: String(LIMIT), page: String(page) });
      if (q) p.set('q', q);
      if (lang) p.set('language', lang);
      if (cat) p.set('category', cat);
      if (country) p.set('country', country);
      if (region) p.set('region', region);
      if (!onlineOnly) p.set('status', 'all');
      apiGet(`/channels?${p}`, token).then(d => {
        const rows = d?.data || [];
        // página 1 substitui, páginas seguintes acrescentam (evita "sumir" resultados)
        setChannels(prev => (page === 1 ? rows : [...prev, ...rows.filter((c: any) => !prev.some((x: any) => x.id === c.id))]));
        setTotal(d?.total || 0);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [q, lang, cat, country, region, onlineOnly, page, token, tokenReady]);

  useEffect(() => {
    fetch(`${API}/plans`).then(r => r.json()).then(d => {
      const paidPlans = (Array.isArray(d) ? d : []).filter((p: any) => p.duration_days > 0);
      setLockedCount(paidPlans.reduce((m: number, p: any) => Math.max(m, p.channels || 0), 0));
    }).catch(() => {});
    fetch(`${API}/meta/filters`).then(r => r.json()).then(d => {
      const cs = (d?.countries || []).map((c: any) => c.country).filter(Boolean);
      if (cs.length) setCountryOpts(cs.slice(0, 12));
    }).catch(() => {});
    if (!token) { setPaid(false); setFavs([]); return; }
    apiGet('/me/subscription', token).then(s => setPaid(!!(s?.active && s?.plan && s?.plan.duration_days > 0))).catch(() => {});
    apiGet('/me/favorites', token).then(d => Array.isArray(d) && setFavs(d.map((f: any) => f.id))).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/me/recommendations?limit=8`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setRecs(Array.isArray(d) ? d : [])).catch(() => {});
  }, [token]);

  const open = (id: string) => router.push(`/tv?channel=${id}`);

  const toggleFav = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!token) { router.push('/login'); return; }
    if (favs.includes(id)) {
      await authFetch(`${API}/me/favorites/${id}`, { method: 'DELETE' });
      setFavs(favs.filter((x) => x !== id));
    } else {
      await authFetch(`${API}/me/favorites/${id}`, { method: 'POST' });
      setFavs([...favs, id]);
    }
  };

  const visible = onlyFavs ? channels.filter((c) => favs.includes(c.id)) : channels;
  const withGuide = visible.filter((c) => guide[c.id]?.now);
  const shown = onlyGuide ? withGuide : visible;

  // guia "agora": 1 pedido em lote para os visíveis (max 60) + auto-refresh 5min
  useEffect(() => {
    const ids = visible.slice(0, 60).map((c) => c.id);
    if (!ids.length) return;
    let alive = true;
    const load = () => {
      fetch(`${API}/epg/guide?ids=${ids.join(',')}`).then((r) => r.json()).then((d) => {
        if (!alive || !Array.isArray(d)) return;
        setGuide((g) => ({ ...g, ...Object.fromEntries(d.map((x: any) => [x.channelId, { now: x.now, next: x.next }])) }));
      }).catch(() => {});
    };
    const t = setTimeout(load, 400);
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => { alive = false; clearTimeout(t); clearInterval(iv); };
  }, [channels, onlyFavs, page, q, lang, cat, country, region]);

  const sel: React.CSSProperties = { padding: '10px 12px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)', borderRadius: 10, fontSize: 13 };

  return (
    <>
      <nav className="nav scrolled">
        <div className="dl-wrap" style={{ display: 'flex', alignItems: 'center', gap: 24, paddingTop: 16, paddingBottom: 16 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, color: 'var(--text-primary)', textDecoration: 'none' }}><img src="/assets/icon.jpg" alt="Kutsakai TV" style={{ width: 24, height: 24, borderRadius: 6 }} />Kutsakai<span style={{ color: 'var(--accent)' }}> TV</span></Link>
          <Link href="/catalog" className="nav-hide-m">Catálogo</Link>
          <Link href="/tv" className="nav-hide-m">Modo TV</Link>
          <Link href="/plans" className="nav-hide-m">Planos</Link>
          {token && <><Link href="/favorites" className="nav-hide-m">Favoritos</Link><Link href="/account/settings" className="nav-hide-m">Conta</Link></>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {token ? (<><Link href="/tv" className="btn btn-primary btn-sm">Ver TV</Link><LogoutButton small /></>) : (<Link href="/login" className="btn btn-secondary btn-sm">Entrar</Link>)}
          </span>
        </div>
      </nav>

      <main className="dl-wrap" style={{ paddingTop: 110, paddingBottom: 48 }}>
        <span className="section-label">[Catálogo]</span>
        <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}>
          <span className="hl-muted">{total}</span> <span className="hl-bright">canais.</span>
        </h1>
        {!paid && lockedCount > 0 && (
          <Link href="/plans" style={{ display: 'block', marginTop: 16, padding: '14px 18px', borderRadius: 14, border: '1px solid var(--border-accent)', background: 'var(--accent-subtle)', textDecoration: 'none', color: 'var(--text-primary)', fontSize: 14 }}>
            <b style={{ color: 'var(--accent)' }}>{lockedCount} canais premium</b> com cadeado — desbloqueia com Daily, Weekly ou Monthly →
          </Link>
        )}

        {token && recs.length > 0 && (
          <section style={{ marginTop: 28 }}>
            <span className="section-label">[Para ti — aprende com o que vês]</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
              {recs.map((r: any) => (
                <button key={r.channel.id} onClick={() => open(r.channel.id)} className="card featured" style={{ padding: 14, textAlign: 'left', cursor: 'pointer', color: 'inherit', fontFamily: 'inherit' }}>
                  <div className="arch-meta">{(r.channel.categories?.[0] || 'geral').toUpperCase()} // {Math.round((r.score || 0) * 100)} PTS</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{r.channel.name}</div>
                  <div style={{ fontSize: 12 }}>{r.reason}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="card" style={{ padding: 16, marginTop: 28, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="pesquisar…" className="dl-input" style={{ flex: '2 1 200px' }} />
          <select value={lang} onChange={e => { setLang(e.target.value); setPage(1); }} style={sel}>
            {LANG_OPTS.map(([v, l]) => <option key={v} value={v}>Língua: {l}</option>)}
          </select>
          <select value={cat} onChange={e => { setCat(e.target.value); setPage(1); }} style={sel}>
            {CAT_OPTS.map((c) => <option key={c} value={c}>{c ? `Tipo: ${c}` : 'Tipo: todos'}</option>)}
          </select>
          <select value={country} onChange={e => { setCountry(e.target.value); setPage(1); }} style={sel}>
            <option value="">País: todos</option>
            {countryOpts.map((c) => <option key={c} value={c}>País: {c.toUpperCase()}</option>)}
          </select>
          <select value={region} onChange={e => { setRegion(e.target.value); setPage(1); }} style={sel}>
            {REGION_OPTS.map((r) => <option key={r} value={r}>{r ? `Região: ${r}` : 'Região: todas'}</option>)}
          </select>
          <button onClick={() => { setOnlineOnly(!onlineOnly); setPage(1); }} className={onlineOnly ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}>
            {onlineOnly ? '● Só abertos' : '○ Todos'}
          </button>
          {token && (
            <button onClick={() => setOnlyFavs(!onlyFavs)} className={onlyFavs ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}>
              {onlyFavs ? '★ Só favoritos' : '☆ Favoritos'}
            </button>
          )}
          <button onClick={() => setOnlyGuide(!onlyGuide)} className={onlyGuide ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'} title="Só canais com guia agora">
            {onlyGuide ? `📺 Com guia (${withGuide.length})` : `📺 Guia (${withGuide.length})`}
          </button>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 14, marginTop: 20 }}>
          {shown.map(c => (
            <button key={c.id} onClick={() => open(c.id)} className="card dl-chan" style={{ position: 'relative', textAlign: 'left' }}>
              {(c.access_level || 'FREE').toUpperCase() === 'PREMIUM' && (
                <span className="chip chip-warn" style={{ position: 'absolute', top: 8, right: 8 }}>PREMIUM</span>
              )}
              {token && (
                <span onClick={(e) => toggleFav(e, c.id)} title="favorito" style={{ position: 'absolute', top: 8, left: 8, fontSize: 16, color: favs.includes(c.id) ? 'var(--accent)' : 'var(--text-tertiary)', cursor: 'pointer' }}>
                  {favs.includes(c.id) ? '★' : '☆'}
                </span>
              )}
              <img src={c.logo || '/assets/icon.jpg'} loading="lazy" alt="" style={{ width: '100%', height: 56, objectFit: 'contain' }} />
              <div className="chan-name">{c.name}</div>
              <div className="chan-meta">{(c.country || 'int').toUpperCase()}{c.region ? ` · ${c.region.slice(0, 3).toUpperCase()}` : ''} // {c.status.toUpperCase()} // {Math.round(c.reliability_score || 0)}%</div>
              {guide[c.id]?.now ? (
                <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.35, color: 'var(--text-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>AGORA {guide[c.id].now.start?.slice(11, 16)}</span> · {guide[c.id].now.title}
                </div>
              ) : null}
              {guide[c.id]?.next ? (
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  A seguir {guide[c.id].next.start?.slice(11, 16)} · {guide[c.id].next.title}
                </div>
              ) : null}
            </button>
          ))}
        </div>
        {shown.length === 0 && (
          <div style={{ marginTop: 20, color: 'var(--text-tertiary)', fontSize: 14 }}>{onlyGuide ? 'Nenhum canal visível tem guia agora. Limpa o filtro 📺.' : onlyFavs ? (<>Sem favoritos neste filtro. <Link href="/favorites" style={{ color: 'var(--accent)' }}>Ver todos</Link></>) : 'Nenhum canal para esta pesquisa. Tenta limpar os filtros.'}</div>
        )}
        {!onlyFavs && channels.length < total && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
            <button onClick={() => setPage(p => p + 1)} className="btn btn-secondary">
              Mostrar mais ({channels.length}/{total})
            </button>
          </div>
        )}
      </main>
    </>
  );
}
