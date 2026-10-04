"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/v1';

const LANGS = [
  ['por', 'Português'], ['eng', 'English'], ['spa', 'Español'], ['fra', 'Français'],
];
const CATS = [
  'news', 'sports', 'movies', 'series', 'music', 'kids',
  'documentary', 'entertainment', 'culture', 'religious', 'general',
];
const REGIONS = ['africa', 'europa', 'america'];

function Chip({ active, onClick, children }: any) {
  return (
    <button type="button" onClick={onClick} className={active ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}>
      {children}
    </button>
  );
}

export default function Onboarding() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [langs, setLangs] = useState<string[]>(['por']);
  const [cats, setCats] = useState<string[]>(['news']);
  const [regs, setRegs] = useState<string[]>([]);
  const [quality, setQuality] = useState('auto');
  const [error, setError] = useState('');

  useEffect(() => {
    const t = localStorage.getItem('access') || '';
    if (!t) { router.push('/login'); return; }
    setToken(t);
  }, []);

  const toggle = (list: string[], v: string, set: any) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const authFetch = async (url: string, opts: any = {}) => {
    let res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('access') || ''}` } });
    if (res.status === 401) {
      const r = await fetch(`${API}/auth/refresh`, { method: 'POST', credentials: 'include' }).then(x => x.json()).catch(() => null);
      if (r?.accessToken) {
        localStorage.setItem('access', r.accessToken);
        res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r.accessToken}` } });
      }
    }
    return res;
  };

  const submit = async () => {
    setError('');
    try {
      const res = await authFetch(`${API}/onboarding`, {
        method: 'POST',
        body: JSON.stringify({ languages: langs, countries: [], regions: regs, categories: cats, qualityMode: quality }),
      });
      if (res.status === 401) { setError('sessão expirada — entra de novo'); router.push('/login'); return; }
      if (!res.ok) { setError('não foi possível guardar — tenta de novo'); return; }
      router.push('/catalog');
    } catch { setError('API indisponível'); }
  };

  if (!token) return null;

  return (
    <main className="dl-wrap" style={{ paddingTop: 64, paddingBottom: 64, maxWidth: 760 }}>
      <Link href="/" style={{ fontSize: 13, color: 'var(--text-tertiary)', textDecoration: 'none' }}>← início</Link>
      <span className="section-label" style={{ marginTop: 16 }}>[Passo 2 de 2 — os teus gostos]</span>
      <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}>
        <span className="hl-muted">O que queres</span> <span className="hl-bright">ver?</span>
      </h1>
      <p>Isto alimenta as recomendações — podes mudar tudo depois nas definições.</p>

      <div className="card" style={{ padding: 28, marginTop: 24, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div>
          <div className="arch-meta">LÍNGUAS // escolhe pelo menos 1</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {LANGS.map(([v, label]) => <Chip key={v} active={langs.includes(v)} onClick={() => toggle(langs, v, setLangs)}>{label}</Chip>)}
          </div>
        </div>
        <div>
          <div className="arch-meta">TIPOS DE CANAIS // escolhe pelo menos 1</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CATS.map((c) => <Chip key={c} active={cats.includes(c)} onClick={() => toggle(cats, c, setCats)}>{c}</Chip>)}
          </div>
        </div>
        <div>
          <div className="arch-meta">REGIÕES // opcional</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {REGIONS.map((r) => <Chip key={r} active={regs.includes(r)} onClick={() => toggle(regs, r, setRegs)}>{r}</Chip>)}
          </div>
        </div>
        <div>
          <div className="arch-meta">QUALIDADE // modo de dados</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[['auto', 'Automática'], ['saver', 'Economia de dados'], ['max', 'Qualidade máxima']].map(([v, label]) => (
              <Chip key={v} active={quality === v} onClick={() => setQuality(v)}>{label}</Chip>
            ))}
          </div>
        </div>
        {error && <span style={{ fontSize: 13, color: '#e06c6c' }}>{error}</span>}
        <button onClick={submit} disabled={!langs.length || !cats.length} className="btn btn-primary" style={{ justifyContent: 'center' }}>
          Guardar e abrir catálogo
        </button>
      </div>
    </main>
  );
}
