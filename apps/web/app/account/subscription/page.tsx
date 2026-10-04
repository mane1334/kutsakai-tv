"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/v1';

export default function Subscription() {
  const [data, setData] = useState<any>(null);

  const load = () => {
    const t = localStorage.getItem('access') || '';
    if (!t) return;
    fetch(`${API}/me/subscription`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json()).then(setData);
  };
  useEffect(load, []);

  const cancel = async () => {
    if (!confirm('Cancelar a subscrição ativa?')) return;
    const t = localStorage.getItem('access') || '';
    await fetch(`${API}/me/subscription/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } });
    load();
  };

  const s = data?.subscription, p = data?.plan;
  const days = s?.expires_at ? Math.max(0, Math.ceil((new Date(s.expires_at).getTime() - Date.now()) / 86400000)) : null;

  return (
    <>
      <nav className="nav scrolled">
        <div className="dl-wrap" style={{ display: 'flex', alignItems: 'center', gap: 24, paddingTop: 16, paddingBottom: 16 }}>
          <Link href="/" style={{ fontWeight: 800, color: 'var(--text-primary)', textDecoration: 'none' }}>Kutsakai<span style={{ color: 'var(--accent)' }}>·Conta</span></Link>
          <Link href="/account/subscription">Subscrição</Link>
          <Link href="/account/payments">Pagamentos</Link>
          <Link href="/account/settings">Definições</Link>
          <Link href="/plans" className="nav-hide-m">Planos</Link>
        </div>
      </nav>
      <main className="dl-wrap" style={{ paddingTop: 110, paddingBottom: 48, maxWidth: 720 }}>
        <span className="section-label">[Conta — subscrição]</span>
        <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}><span className="hl-bright">O teu plano.</span></h1>
        <div className={`card ${data?.active ? 'featured' : ''}`} style={{ padding: 28, marginTop: 24 }}>
          {data ? (<>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{p?.name || 'Kutsakai Free'}</span>
              {data.active ? <span className="chip chip-pos">ATIVA</span> : <span className="chip chip-mut">SEM SUBSCRIÇÃO PAGA</span>}
            </div>
            <div className="arch-meta" style={{ marginTop: 8 }}>
              INÍCIO {s?.started_at?.slice(0, 10) || '—'} // EXPIRA {s?.expires_at?.slice(0, 10) || '—'}{days !== null ? ` // FALTAM ${days} DIAS` : ''}
            </div>
            {p?.features?.length > 0 && <ul style={{ paddingLeft: 18, fontSize: 14 }}>{p.features.map((f: string) => <li key={f}>{f}</li>)}</ul>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <Link href="/plans" className="btn btn-primary btn-sm">Mudar de plano</Link>
              {data.active && p?.duration_days > 0 && <button onClick={cancel} className="btn btn-secondary btn-sm">Cancelar</button>}
            </div>
          </>) : <p>A carregar…</p>}
        </div>
      </main>
    </>
  );
}
