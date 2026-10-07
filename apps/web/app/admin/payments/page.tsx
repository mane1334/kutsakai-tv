"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API, authFetch } from '../../../lib/api';
import AdminNav from '../AdminNav';

export default function AdminPayments() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [fStatus, setFStatus] = useState('');
  const [denied, setDenied] = useState(false);
  const sel: React.CSSProperties = { padding: '8px 10px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)', borderRadius: 8, fontSize: 12 };

  const load = async () => {
    const p = new URLSearchParams();
    if (fStatus) p.set('status', fStatus);
    const r = await authFetch(`${API}/admin/payments?${p}`);
    if (r.status === 403) { setDenied(true); return; }
    const d = await r.json().catch(() => []);
    setRows(Array.isArray(d) ? d : []);
  };
  useEffect(() => { if (!localStorage.getItem('access')) router.push('/login'); else load(); }, []);
  useEffect(() => { load(); }, [fStatus]);

  const decide = async (id: string, ok: boolean) => {
    await authFetch(`${API}/admin/payments/${id}/${ok ? 'approve' : 'reject'}`, { method: 'POST' });
    load();
  };

  if (denied) return (<main className="dl-wrap" style={{ paddingTop: 96 }}><p>Acesso negado. <Link href="/admin" style={{ color: 'var(--accent)' }}>← admin</Link></p></main>);

  const pending = rows.filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING');
  const done = rows.filter((p) => p.status !== 'PENDING' && p.status !== 'PROCESSING');
  const chip = (s: string) => s === 'COMPLETED' ? <span className="chip chip-pos">CONCLUÍDO</span>
    : s === 'PROCESSING' ? <span className="chip chip-warn">EM ANÁLISE</span>
    : s === 'PENDING' ? <span className="chip chip-warn">PENDENTE</span>
    : <span className="chip chip-neg">{s}</span>;

  const row = (p: any) => (
    <div key={p.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '14px 0', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>
          <Link href={`/admin/users/${p.user_id}`} style={{ color: 'inherit' }}>{p.user_name || p.email}</Link> — {p.plan_name} · <span className="tnum">{p.amount} {p.currency}</span>
        </div>
        <div className="tnum" style={{ fontSize: 12, color: 'var(--accent)' }}>ID: {p.provider_transaction_id}</div>
        <div className="tnum" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{p.provider?.toUpperCase()} // {p.created_at?.slice(0, 16).replace('T', ' ')}</div>
      </div>
      {(() => { try { const mt = JSON.parse(p.metadata || '{}'); return mt.receipt ? <a href={mt.receipt} target="_blank" rel="noreferrer"><img src={mt.receipt} alt="comprovativo" style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border-accent)' }} /></a> : <span className="tnum" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>sem foto</span>; } catch { return null; } })()}
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{chip(p.status)}</span>
      {(p.status === 'PENDING' || p.status === 'PROCESSING') && (
        <span style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => decide(p.id, true)} className="btn btn-primary btn-sm">Aprovar</button>
          <button onClick={() => decide(p.id, false)} className="btn btn-secondary btn-sm">Rejeitar</button>
        </span>
      )}
    </div>
  );

  return (
    <>
      <AdminNav active="/admin/payments" />
      <main className="dl-wrap" style={{ paddingTop: 110, paddingBottom: 48 }}>
        <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}><span className="hl-muted">Aceitar ou</span> <span className="hl-bright">recusar.</span></h1>
        <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={sel}>
            <option value="">Todos os estados</option>
            <option value="PENDING">Pendentes</option>
            <option value="PROCESSING">Em análise</option>
            <option value="COMPLETED">Concluídos</option>
            <option value="FAILED">Falhados</option>
          </select>
        </div>
        {!fStatus && pending.length > 0 && (
          <section className="card featured" style={{ padding: 24, marginTop: 16 }}>
            <span className="section-label">[A decidir — {pending.length}]</span>
            {pending.map(row)}
          </section>
        )}
        <section className="card" style={{ padding: 24, marginTop: 16 }}>
          <span className="section-label">[{fStatus ? 'Filtrados' : 'Histórico'} — {fStatus ? rows.length : done.length}]</span>
          {(fStatus ? rows : done).map(row)}
          {(fStatus ? rows : done).length === 0 && <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Nada aqui.</p>}
        </section>
      </main>
    </>
  );
}
