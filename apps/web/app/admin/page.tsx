"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { API, authFetch } from '../../lib/api';
import AdminNav from './AdminNav';

const SECTIONS = [
  { href: '/admin/payments', label: '[Pagamentos]', title: 'Aceitar ou recusar', desc: 'Aprova comprovativos, vê IDs e histórico completo.' },
  { href: '/admin/users', label: '[Clientes]', title: 'Perfis e subscrições', desc: 'Ativos 24h, dias restantes, histórico, favoritos.' },
  { href: '/admin/channels', label: '[Canais]', title: 'FREE / PREMIUM', desc: 'Verificação profunda, acesso e bulk.' },
  { href: '/admin/plans', label: '[Pacotes]', title: 'Preços e canais', desc: 'Edita preços sem restart, gere canais por plano.' },
  { href: '/admin/system', label: '[Sistema]', title: 'Backups R2', desc: 'Snapshots manuais da base de dados.' },
];

export default function Admin() {
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [uQ, setUQ] = useState('');
  const [uFilter, setUFilter] = useState('');
  const [denied, setDenied] = useState(false);
  const [token, setToken] = useState('');
  const [payments, setPayments] = useState<any[]>([]);

  useEffect(() => { setToken(localStorage.getItem('access') || ''); }, []);

  const loadPayments = async () => {
    const r = await authFetch(`${API}/admin/payments`);
    const d = await r.json().catch(() => []);
    setPayments(Array.isArray(d) ? d : []);
  };

  const loadUsers = async () => {
    const p = new URLSearchParams({ limit: '30', page: '1' });
    if (uQ) p.set('q', uQ);
    if (uFilter) p.set(uFilter === 'active' ? 'active' : 'sub', uFilter === 'active' ? '1' : uFilter);
    const r = await authFetch(`${API}/admin/users?${p}`);
    const d = await r.json().catch(() => ({}));
    setUsers(d.data || []); setUsersTotal(d.total || 0);
  };

  useEffect(() => {
    if (!token) return;
    authFetch(`${API}/admin/stats`).then((r) => r.json()).then((d) => {
      if (d.statusCode === 403) { setDenied(true); return; }
      setStats(d);
    }).catch(() => {});
    loadPayments();
  }, [token]);

  useEffect(() => {
    if (!token || denied) return;
    const t = setTimeout(() => loadUsers(), 300);
    return () => clearTimeout(t);
  }, [token, denied, uQ, uFilter]);

  const decide = async (id: string, ok: boolean) => {
    await authFetch(`${API}/admin/payments/${id}/${ok ? 'approve' : 'reject'}`, { method: 'POST' });
    loadPayments();
  };

  if (!token) return (
    <main className="dl-wrap" style={{ paddingTop: 96, paddingBottom: 64 }}>
      <span className="section-label">[Admin]</span>
      <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}><span className="hl-muted">Sem sessão.</span></h1>
      <p><Link href="/login" className="btn btn-primary btn-sm" style={{ marginTop: 16 }}>Ir para login</Link></p>
    </main>
  );

  if (denied) return (
    <main className="dl-wrap" style={{ paddingTop: 96, paddingBottom: 64 }}>
      <span className="section-label">[Admin]</span>
      <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}><span className="hl-muted">Acesso</span> <span className="hl-bright">negado.</span></h1>
      <p>Esta conta não é admin.</p>
      <p><Link href="/" style={{ color: 'var(--accent)' }}>← voltar</Link></p>
    </main>
  );

  const cards: [string, string][] = stats ? [
    ['UTILIZADORES', stats.users],
    ['ATIVOS 24H', stats.activeUsers],
    ['SUBS PAGAS', stats.activeSubs],
    ['PENDENTES', stats.pendingPay],
    ['RECEITA MÊS', `${stats.revenueMonth ?? 0} MT`],
    ['A EXPIRAR 7D', stats.expiring7d],
    ['ONLINE', stats.online],
    ['OFFLINE', stats.offline],
  ] : [];

  const sel: React.CSSProperties = { padding: '8px 10px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)', borderRadius: 8, fontSize: 12 };
  const pending = payments.filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING');

  return (
    <>
      <AdminNav active="/admin" />

      <main className="dl-wrap" style={{ paddingTop: 120, paddingBottom: 32 }}>
        <span className="section-label">[Painel]</span>
        <h1 className="display-headline reveal visible" style={{ fontSize: 'var(--text-h1)' }}>
          <span className="hl-muted">Operação</span> <span className="hl-bright">da plataforma.</span>
        </h1>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 16, margin: '32px 0' }}>
          {cards.map(([k, v], i) => (
            <div key={k} className={`card reveal visible ${k === 'PENDENTES' && Number(v) > 0 ? 'featured' : ''}`} data-delay={i * 90} style={{ padding: 20 }}>
              <div className="arch-meta">{k} // LIVE</div>
              <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}>{v ?? '—'}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginBottom: 16 }}>
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} className="card" style={{ padding: 18, textDecoration: 'none', color: 'inherit' }}>
              <span className="section-label" style={{ margin: 0 }}>{s.label}</span>
              <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 16, marginTop: 4 }}>{s.title} →</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>{s.desc}</div>
            </Link>
          ))}
        </div>

        <section className="card reveal visible" style={{ padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span className="section-label" style={{ margin: 0 }}>[Pagamentos — a aprovar: {pending.length}]</span>
            <Link href="/admin/payments" style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 13, whiteSpace: 'nowrap' }}>Página completa →</Link>
          </div>
          {pending.slice(0, 3).map((p: any) => (
            <div key={p.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '12px 0', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>{p.user_name || p.email} — {p.plan_name} · <span className="tnum">{p.amount} {p.currency}</span></div>
                <div className="tnum" style={{ fontSize: 12, color: 'var(--accent)' }}>ID: {p.provider_transaction_id}</div>
              </div>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button onClick={() => decide(p.id, true)} className="btn btn-primary btn-sm">Aprovar</button>
                <button onClick={() => decide(p.id, false)} className="btn btn-secondary btn-sm">Rejeitar</button>
              </span>
            </div>
          ))}
          {pending.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Nenhum pagamento pendente.</p>
          )}
        </section>

        <section className="card reveal visible" style={{ padding: 24, overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span className="section-label" style={{ margin: 0 }}>[Utilizadores — {usersTotal}]</span>
            <Link href="/admin/users" style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 13, whiteSpace: 'nowrap' }}>Gerir clientes →</Link>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <input value={uQ} onChange={(e) => setUQ(e.target.value)} placeholder="nome ou email…" className="dl-input" style={{ flex: '2 1 180px' }} />
            <select value={uFilter} onChange={(e) => setUFilter(e.target.value)} style={sel}>
              <option value="">Todos</option>
              <option value="active">Ativos 24h</option>
              <option value="paid">Com sub paga</option>
              <option value="expiring">A expirar 7d</option>
              <option value="free">Sem sub paga</option>
            </select>
          </div>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                <th style={{ padding: '8px 12px' }}>CLIENTE</th><th style={{ padding: '8px 12px' }}>VISTO</th><th style={{ padding: '8px 12px' }}>PLANO</th><th style={{ padding: '8px 12px' }}>FALTAM</th><th></th>
              </tr>
            </thead>
            <tbody>
              {users.slice(0, 8).map((u: any) => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '8px 12px', color: 'var(--text-primary)', fontWeight: 600 }}>{u.name}<br /><span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-tertiary)' }}>{u.email}</span></td>
                  <td style={{ padding: '8px 12px' }}>{u.seen_mins_ago === null ? <span className="chip chip-mut">NUNCA</span> : u.seen_mins_ago < 60 ? <span className="chip chip-pos">HÁ {u.seen_mins_ago} MIN</span> : u.seen_mins_ago < 1440 ? <span className="chip chip-pos">HÁ {Math.round(u.seen_mins_ago / 60)} H</span> : <span className="chip chip-mut">HÁ {Math.round(u.seen_mins_ago / 1440)} D</span>}</td>
                  <td style={{ padding: '8px 12px' }}>{u.is_paid ? <span className="chip chip-pos">{(u.plan_name || u.plan_code || 'PAGO').toUpperCase()}</span> : <span className="chip chip-mut">FREE</span>}</td>
                  <td className="tnum" style={{ padding: '8px 12px', color: u.is_paid && (u.days_left ?? 99) <= 3 ? '#e06c6c' : 'inherit' }}>{u.is_paid ? `${u.days_left}d` : '—'}</td>
                  <td style={{ padding: '8px 12px' }}><Link href={`/admin/users?user=${u.id}`} className="btn btn-secondary btn-sm">Perfil</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Sem utilizadores para este filtro.</p>}
          {usersTotal > 8 && <div style={{ marginTop: 10 }}><Link href="/admin/users" style={{ color: 'var(--accent)', fontSize: 13 }}>Ver todos os {usersTotal} →</Link></div>}
        </section>
      </main>

      <div className="footer-wrapper">
        <div className="footer-panel">
          <div className="dl-wrap" style={{ display: 'flex', gap: 24, alignItems: 'center', padding: 0 }}>
            <span className="status-ok">● [ALL SYSTEMS OPERATIONAL]</span>
            <span style={{ marginLeft: 'auto', fontSize: 13 }}><Link href="/">← voltar ao catálogo</Link></span>
          </div>
        </div>
      </div>
    </>
  );
}
