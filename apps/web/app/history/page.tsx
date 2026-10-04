"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API, authFetch } from '../../lib/api';

export default function History() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    if (!localStorage.getItem('access')) { router.push('/login'); return; }
    authFetch(`${API}/me/history`).then((r) => r.json()).then((d) => setRows(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  return (
    <>
      <nav className="nav scrolled">
        <div className="dl-wrap" style={{ display: 'flex', alignItems: 'center', gap: 24, paddingTop: 16, paddingBottom: 16 }}>
          <Link href="/" style={{ fontWeight: 800, color: 'var(--text-primary)', textDecoration: 'none' }}>Kutsakai<span style={{ color: 'var(--accent)' }}> TV</span></Link>
          <Link href="/catalog">Catálogo</Link>
          <Link href="/favorites">Favoritos</Link>
          <Link href="/history">Histórico</Link>
          <span style={{ marginLeft: 'auto' }}><Link href="/tv" className="btn btn-primary btn-sm">Ver TV</Link></span>
        </div>
      </nav>
      <main className="dl-wrap" style={{ paddingTop: 110, paddingBottom: 48, maxWidth: 860 }}>
        <span className="section-label">[Histórico — {rows.length}]</span>
        <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}><span className="hl-bright">Visto.</span></h1>
        <div className="card" style={{ marginTop: 20, padding: 8 }}>
          {rows.map((h: any) => (
            <Link key={h.id} href={`/tv?channel=${h.channel_id}`} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--border-subtle)', textDecoration: 'none', color: 'inherit' }}>
              {h.logo ? <img src={h.logo} alt="" style={{ width: 56, height: 32, objectFit: 'contain', background: '#000', borderRadius: 6 }} /> : <span style={{ width: 56 }} />}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name || h.channel_id}</span>
                <span className="tnum" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{h.started_at?.slice(0, 16).replace('T', ' ')} // {h.duration_sec}s // {h.data_consumed_mb}MB</span>
              </span>
              <span style={{ color: 'var(--accent)', fontSize: 13 }}>Ver →</span>
            </Link>
          ))}
          {!rows.length && <p style={{ padding: 20, color: 'var(--text-tertiary)', fontSize: 14 }}>Sem histórico ainda. Abre um canal no <Link href="/tv" style={{ color: 'var(--accent)' }}>Modo TV</Link>.</p>}
        </div>
      </main>
    </>
  );
}
