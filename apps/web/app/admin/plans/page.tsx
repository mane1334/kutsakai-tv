"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API, authFetch } from '../../../lib/api';
import AdminNav from '../AdminNav';

export default function AdminPlans() {
  const router = useRouter();
  const [plans, setPlans] = useState<any[]>([]);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [planMsg, setPlanMsg] = useState('');
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [planChannels, setPlanChannels] = useState<Record<string, any[]>>({});
  const [addQ, setAddQ] = useState('');
  const [addResults, setAddResults] = useState<any[]>([]);
  const [verifyMsg, setVerifyMsg] = useState('');
  const [denied, setDenied] = useState(false);

  const loadPlans = async () => {
    const r = await authFetch(`${API}/admin/plans`);
    if (r.status === 403) { setDenied(true); return; }
    const d = await r.json().catch(() => []);
    if (Array.isArray(d)) {
      setPlans(d);
      setPriceEdits(Object.fromEntries(d.map((p: any) => [p.id, String(p.price)])));
    }
  };
  useEffect(() => {
    if (!localStorage.getItem('access')) { router.push('/login'); return; }
    loadPlans();
  }, []);

  const savePrice = async (id: string) => {
    const v = parseFloat(priceEdits[id]);
    if (isNaN(v) || v < 0) { setPlanMsg('preço inválido'); return; }
    const r = await authFetch(`${API}/admin/plans/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price: v }) });
    if (!r.ok) { setPlanMsg('falhou guardar preço'); return; }
    setPlanMsg(`preço atualizado: ${v} MT`);
    loadPlans();
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
  const reloadPlan = async (planId: string) => {
    const d = await authFetch(`${API}/admin/plans/${planId}/channels`).then((r) => r.json());
    setPlanChannels((m) => ({ ...m, [planId]: Array.isArray(d) ? d : [] }));
    loadPlans();
  };
  const addChannel = async (planId: string, channelId: string) => {
    await authFetch(`${API}/admin/plans/${planId}/channels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId }) });
    reloadPlan(planId);
  };
  const removeChannel = async (planId: string, channelId: string) => {
    await authFetch(`${API}/admin/plans/${planId}/channels/${channelId}`, { method: 'DELETE' });
    setPlanChannels((m) => ({ ...m, [planId]: (m[planId] || []).filter((c) => c.id !== channelId) }));
    loadPlans();
  };
  const makeFree = async (channelId: string) => {
    await authFetch(`${API}/admin/channels/${channelId}/make-free`, { method: 'POST' });
    if (openPlan) reloadPlan(openPlan);
  };
  const verifyChannel = async (id: string) => {
    setVerifyMsg('a verificar segmento…');
    const r = await authFetch(`${API}/admin/channels/${id}/verify`, { method: 'POST' }).then((x) => x.json()).catch(() => null);
    setVerifyMsg(r ? `${String(r.status).toUpperCase()}${r.provedBySegment ? ' [segmento provado]' : ''}${r.error ? ` (${r.error})` : ''} fiabilidade ${r.reliability}%` : 'falhou');
  };

  if (denied) return (<main className="dl-wrap" style={{ paddingTop: 96 }}><p>Acesso negado. <Link href="/admin" style={{ color: 'var(--accent)' }}>← admin</Link></p></main>);

  return (
    <>
      <AdminNav active="/admin/plans" />
      <main className="dl-wrap" style={{ paddingTop: 110, paddingBottom: 48 }}>
        <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}><span className="hl-muted">Pacotes</span> <span className="hl-bright">e preços.</span></h1>
        <section className="card" style={{ padding: 24, marginTop: 20 }}>
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
      </main>
    </>
  );
}
