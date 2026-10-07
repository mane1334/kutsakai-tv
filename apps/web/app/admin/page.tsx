"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API, authFetch, logout } from '../../lib/api';

export default function Admin() {
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [chTotal, setChTotal] = useState(0);
  const [chQ, setChQ] = useState('');
  const [chStatus, setChStatus] = useState('');
  const [chAccess, setChAccess] = useState('');
  const [chPage, setChPage] = useState(1);
  const [users, setUsers] = useState<any[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [uQ, setUQ] = useState('');
  const [uFilter, setUFilter] = useState(''); // '' | active | paid | free | expiring
  const [uPage, setUPage] = useState(1);
  const [denied, setDenied] = useState(false);
  const [token, setToken] = useState('');
  const [payments, setPayments] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [planMsg, setPlanMsg] = useState('');
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [planChannels, setPlanChannels] = useState<Record<string, any[]>>({});
  const [addQ, setAddQ] = useState('');
  const [addResults, setAddResults] = useState<any[]>([]);
  const [verifyMsg, setVerifyMsg] = useState('');
  const [bulkMsg, setBulkMsg] = useState('');
  const [snapMsg, setSnapMsg] = useState('');

  const snapshotNow = async () => {
    if (!window.confirm('Guardar snapshot da base de dados no R2 agora?')) return;
    setSnapMsg('a guardar…');
    const r = await authFetch(`${API}/admin/backup/snapshot`, { method: 'POST' }).then((x) => x.json()).catch(() => null);
    setSnapMsg(r?.ok ? `guardado às ${r.at?.slice(11, 19) || ''}. Restarts já não apagam nada.` : (r?.message || 'falhou — R2 configurado?'));
  };

  const loadPlans = async () => {
    const r = await authFetch(`${API}/admin/plans`);
    const d = await r.json().catch(() => []);
    if (Array.isArray(d)) {
      setPlans(d);
      setPriceEdits(Object.fromEntries(d.map((p: any) => [p.id, String(p.price)])));
    }
  };
  const togglePlan = async (id: string) => {
    const next = openPlan === id ? null : id;
    setOpenPlan(next); setAddResults([]); setAddQ('');
    if (next) {
      const r = await authFetch(`${API}/admin/plans/${id}/channels`);
      const d = await r.json().catch(() => []);
      setPlanChannels((m) => ({ ...m, [id]: Array.isArray(d) ? d : [] }));
    }
  };
  const searchAdd = async () => {
    const d = await fetch(`${API}/channels?limit=10&q=${encodeURIComponent(addQ)}`).then((r) => r.json()).catch(() => null);
    setAddResults(d?.data || []);
  };
  const addChannel = async (planId: string, channelId: string) => {
    await authFetch(`${API}/admin/plans/${planId}/channels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId }) });
    const d = await authFetch(`${API}/admin/plans/${planId}/channels`).then((r) => r.json());
    setPlanChannels((m) => ({ ...m, [planId]: Array.isArray(d) ? d : [] }));
    loadPlans();
    loadChannels();
  };
  const removeChannel = async (planId: string, channelId: string) => {
    await authFetch(`${API}/admin/plans/${planId}/channels/${channelId}`, { method: 'DELETE' });
    setPlanChannels((m) => ({ ...m, [planId]: (m[planId] || []).filter((c) => c.id !== channelId) }));
    loadPlans();
    loadChannels();
  };
  const makeFree = async (channelId: string) => {
    await authFetch(`${API}/admin/channels/${channelId}/make-free`, { method: 'POST' });
    if (openPlan) {
      const d = await authFetch(`${API}/admin/plans/${openPlan}/channels`).then((r) => r.json());
      setPlanChannels((m) => ({ ...m, [openPlan]: Array.isArray(d) ? d : [] }));
    }
    loadPlans();
    loadChannels();
  };
  const verifyChannel = async (id: string) => {
    setVerifyMsg('a verificar segmento…');
    const r = await authFetch(`${API}/admin/channels/${id}/verify`, { method: 'POST' }).then((x) => x.json()).catch(() => null);
    setVerifyMsg(r ? `${String(r.status).toUpperCase()}${r.provedBySegment ? ' [segmento provado]' : ''}${r.error ? ` (${r.error})` : ''} fiabilidade ${r.reliability}%` : 'falhou');
    loadChannels();
  };

  const savePrice = async (id: string) => {
    const v = parseFloat(priceEdits[id]);
    if (isNaN(v) || v < 0) { setPlanMsg('preço inválido'); return; }
    const r = await authFetch(`${API}/admin/plans/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price: v }) });
    if (!r.ok) { setPlanMsg('falhou guardar preço'); return; }
    setPlanMsg(`preço atualizado: ${v} MT`);
    loadPlans();
  };

  const toggleAccess = async (c: any) => {
    const next = (c.access_level || 'FREE').toUpperCase() === 'PREMIUM' ? 'FREE' : 'PREMIUM';
    await authFetch(`${API}/admin/channels/${c.id}/access`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessLevel: next }) });
    setChannels((prev) => prev.map((x) => (x.id === c.id ? { ...x, access_level: next } : x)));
  };

  // bulk: mete TUDO num nível e depois escolhes à mão os FREE, um a um
  const bulkAccess = async (level: 'FREE' | 'PREMIUM') => {
    const label = level === 'PREMIUM' ? 'PREMIUM (só sub paga vê)' : 'FREE (todos veem)';
    if (!window.confirm(`Meter TODOS os ${chTotal || '…'} canais em ${label}?`)) return;
    setBulkMsg('a aplicar…');
    const r = await authFetch(`${API}/admin/channels/access-bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessLevel: level }) }).then((x) => x.json()).catch(() => null);
    setBulkMsg(r?.ok ? `${r.updated} canais em ${r.accessLevel}. Agora escolhe os FREE um a um na tabela.` : 'falhou');
    loadPlans();
    loadChannels();
  };

  const loadChannels = async (page = chPage) => {
    const p = new URLSearchParams({ limit: '30', page: String(page) });
    if (chQ) p.set('q', chQ);
    if (chStatus) p.set('status', chStatus);
    if (chAccess) p.set('access', chAccess);
    const r = await authFetch(`${API}/admin/channels?${p}`);
    const d = await r.json().catch(() => ({}));
    setChannels(d.data || []); setChTotal(d.total || 0);
  };

  useEffect(() => { setToken(localStorage.getItem('access') || ''); }, []);

  const loadPayments = async () => {
    const r = await authFetch(`${API}/admin/payments`);
    const d = await r.json().catch(() => []);
    setPayments(Array.isArray(d) ? d : []);
  };

  useEffect(() => {
    if (!token) return;
    authFetch(`${API}/admin/stats`).then((r) => r.json()).then((d) => {
      if (d.statusCode === 403) { setDenied(true); return; }
      setStats(d);
    }).catch(() => {});
    loadPayments();
    loadPlans();
  }, [token]);

  const loadUsers = async (page = uPage) => {
    const p = new URLSearchParams({ limit: '30', page: String(page) });
    if (uQ) p.set('q', uQ);
    if (uFilter) p.set(uFilter === 'active' ? 'active' : 'sub', uFilter === 'active' ? '1' : uFilter);
    const r = await authFetch(`${API}/admin/users?${p}`);
    const d = await r.json().catch(() => ({}));
    setUsers(d.data || []); setUsersTotal(d.total || 0);
  };

  useEffect(() => {
    if (!token || denied) return;
    const t = setTimeout(() => loadUsers(1), 300);
    return () => clearTimeout(t);
  }, [token, denied, uQ, uFilter]);

  useEffect(() => {
    if (!token || denied) return;
    const t = setTimeout(() => loadChannels(), 300);
    return () => clearTimeout(t);
  }, [token, denied, chQ, chStatus, chAccess, chPage]);

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
      <p>Esta conta não é admin. Promove com o script make-admin ou pede a um admin.</p>
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

  return (
    <>
      <nav className="nav scrolled">
        <div className="dl-wrap" style={{ display: 'flex', alignItems: 'center', gap: 24, paddingTop: 16, paddingBottom: 16 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, color: 'var(--text-primary)', textDecoration: 'none' }}><img src="/assets/icon.jpg" alt="Kutsakai TV" style={{ width: 24, height: 24, borderRadius: 6 }} />Kutsakai<span style={{ color: 'var(--accent)' }}> TV</span></Link>
          <span className="section-label" style={{ margin: 0 }}>[Admin]</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/" className="btn btn-secondary btn-sm">← voltar</Link>
            <button onClick={() => logout((h) => router.push(h))} className="btn btn-secondary btn-sm">Sair</button>
          </span>
        </div>
      </nav>

      <main className="dl-wrap" style={{ paddingTop: 120, paddingBottom: 32 }}>
        <span className="section-label">[Painel]</span>
        <h1 className="display-headline reveal visible" style={{ fontSize: 'var(--text-h1)' }}>
          <span className="hl-muted">Operação</span> <span className="hl-bright">da plataforma.</span>
        </h1>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 16, margin: '32px 0 48px' }}>
          {cards.map(([k, v], i) => (
            <div key={k} className={`card reveal visible ${k === 'ONLINE' ? 'featured' : ''}`} data-delay={i * 90} style={{ padding: 20 }}>
              <div className="arch-meta">{k} // LIVE</div>
              <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}>{v ?? '—'}</div>
            </div>
          ))}
        </div>

        <section className="card reveal visible" style={{ padding: 24, marginBottom: 16 }}>
          <span className="section-label">[Persistência — snapshot R2]</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
            <button onClick={snapshotNow} className="btn btn-primary btn-sm">Snapshot agora (R2)</button>
            {snapMsg && <span className="tnum" style={{ fontSize: 12, color: 'var(--accent)' }}>{snapMsg}</span>}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '8px 0 0' }}>
            Guarda a base de dados no R2 para sobreviver a restarts do Render. Sem R2 configurado, o botão responde "R2 sem configurar".
          </p>
        </section>

        <section className="card reveal visible" style={{ padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span className="section-label" style={{ margin: 0 }}>[Pagamentos — a aprovar: {payments.filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING').length}]</span>
            <Link href="/admin/payments" style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 13, whiteSpace: 'nowrap' }}>Página completa →</Link>
          </div>
          {payments.filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING').slice(0, 3).map((p: any) => (
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
          {payments.filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING').length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Nenhum pagamento pendente.</p>
          )}
        </section>

        <section className="card reveal visible" style={{ padding: 24, marginBottom: 16 }}>
          <span className="section-label">[Preços — edita sem restart]</span>
          {planMsg && <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 6 }}>{planMsg}</div>}
          {plans.map((pl: any) => (
            <div key={pl.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', padding: '10px 0' }}>
              <b style={{ color: 'var(--text-primary)', minWidth: 140 }}>{pl.name}</b>
              <span className="tnum" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{pl.code.toUpperCase()} · {pl.duration_days || 0}d · {pl.channels ?? 0} canais</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={priceEdits[pl.id] ?? ''} onChange={(e) => setPriceEdits((m) => ({ ...m, [pl.id]: e.target.value }))} inputMode="decimal" className="dl-input" style={{ width: 110 }} />
                <span style={{ fontSize: 12 }}>MT</span>
                <button onClick={() => savePrice(pl.id)} className="btn btn-primary btn-sm">Guardar</button>
                <button onClick={() => togglePlan(pl.id)} className="btn btn-secondary btn-sm">{openPlan === pl.id ? 'Fechar' : 'Gerir canais'}</button>
              </span>
            </div>
          ))}
          {plans.filter((p) => p.id === openPlan).length === 0 && openPlan && null}
          {openPlan && (
            <div style={{ marginTop: 10, borderTop: '1px dashed var(--border-medium)', paddingTop: 10 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={addQ} onChange={(e) => setAddQ(e.target.value)} placeholder="pesquisar canal online para adicionar…" className="dl-input" style={{ flex: 1 }} />
                <button onClick={searchAdd} className="btn btn-secondary btn-sm">Pesquisar</button>
              </div>
              {addResults.map((c: any) => (
                <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '4px 0' }}>
                  <span style={{ color: c.status === 'online' ? 'var(--success)' : '#e06c6c' }}>●</span>
                  <span style={{ flex: 1 }}>{c.name} <span className="tnum" style={{ color: 'var(--text-tertiary)' }}>{c.status} {Math.round(c.reliability_score || 0)}%</span></span>
                  <button onClick={() => openPlan && addChannel(openPlan, c.id)} className="btn btn-secondary btn-sm">Adicionar</button>
                </div>
              ))}
              <ul style={{ paddingLeft: 18, margin: '8px 0 0', fontSize: 12 }}>
                {(planChannels[openPlan] || []).map((c: any) => (
                  <li key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                    <span style={{ flex: 1 }}>{c.name} <span className="tnum" style={{ color: 'var(--text-tertiary)' }}>{c.status}</span></span>
                    <button onClick={() => verifyChannel(c.id)} className="btn btn-secondary btn-sm">Verificar</button>
                    <button onClick={() => openPlan && removeChannel(openPlan, c.id)} className="btn btn-secondary btn-sm">Remover</button>
                        <button onClick={() => makeFree(c.id)} className="btn btn-secondary btn-sm" title="Sai dos pacotes e fica grátis">FREE</button>
                  </li>
                ))}
                {!(planChannels[openPlan] || []).length && <li style={{ color: 'var(--text-tertiary)' }}>Sem canais atribuídos.</li>}
              </ul>
              {verifyMsg && <div className="tnum" style={{ fontSize: 11, color: 'var(--accent)', marginTop: 6 }}>{verifyMsg}</div>}
            </div>
          )}
        </section>

        <section className="card reveal visible" style={{ padding: 24, marginBottom: 16, overflowX: 'auto' }}>
          <span className="section-label">[Canais — {chTotal} · FREE/PREMIUM]</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
            <button onClick={() => bulkAccess('PREMIUM')} className="btn btn-primary btn-sm">Tudo PREMIUM</button>
            <button onClick={() => bulkAccess('FREE')} className="btn btn-secondary btn-sm">Tudo FREE</button>
            {bulkMsg && <span className="tnum" style={{ fontSize: 12, color: 'var(--accent)' }}>{bulkMsg}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <input value={chQ} onChange={(e) => { setChQ(e.target.value); setChPage(1); }} placeholder="pesquisar nome…" className="dl-input" style={{ flex: '2 1 180px' }} />
            <select value={chStatus} onChange={(e) => { setChStatus(e.target.value); setChPage(1); }} style={sel}>
              <option value="">Status: todos</option>
              <option value="online">online</option><option value="degraded">degraded</option><option value="offline">offline</option><option value="unknown">unknown</option>
            </select>
            <select value={chAccess} onChange={(e) => { setChAccess(e.target.value); setChPage(1); }} style={sel}>
              <option value="">Acesso: todos</option>
              <option value="FREE">FREE</option><option value="PREMIUM">PREMIUM</option>
            </select>
          </div>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                <th style={{ padding: '8px 12px' }}>NOME</th><th style={{ padding: '8px 12px' }}>PAÍS</th><th style={{ padding: '8px 12px' }}>STATUS</th><th style={{ padding: '8px 12px' }}>ACESSO</th><th style={{ padding: '8px 12px' }}>SCORE</th><th></th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c: any) => (
                <tr key={c.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '8px 12px', color: 'var(--text-primary)', fontWeight: 600 }}>{c.name}</td>
                  <td style={{ padding: '8px 12px' }}>{(c.country || '—').toUpperCase()}</td>
                  <td style={{ padding: '8px 12px', color: c.status === 'online' ? 'var(--success)' : c.status === 'offline' ? '#e06c6c' : 'var(--text-body)' }}>{c.status.toUpperCase()}</td>
                  <td style={{ padding: '8px 12px' }}><span className={(c.access_level || 'FREE').toUpperCase() === 'PREMIUM' ? 'chip chip-warn' : 'chip chip-mut'}>{(c.access_level || 'FREE').toUpperCase()}</span></td>
                  <td style={{ padding: '8px 12px' }}>{Math.round(c.reliability_score || 0)}%</td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                    <button onClick={() => toggleAccess(c)} className="btn btn-secondary btn-sm">{(c.access_level || 'FREE').toUpperCase() === 'PREMIUM' ? '→ FREE' : '→ PREMIUM'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <button disabled={chPage <= 1} onClick={() => setChPage((p) => Math.max(1, p - 1))} className="btn btn-secondary btn-sm">←</button>
            <span className="tnum" style={{ fontSize: 12 }}>pág {chPage} · {channels.length}/{chTotal}</span>
            <button disabled={channels.length === 0 || channels.length + (chPage - 1) * 30 >= chTotal} onClick={() => setChPage((p) => p + 1)} className="btn btn-secondary btn-sm">→</button>
          </div>
        </section>

        <section className="card reveal visible" style={{ padding: 24, overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span className="section-label" style={{ margin: 0 }}>[Utilizadores — {usersTotal}]</span>
            <Link href="/admin/payments" style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 13, whiteSpace: 'nowrap' }}>Pagamentos →</Link>
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
              {users.map((u: any) => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '8px 12px', color: 'var(--text-primary)', fontWeight: 600 }}>{u.name}<br /><span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-tertiary)' }}>{u.email}</span></td>
                  <td style={{ padding: '8px 12px' }}>{u.seen_mins_ago === null ? <span className="chip chip-mut">NUNCA</span> : u.seen_mins_ago < 60 ? <span className="chip chip-pos">HÁ {u.seen_mins_ago} MIN</span> : u.seen_mins_ago < 1440 ? <span className="chip chip-pos">HÁ {Math.round(u.seen_mins_ago / 60)} H</span> : <span className="chip chip-mut">HÁ {Math.round(u.seen_mins_ago / 1440)} D</span>}</td>
                  <td style={{ padding: '8px 12px' }}>{u.is_paid ? <span className="chip chip-pos">{(u.plan_name || u.plan_code || 'PAGO').toUpperCase()}</span> : <span className="chip chip-mut">FREE</span>}</td>
                  <td className="tnum" style={{ padding: '8px 12px', color: u.is_paid && (u.days_left ?? 99) <= 3 ? '#e06c6c' : 'inherit' }}>{u.is_paid ? `${u.days_left}d` : '—'}</td>
                  <td style={{ padding: '8px 12px' }}><Link href={`/admin/users/${u.id}`} className="btn btn-secondary btn-sm">Perfil</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Sem utilizadores para este filtro.</p>}
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
