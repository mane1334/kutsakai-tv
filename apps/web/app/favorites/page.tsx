"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API, authFetch } from '../../lib/api';

export default function Favorites() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);

  const load = async () => {
    if (!localStorage.getItem('access')) { router.push('/login'); return; }
    const r = await authFetch(`${API}/me/favorites`);
    const d = await r.json().catch(() => []);
    setRows(Array.isArray(d) ? d : []);
  };
  useEffect(() => { load(); }, []);

  const remove = async (id: string) => {
    await authFetch(`${API}/me/favorites/${id}`, { method: 'DELETE' });
    setRows((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <>
      <nav className="nav scrolled">
        <div className="dl-wrap" style={{ display: 'flex', alignItems: 'center', gap: 24, paddingTop: 16, paddingBottom: 16 }}>
          <Link href="/" style={{ fontWeight: 800, color: 'var(--text-primary)', textDecoration: 'none' }}>Kutsakai<span style={{ color: 'var(--accent)' }}> TV</span></Link>
          <Link href="/catalog">Catálogo</Link>
          <Link href="/favorites">Favoritos</Link>
          <Link href="/history" className="nav-hide-m">Histórico</Link>
          <span style={{ marginLeft: 'auto' }}><Link href="/tv" className="btn btn-primary btn-sm">Ver TV</Link></span>
        </div>
      </nav>
      <main className="dl-wrap" style={{ paddingTop: 110, paddingBottom: 48 }}>
        <span className="section-label">[Favoritos — {rows.length}]</span>
        <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}><span className="hl-bright">Os teus.</span></h1>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 14, marginTop: 20 }}>
          {rows.map((c) => (
            <div key={c.id} className="card dl-chan" style={{ position: 'relative' }}>
              <Link href={`/tv?channel=${c.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <img src={c.logo || '/assets/icon.jpg'} loading="lazy" alt="" style={{ width: '100%', height: 56, objectFit: 'contain' }} />
                <div className="chan-name">{c.name}</div>
                <div className="chan-meta">{(c.country || 'int').toUpperCase()} // {(c.status || '').toUpperCase()}</div>
              </Link>
              <button onClick={() => remove(c.id)} className="btn btn-secondary btn-sm" style={{ marginTop: 8, width: '100%' }}>Remover ★</button>
            </div>
          ))}
        </div>
        {!rows.length && <p style={{ color: 'var(--text-tertiary)', fontSize: 14, marginTop: 20 }}>Sem favoritos. Marca ★ no player ou no catálogo. <Link href="/catalog" style={{ color: 'var(--accent)' }}>Ir ao catálogo</Link></p>}
      </main>
    </>
  );
}
