"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API, authFetch } from '../../../lib/api';
import AdminNav from '../AdminNav';

export default function AdminSystem() {
  const router = useRouter();
  const [snapMsg, setSnapMsg] = useState('');
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('access')) router.push('/login');
  }, []);

  const snapshotNow = async () => {
    if (!window.confirm('Guardar snapshot da base de dados no R2 agora?')) return;
    setSnapMsg('a guardar…');
    const r = await authFetch(`${API}/admin/backup/snapshot`, { method: 'POST' }).then((x) => x.json()).catch(() => null);
    if (r?.statusCode === 403) { setDenied(true); return; }
    setSnapMsg(r?.ok ? `guardado às ${r.at?.slice(11, 19) || ''}. Restarts já não apagam nada.` : (r?.message || 'falhou — R2 configurado?'));
  };

  if (denied) return (<main className="dl-wrap" style={{ paddingTop: 96 }}><p>Acesso negado. <Link href="/admin" style={{ color: 'var(--accent)' }}>← admin</Link></p></main>);

  return (
    <>
      <AdminNav active="/admin/system" />
      <main className="dl-wrap" style={{ paddingTop: 110, paddingBottom: 48 }}>
        <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}><span className="hl-muted">Sistema</span> <span className="hl-bright">e backups.</span></h1>
        <section className="card" style={{ padding: 24, marginTop: 20 }}>
          <span className="section-label">[Persistência — snapshot R2]</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
            <button onClick={snapshotNow} className="btn btn-primary btn-sm">Snapshot agora (R2)</button>
            {snapMsg && <span className="tnum" style={{ fontSize: 12, color: 'var(--accent)' }}>{snapMsg}</span>}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '8px 0 0' }}>
            Guarda a base de dados no R2 para sobreviver a restarts do Render. Sem R2 configurado, o botão responde "R2 sem configurar".
          </p>
        </section>
      </main>
    </>
  );
}
