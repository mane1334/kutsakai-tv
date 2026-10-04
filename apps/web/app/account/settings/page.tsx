"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API, authFetch, logout } from '../../../lib/api';

const LANGS = [['por', 'Português'], ['eng', 'English'], ['spa', 'Español'], ['fra', 'Français']];
const CATS = ['news', 'sports', 'movies', 'series', 'music', 'kids', 'documentary', 'entertainment', 'culture', 'religious', 'general'];
const REGIONS = ['africa', 'europa', 'america'];

export default function Settings() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [prefs, setPrefs] = useState<any>({ languages: ['por'], countries: [], regions: [], categories: [], quality_mode: 'auto' });
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [language, setLanguage] = useState('pt');
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!localStorage.getItem('access')) { router.push('/login'); return; }
    authFetch(`${API}/me`).then((r) => r.json()).then((d) => {
      if (d?.statusCode === 401) { router.push('/login'); return; }
      setMe(d); setName(d?.name || ''); setCountry(d?.country || ''); setLanguage(d?.language || 'pt');
    });
    authFetch(`${API}/me/preferences`).then((r) => r.json()).then((d) => {
      if (d && !d.statusCode) setPrefs(d);
    }).catch(() => {});
  }, []);

  const toggle = (key: string, v: string) => {
    setPrefs((p: any) => ({ ...p, [key]: p[key]?.includes(v) ? p[key].filter((x: string) => x !== v) : [...(p[key] || []), v] }));
  };

  const saveProfile = async () => {
    setErr(''); setMsg('');
    const r = await authFetch(`${API}/me`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, country, language }) });
    const d = await r.json();
    if (!r.ok) { setErr(d.message || 'falhou guardar perfil'); return; }
    setMe(d); setMsg('Perfil guardado.');
  };

  const savePrefs = async () => {
    setErr(''); setMsg('');
    const r = await authFetch(`${API}/me/preferences`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ languages: prefs.languages, countries: prefs.countries || [], regions: prefs.regions, categories: prefs.categories, qualityMode: prefs.quality_mode || 'auto' }),
    });
    if (!r.ok) { setErr('falhou guardar gostos'); return; }
    setMsg('Gostos guardados — recomendações atualizadas.');
  };

  const savePass = async () => {
    setErr(''); setMsg('');
    const r = await authFetch(`${API}/me/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: cur, newPassword: nw }) });
    const d = await r.json();
    if (!r.ok) { setErr(d.message || 'falhou mudar password'); return; }
    setCur(''); setNw(''); setMsg('Password alterada.');
  };

  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button key={label} type="button" onClick={onClick} className={active ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}>{label}</button>
  );

  return (
    <>
      <nav className="nav scrolled">
        <div className="dl-wrap" style={{ display: 'flex', alignItems: 'center', gap: 24, paddingTop: 16, paddingBottom: 16 }}>
          <Link href="/" style={{ fontWeight: 800, color: 'var(--text-primary)', textDecoration: 'none' }}>Kutsakai<span style={{ color: 'var(--accent)' }}>·Conta</span></Link>
          <Link href="/account/subscription">Subscrição</Link>
          <Link href="/account/payments">Pagamentos</Link>
          <Link href="/account/settings">Definições</Link>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/catalog" className="btn btn-secondary btn-sm nav-hide-m">Catálogo</Link>
            <button onClick={() => logout((h) => router.push(h))} className="btn btn-secondary btn-sm">Sair</button>
          </span>
        </div>
      </nav>
      <main className="dl-wrap" style={{ paddingTop: 110, paddingBottom: 48, maxWidth: 760 }}>
        <span className="section-label">[Conta — definições]</span>
        <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}><span className="hl-bright">A tua conta.</span></h1>
        {me && <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{me.email} · desde {me.created_at?.slice(0, 10)}</p>}

        <div className="card" style={{ padding: 24, marginTop: 20 }}>
          <span className="section-label">[Perfil]</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginTop: 8 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="nome" className="dl-input" />
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="país (MZ…)" className="dl-input" />
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="dl-input">
              <option value="pt">Português</option><option value="en">English</option><option value="es">Español</option><option value="fr">Français</option>
            </select>
          </div>
          <button onClick={saveProfile} className="btn btn-primary btn-sm" style={{ marginTop: 12 }}>Guardar perfil</button>
        </div>

        <div className="card" style={{ padding: 24, marginTop: 16 }}>
          <span className="section-label">[Gostos — recomendações]</span>
          <div className="arch-meta">LÍNGUAS</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{LANGS.map(([v, l]) => chip((prefs.languages || []).includes(v), l, () => toggle('languages', v)))}</div>
          <div className="arch-meta" style={{ marginTop: 12 }}>TIPOS</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{CATS.map((c) => chip((prefs.categories || []).includes(c), c, () => toggle('categories', c)))}</div>
          <div className="arch-meta" style={{ marginTop: 12 }}>REGIÕES</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{REGIONS.map((r) => chip((prefs.regions || []).includes(r), r, () => toggle('regions', r)))}</div>
          <div className="arch-meta" style={{ marginTop: 12 }}>QUALIDADE</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{['auto', 'saver', 'max'].map((v) => chip((prefs.quality_mode || 'auto') === v, v, () => setPrefs((p: any) => ({ ...p, quality_mode: v }))))}</div>
          <button onClick={savePrefs} className="btn btn-primary btn-sm" style={{ marginTop: 12 }}>Guardar gostos</button>
        </div>

        <div className="card" style={{ padding: 24, marginTop: 16 }}>
          <span className="section-label">[Password]</span>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            <input value={cur} onChange={(e) => setCur(e.target.value)} type="password" placeholder="atual" className="dl-input" />
            <input value={nw} onChange={(e) => setNw(e.target.value)} type="password" placeholder="nova (min 4)" className="dl-input" />
          </div>
          <button onClick={savePass} className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}>Mudar password</button>
        </div>

        {msg && <p style={{ fontSize: 13, color: 'var(--success)', marginTop: 12 }}>{msg}</p>}
        {err && <p style={{ fontSize: 13, color: '#e06c6c', marginTop: 12 }}>{err}</p>}
      </main>
    </>
  );
}
