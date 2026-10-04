"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/v1';

const chip = (s: string) => s === 'COMPLETED'
  ? <span className="chip chip-pos">CONCLUÍDO</span>
  : ['FAILED', 'CANCELLED', 'EXPIRED'].includes(s)
    ? <span className="chip chip-neg">{s === 'FAILED' ? 'FALHOU' : s === 'CANCELLED' ? 'CANCELADO' : 'EXPIRADO'}</span>
    : <span className="chip chip-warn">PENDENTE</span>;

export default function Payments() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = localStorage.getItem('access') || '';
    if (!t) return;
    fetch(`${API}/me/payments`, { headers: { Authorization: `Bearer ${t}` } })
      .then(r => r.json()).then(d => setRows(Array.isArray(d) ? d : []));
  }, []);

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
      <main className="dl-wrap" style={{ paddingTop: 110, paddingBottom: 48 }}>
        <span className="section-label">[Conta — pagamentos]</span>
        <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}><span className="hl-bright">Histórico.</span></h1>
        <div className="card" style={{ padding: 8, marginTop: 24, overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
              <th style={{ padding: '10px 12px' }}>DATA</th><th style={{ padding: '10px 12px' }}>PLANO</th><th style={{ padding: '10px 12px' }}>VALOR</th><th style={{ padding: '10px 12px' }}>MÉTODO</th><th style={{ padding: '10px 12px' }}>STATUS</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((p: any) => (
                <>
                  <tr key={p.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td className="tnum" style={{ padding: '10px 12px' }}>{p.created_at?.slice(0, 16).replace('T', ' ')}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontWeight: 600 }}>{p.plan_name || '—'}</td>
                    <td className="tnum" style={{ padding: '10px 12px' }}>{p.amount} {p.currency}</td>
                    <td style={{ padding: '10px 12px' }}>{p.provider.toUpperCase()}</td>
                    <td style={{ padding: '10px 12px' }}>{chip(p.status)}</td>
                    <td style={{ padding: '10px 12px' }}><button onClick={() => setOpen(open === p.id ? null : p.id)} className="btn btn-secondary btn-sm">Detalhes</button></td>
                  </tr>
                  {open === p.id && (
                    <tr><td colSpan={6} style={{ padding: '4px 12px 14px', fontSize: 12, color: 'var(--text-body)' }}>
                      <div className="tnum">ID: {p.id}</div>
                      <div className="tnum">Transação gateway: {p.provider_transaction_id || '—'}</div>
                      <div className="tnum">Concluído em: {p.completed_at || '—'}</div>
                    </td></tr>
                  )}
                </>
              ))}
              {!rows.length && <tr><td colSpan={6} style={{ padding: 20, color: 'var(--text-tertiary)' }}>Sem pagamentos ainda. <Link href="/plans" style={{ color: 'var(--accent)' }}>Ver planos</Link></td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
