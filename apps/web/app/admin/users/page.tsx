"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API, authFetch } from '../../../lib/api';
import AdminNav from '../AdminNav';

export default function AdminUsers() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<any>(null);
  const [denied, setDenied] = useState(false);
  const [msg, setMsg] = useState('');
  const [days, setDays] = useState('30');
  const selStyle: React.CSSProperties = { padding: '8px 10px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)', borderRadius: 8, fontSize: 12 };

  const load = async (pg = page) => {
    const p = new URLSearchParams({ limit: '30', page: String(pg) });
    if (q) p.set('q', q);
    if (filter) p.set(filter === 'active' ? 'active' : 'sub', filter === 'active' ? '1' : filter);
    const r = await authFetch(`${API}/admin/users?${p}`);
    if (r.status === 403) { setDenied(true); return; }
    const d = await r.json().catch(() => ({}));
    setRows(d.data || []); setTotal(d.total || 0);
  };
  useEffect(() => {
    if (!localStorage.getItem('access')) { router.push('/login'); return; }
    const qp = new URLSearchParams(window.location.search).get('user');
    if (qp) openProfile(qp);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => load(1), 300);
    return () => clearTimeout(t);
  }, [q, filter]);

  const openProfile = async (id: string) => {
    const r = await authFetch(`${API}/admin/users/${id}`);
    if (r.status === 403) { setDenied(true); return; }
    setSel(await r.json().catch(() => null));
    router.replace(`/admin/users?user=${id}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const extend = async () => {
    const cur = sel?.subscriptions?.find((s: any) => s.is_current);
    if (!cur) return;
    setMsg('a estender…');
    const r = await authFetch(`${API}/admin/subscriptions/${cur.id}/extend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: parseInt(days) || 30 }) });
    setMsg(r.ok ? 'Subscrição estendida.' : 'falhou');
    openProfile(sel.user.id);
  };
  const cancel = async (sid: string) => {
    if (!window.confirm('Cancelar esta subscrição?')) return;
    await authFetch(`${API}/admin/subscriptions/${sid}/cancel`, { method: 'POST' });
    setMsg('Subscrição cancelada.');
    openProfile(sel.user.id);
  };

  if (denied) return (<main className="dl-wrap" style={{ paddingTop: 96 }}><p>Acesso negado. <Link href="/admin" style={{ color: 'var(--accent)' }}>← admin</Link></p></main>);

  const seenChip = (mins: number | null) => mins === null ? <span className="chip chip-mut">NUNCA</span>
    : mins < 60 ? <span className="chip chip-pos">HÁ {mins} MIN</span>
    : mins < 1440 ? <span className="chip chip-pos">HÁ {Math.round(mins / 60)} H</span>
    : <span className="chip chip-mut">HÁ {Math.round(mins / 1440)} D</span>;

  return (
    <>
      <AdminNav active="/admin/users" />
      <main className="dl-wrap" style={{ paddingTop: 110, paddingBottom: 48 }}>
        {sel ? (<>
          <button onClick={() => { setSel(null); router.replace('/admin/users'); }} className="btn btn-secondary btn-sm">← voltar à lista</button>
          <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)', marginTop: 12 }}><span className="hl-bright">{sel.user.name}</span></h1>
          <p style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>{sel.user.email} · {(sel.user.country || '—').toUpperCase()} · desde {sel.user.created_at?.slice(0, 10)}</p>
          {(() => {
            const cur = sel.subscriptions.find((s: any) => s.is_current);
            return (
              <div className={`card ${cur ? 'featured' : ''}`} style={{ padding: 24, marginTop: 16 }}>
                <span className="section-label">[Subscrição atual]</span>
                {cur ? (<>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b style={{ color: 'var(--text-primary)', fontSize: 18 }}>{cur.plan_name || cur.plan}</b>
                    <span className="chip chip-pos">ATIVA</span>
                    <span className="tnum" style={{ fontSize: 22, fontWeight: 800, color: (cur.days_left ?? 99) <= 3 ? '#e06c6c' : 'var(--accent)' }}>FALTAM {cur.days_left}d</span>
                  </div>
                  <div className="arch-meta">INÍCIO {cur.started_at?.slice(0, 10)} // EXPIRA {cur.expires_at?.slice(0, 10) || '—'}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                    <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="dl-input" style={{ width: 90 }} />
                    <button onClick={extend} className="btn btn-primary btn-sm">Estender dias</button>
                    <button onClick={() => cancel(cur.id)} className="btn btn-secondary btn-sm">Cancelar</button>
                    {msg && <span style={{ fontSize: 12, color: 'var(--accent)' }}>{msg}</span>}
                  </div>
                </>) : <p style={{ fontSize: 14 }}>Sem subscrição ativa (plano gratuito).</p>}
              </div>
            );
          })()}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16, marginTop: 16 }}>
            <div className="card" style={{ padding: 20 }}>
              <span className="section-label">[Últimos canais — {sel.watchCount}]</span>
              <div className="tnum" style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>{Math.round((sel.watchSeconds || 0) / 3600)}H VISTAS NO TOTAL</div>
              <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13 }}>
                {sel.history.map((h: any) => <li key={h.id}>{h.channel_name || 'canal'} — {Math.round((h.duration_sec || 0) / 60)}min · {h.started_at?.slice(0, 16).replace('T', ' ')}</li>)}
                {!sel.history.length && <li style={{ color: 'var(--text-tertiary)' }}>Nunca viu nada.</li>}
              </ul>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <span className="section-label">[Favoritos — {sel.favorites.length}]</span>
              <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13 }}>
                {sel.favorites.map((f: any) => <li key={f.id}>{f.name}</li>)}
                {!sel.favorites.length && <li style={{ color: 'var(--text-tertiary)' }}>Sem favoritos.</li>}
              </ul>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <span className="section-label">[Pagamentos — {sel.payments.length}]</span>
              <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13 }}>
                {sel.payments.map((p: any) => <li key={p.id}>{p.plan_name} · {p.amount} {p.currency} · {p.status} · {p.created_at?.slice(0, 10)}</li>)}
                {!sel.payments.length && <li style={{ color: 'var(--text-tertiary)' }}>Sem pagamentos.</li>}
              </ul>
            </div>
          </div>
        </>) : (<>
          <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}><span className="hl-muted">{total}</span> <span className="hl-bright">clientes.</span></h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="nome ou email…" className="dl-input" style={{ flex: '2 1 180px' }} />
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={selStyle}>
              <option value="">Todos</option>
              <option value="active">Ativos 24h</option>
              <option value="paid">Com sub paga</option>
              <option value="expiring">A expirar 7d</option>
              <option value="free">Sem sub paga</option>
            </select>
          </div>
          <div className="card" style={{ padding: 8, marginTop: 16, overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                <th style={{ padding: '8px 12px' }}>CLIENTE</th><th style={{ padding: '8px 12px' }}>VISTO</th><th style={{ padding: '8px 12px' }}>PLANO</th><th style={{ padding: '8px 12px' }}>FALTAM</th><th></th>
              </tr></thead>
              <tbody>
                {rows.map((u: any) => (
                  <tr key={u.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px 12px', color: 'var(--text-primary)', fontWeight: 600 }}>{u.name}<br /><span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-tertiary)' }}>{u.email}</span></td>
                    <td style={{ padding: '8px 12px' }}>{seenChip(u.seen_mins_ago)}</td>
                    <td style={{ padding: '8px 12px' }}>{u.is_paid ? <span className="chip chip-pos">{(u.plan_name || u.plan_code || 'PAGO').toUpperCase()}</span> : <span className="chip chip-mut">FREE</span>}</td>
                    <td className="tnum" style={{ padding: '8px 12px', color: u.is_paid && (u.days_left ?? 99) <= 3 ? '#e06c6c' : 'inherit' }}>{u.is_paid ? `${u.days_left}d` : '—'}</td>
                    <td style={{ padding: '8px 12px' }}><button onClick={() => openProfile(u.id)} className="btn btn-secondary btn-sm">Perfil</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: 12 }}>Sem utilizadores para este filtro.</p>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <button disabled={page <= 1} onClick={() => { setPage((p) => Math.max(1, p - 1)); load(); }} className="btn btn-secondary btn-sm">←</button>
            <span className="tnum" style={{ fontSize: 12 }}>pág {page} · {rows.length}/{total}</span>
            <button disabled={rows.length === 0 || rows.length + (page - 1) * 30 >= total} onClick={() => { setPage((p) => p + 1); load(); }} className="btn btn-secondary btn-sm">→</button>
          </div>
        </>)}
      </main>
    </>
  );
}
