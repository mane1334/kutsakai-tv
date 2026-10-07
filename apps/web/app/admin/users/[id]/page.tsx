"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { API, authFetch } from '../../../../lib/api';

export default function ClientProfile() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;
  const [d, setD] = useState<any>(null);
  const [denied, setDenied] = useState(false);
  const [msg, setMsg] = useState('');
  const [days, setDays] = useState('30');

  const load = async () => {
    const r = await authFetch(`${API}/admin/users/${id}`);
    if (r.status === 403) { setDenied(true); return; }
    if (r.status === 404) { router.push('/admin'); return; }
    setD(await r.json().catch(() => null));
  };
  useEffect(() => {
    if (!localStorage.getItem('access')) { router.push('/login'); return; }
    if (id) load();
  }, [id]);

  const extend = async () => {
    const cur = d?.subscriptions?.find((s: any) => s.is_current);
    if (!cur) return;
    setMsg('a estender…');
    const r = await authFetch(`${API}/admin/subscriptions/${cur.id}/extend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: parseInt(days) || 30 }) });
    setMsg(r.ok ? 'Subscrição estendida.' : 'falhou');
    load();
  };
  const cancel = async (sid: string) => {
    if (!window.confirm('Cancelar esta subscrição?')) return;
    await authFetch(`${API}/admin/subscriptions/${sid}/cancel`, { method: 'POST' });
    setMsg('Subscrição cancelada.');
    load();
  };

  if (denied) return (<main className="dl-wrap" style={{ paddingTop: 96 }}><p>Acesso negado. <Link href="/admin" style={{ color: 'var(--accent)' }}>← admin</Link></p></main>);
  if (!d) return (<main className="dl-wrap" style={{ paddingTop: 96 }}><p>A carregar…</p></main>);
  const { user, subscriptions, history, favorites, payments: pays, prefs, watchCount, watchSeconds } = d;
  const cur = subscriptions.find((s: any) => s.is_current);
  const seen = user.last_seen ? Math.max(0, Math.round((Date.now() - new Date(user.last_seen).getTime()) / 60000)) : null;

  return (
    <>
      <nav className="nav scrolled">
        <div className="dl-wrap" style={{ display: 'flex', alignItems: 'center', gap: 24, paddingTop: 16, paddingBottom: 16 }}>
          <Link href="/admin" style={{ fontWeight: 800, color: 'var(--text-primary)', textDecoration: 'none' }}>← Admin</Link>
          <span className="section-label" style={{ margin: 0 }}>[Cliente]</span>
        </div>
      </nav>
      <main className="dl-wrap" style={{ paddingTop: 110, paddingBottom: 48 }}>
        <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}><span className="hl-bright">{user.name}</span></h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>{user.email} · {(user.country || '—').toUpperCase()} · desde {user.created_at?.slice(0, 10)} · {seen === null ? 'nunca visto' : seen < 60 ? `visto há ${seen} min` : seen < 1440 ? `visto há ${Math.round(seen / 60)}h` : `visto há ${Math.round(seen / 1440)}d`}</p>

        <div className={`card ${cur ? 'featured' : ''}`} style={{ padding: 24, marginTop: 20 }}>
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
          {subscriptions.filter((s: any) => !s.is_current).length > 0 && (
            <details style={{ marginTop: 12, fontSize: 12 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-tertiary)' }}>Histórico de subscrições ({subscriptions.length - 1})</summary>
              <ul>{subscriptions.filter((s: any) => !s.is_current).map((s: any) => <li key={s.id}>{s.plan_name || s.plan} · {s.status} · {s.started_at?.slice(0, 10)} → {s.expires_at?.slice(0, 10) || '—'}</li>)}</ul>
            </details>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16, marginTop: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <span className="section-label">[Últimos canais — {watchCount}]</span>
            <div className="tnum" style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>{Math.round((watchSeconds || 0) / 3600)}H VISTAS NO TOTAL</div>
            <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13 }}>
              {history.map((h: any) => <li key={h.id}>{h.channel_name || 'canal'} — {Math.round((h.duration_sec || 0) / 60)}min · {h.started_at?.slice(0, 16).replace('T', ' ')}</li>)}
              {!history.length && <li style={{ color: 'var(--text-tertiary)' }}>Nunca viu nada.</li>}
            </ul>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <span className="section-label">[Favoritos — {favorites.length}]</span>
            <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13 }}>
              {favorites.map((f: any) => <li key={f.id}>{f.name}</li>)}
              {!favorites.length && <li style={{ color: 'var(--text-tertiary)' }}>Sem favoritos.</li>}
            </ul>
            <div className="arch-meta" style={{ marginTop: 12 }}>GOSTOS // {(prefs?.categories ? JSON.parse(prefs.categories || '[]') : []).join(', ') || '—'}</div>
            <div className="arch-meta">LÍNGUAS // {(prefs?.languages ? JSON.parse(prefs.languages || '[]') : []).join(', ') || '—'}</div>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <span className="section-label">[Pagamentos — {pays.length}]</span>
            <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13 }}>
              {pays.map((p: any) => <li key={p.id}>{p.plan_name} · {p.amount} {p.currency} · {p.status} · {p.created_at?.slice(0, 10)}</li>)}
              {!pays.length && <li style={{ color: 'var(--text-tertiary)' }}>Sem pagamentos.</li>}
            </ul>
          </div>
        </div>
      </main>
    </>
  );
}
