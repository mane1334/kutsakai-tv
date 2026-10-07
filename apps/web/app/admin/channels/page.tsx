"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API, authFetch } from '../../../lib/api';
import AdminNav from '../AdminNav';

export default function AdminChannels() {
  const router = useRouter();
  const [channels, setChannels] = useState<any[]>([]);
  const [chTotal, setChTotal] = useState(0);
  const [chQ, setChQ] = useState('');
  const [chStatus, setChStatus] = useState('');
  const [chAccess, setChAccess] = useState('');
  const [chPage, setChPage] = useState(1);
  const [denied, setDenied] = useState(false);
  const [bulkMsg, setBulkMsg] = useState('');
  const [verifyMsg, setVerifyMsg] = useState('');
  const sel: React.CSSProperties = { padding: '8px 10px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)', borderRadius: 8, fontSize: 12 };

  const loadChannels = async (page = chPage) => {
    const p = new URLSearchParams({ limit: '30', page: String(page) });
    if (chQ) p.set('q', chQ);
    if (chStatus) p.set('status', chStatus);
    if (chAccess) p.set('access', chAccess);
    const r = await authFetch(`${API}/admin/channels?${p}`);
    if (r.status === 403) { setDenied(true); return; }
    const d = await r.json().catch(() => ({}));
    setChannels(d.data || []); setChTotal(d.total || 0);
  };

  useEffect(() => {
    if (!localStorage.getItem('access')) { router.push('/login'); return; }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => loadChannels(), 300);
    return () => clearTimeout(t);
  }, [chQ, chStatus, chAccess, chPage]);

  const toggleAccess = async (c: any) => {
    const next = (c.access_level || 'FREE').toUpperCase() === 'PREMIUM' ? 'FREE' : 'PREMIUM';
    await authFetch(`${API}/admin/channels/${c.id}/access`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessLevel: next }) });
    setChannels((prev) => prev.map((x) => (x.id === c.id ? { ...x, access_level: next } : x)));
  };

  const verifyChannel = async (id: string) => {
    setVerifyMsg('a verificar segmento…');
    const r = await authFetch(`${API}/admin/channels/${id}/verify`, { method: 'POST' }).then((x) => x.json()).catch(() => null);
    setVerifyMsg(r ? `${String(r.status).toUpperCase()}${r.provedBySegment ? ' [segmento provado]' : ''}${r.error ? ` (${r.error})` : ''} fiabilidade ${r.reliability}%` : 'falhou');
    loadChannels();
  };

  const bulkAccess = async (level: 'FREE' | 'PREMIUM') => {
    if (!window.confirm(`Meter TODOS os ${chTotal || '…'} canais em ${level}?`)) return;
    setBulkMsg('a aplicar…');
    const r = await authFetch(`${API}/admin/channels/access-bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessLevel: level }) }).then((x) => x.json()).catch(() => null);
    setBulkMsg(r?.ok ? `${r.updated} canais em ${r.accessLevel}.` : 'falhou');
    loadChannels();
  };

  if (denied) return (<main className="dl-wrap" style={{ paddingTop: 96 }}><p>Acesso negado. <Link href="/admin" style={{ color: 'var(--accent)' }}>← admin</Link></p></main>);

  return (
    <>
      <AdminNav active="/admin/channels" />
      <main className="dl-wrap" style={{ paddingTop: 110, paddingBottom: 48 }}>
        <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}><span className="hl-muted">{chTotal}</span> <span className="hl-bright">canais.</span></h1>
        <section className="card" style={{ padding: 24, marginTop: 20, overflowX: 'auto' }}>
          <span className="section-label">[FREE / PREMIUM + verificação]</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
            <button onClick={() => bulkAccess('PREMIUM')} className="btn btn-primary btn-sm">Tudo PREMIUM</button>
            <button onClick={() => bulkAccess('FREE')} className="btn btn-secondary btn-sm">Tudo FREE</button>
            {bulkMsg && <span className="tnum" style={{ fontSize: 12, color: 'var(--accent)' }}>{bulkMsg}</span>}
            {verifyMsg && <span className="tnum" style={{ fontSize: 12, color: 'var(--accent)' }}>{verifyMsg}</span>}
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
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', display: 'flex', gap: 6 }}>
                    <button onClick={() => toggleAccess(c)} className="btn btn-secondary btn-sm">{(c.access_level || 'FREE').toUpperCase() === 'PREMIUM' ? '→ FREE' : '→ PREMIUM'}</button>
                    <button onClick={() => verifyChannel(c.id)} className="btn btn-secondary btn-sm">Verificar</button>
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
      </main>
    </>
  );
}
