"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/v1';
const STEPS = ['Escolhe o plano', 'Método', 'Paga e confirma', 'Ativação'];

export default function Plans() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [plans, setPlans] = useState<any[]>([]);
  const [methods, setMethods] = useState<any[]>([]);
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState<any>(null);
  const [method, setMethod] = useState('');
  const [phone, setPhone] = useState('');
  const [pay, setPay] = useState<any>(null);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);
  const [receiptState, setReceiptState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => { setToken(localStorage.getItem('access') || ''); }, []);
  useEffect(() => {
    fetch(`${API}/plans`).then(r => r.json()).then(d => setPlans(Array.isArray(d) ? d : []));
    fetch(`${API}/payment-methods`).then(r => r.json()).then(d => {
      const list = (Array.isArray(d) ? d : []).filter((m: any) => m.id !== 'mock');
      setMethods(list);
      if (list[0]) setMethod(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!pay || !['PENDING', 'PROCESSING'].includes(pay.status)) return;
    const t = setInterval(async () => {
      let f = await fetch(`${API}/payments/${pay.id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('access') || ''}` } }).then(r => r.json()).catch(() => null);
      if (f?.statusCode === 401) {
        const r = await fetch(`${API}/auth/refresh`, { method: 'POST', credentials: 'include' }).then(x => x.json()).catch(() => null);
        if (!r?.accessToken) { clearInterval(t); router.push('/login'); return; }
        localStorage.setItem('access', r.accessToken);
        setToken(r.accessToken);
        f = await fetch(`${API}/payments/${pay.id}`, { headers: { Authorization: `Bearer ${r.accessToken}` } }).then(x => x.json()).catch(() => null);
      }
      if (!f || f.statusCode) return;
      setPay((p: any) => ({ ...f, plan: p?.plan, method: p?.method }));
      if (f.status === 'COMPLETED') { clearInterval(t); setTimeout(() => router.push('/tv'), 1800); }
      if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(f.status)) clearInterval(t);
    }, 4000);
    return () => clearInterval(t);
  }, [pay?.id]);

  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const onReceiptFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) { setError('Foto demasiado grande (máx 2MB)'); return; }
    const rd = new FileReader();
    rd.onload = () => setReceipt(String(rd.result));
    rd.readAsDataURL(file);
  };

  const sendReceipt = async () => {
    if (!receipt) return;
    setReceiptState('sending');
    try {
      const res = await authFetch(`${API}/payments/${pay.id}/receipt`, {
        method: 'POST',
        body: JSON.stringify({ image: receipt }),
      });
      if (!res.ok) { setReceiptState('error'); return; }
      setReceiptState('sent');
      const f = await fetch(`${API}/payments/${pay.id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('access') || ''}` } }).then(r => r.json());
      setPay((p: any) => ({ ...f, plan: p?.plan, method: p?.method }));
    } catch { setReceiptState('error'); }
  };

  const choosePlan = (p: any) => {
    if (!token) { router.push('/login'); return; }
    if (p.price === 0) { router.push('/catalog'); return; }
    setSel(p); setPay(null); setError(''); setReceipt(null); setReceiptState('idle'); setStep(1);
  };

  const authFetch = async (url: string, opts: any = {}) => {
    const tok = () => localStorage.getItem('access') || '';
    let res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), Authorization: `Bearer ${tok()}` } });
    if (res.status === 401) {
      const r = await fetch(`${API}/auth/refresh`, { method: 'POST', credentials: 'include' }).then(x => x.json()).catch(() => null);
      if (!r?.accessToken) { router.push('/login'); throw new Error('expired'); }
      localStorage.setItem('access', r.accessToken);
      setToken(r.accessToken);
      res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), Authorization: `Bearer ${r.accessToken}` } });
    }
    return res;
  };

  const create = async () => {
    setError('');
    try {
      const res = await authFetch(`${API}/payments`, {
        method: 'POST',
        body: JSON.stringify({ planId: sel.id, provider: method, phone: phone || undefined }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.message || 'falhou criar pagamento'); return; }
      setPay({ ...d, plan: sel, method });
      setStep(3);
    } catch (e: any) {
      if (e.message !== 'expired') setError('API indisponível');
    }
  };

  const m = methods.find((x) => x.id === (pay?.provider || method));
  const waText = pay ? encodeURIComponent(`Olá Kutsakai TV! Paguei ${pay.plan?.price ?? sel?.price} MT (${pay.plan?.name ?? sel?.name}) via ${(m?.label || '').toUpperCase()}. Referência: ${(pay.providerTransactionId || '').replace(/^(MPESA|EMOLA|MOCK)-/, '')}. O meu número: ${phone || '(ver perfil)'}. Segue o comprovativo.`) : '';
  const waLink = pay && m?.whatsapp ? `https://wa.me/${m.whatsapp}?text=${waText}` : '';

  return (
    <>
      <nav className="nav scrolled">
        <div className="dl-wrap" style={{ display: 'flex', alignItems: 'center', gap: 24, paddingTop: 16, paddingBottom: 16 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, color: 'var(--text-primary)', textDecoration: 'none' }}><img src="/assets/icon.jpg" alt="" style={{ width: 24, height: 24, borderRadius: 6 }} />Kutsakai<span style={{ color: 'var(--accent)' }}> TV</span></Link>
          <Link href="/plans">Planos</Link>
          <span style={{ marginLeft: 'auto' }}>{!token && <Link href="/login" className="btn btn-secondary btn-sm">Entrar</Link>}</span>
        </div>
      </nav>

      <main className="dl-wrap" style={{ paddingTop: 110, paddingBottom: 48 }}>
        <span className="section-label">[Planos]</span>
        <h1 className="display-headline" style={{ fontSize: 'var(--text-h1)' }}>
          <span className="hl-muted">Preço de</span> <span className="hl-bright">Moçambique.</span>
        </h1>
        <p>Paga com M-Pesa ou e-Mola, confirma no WhatsApp e o admin ativa em minutos.</p>

        <div style={{ display: 'flex', gap: 8, margin: '28px 0', flexWrap: 'wrap' }}>
          {STEPS.map((s, i) => (
            <span key={s} className="tnum" style={{ fontSize: 11, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--border-medium)', color: i === step ? 'var(--accent)' : 'var(--text-tertiary)', borderColor: i === step ? 'var(--border-accent)' : undefined }}>
              {i + 1}. {s}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 16 }}>
            {plans.map((p) => (
              <button key={p.id} onClick={() => choosePlan(p)} className={`card ${p.code === 'monthly' ? 'featured' : ''} ${sel?.id === p.id ? 'featured' : ''}`} style={{ padding: 24, textAlign: 'left', cursor: 'pointer', color: 'inherit', fontFamily: 'inherit' }}>
                <div className="arch-meta">{p.code.toUpperCase()} // {p.duration_days ? `${p.duration_days} DIAS` : 'PARA SEMPRE'}{typeof p.channels === 'number' && p.duration_days ? ` // ${p.channels} CANAIS` : ''}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{p.name}</div>
                <div style={{ margin: '12px 0' }}>
                  <span className="tnum" style={{ fontSize: 34, fontWeight: 800, color: 'var(--text-primary)' }}>{p.price}</span>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}> MT{p.duration_days ? ` / ${p.duration_days === 1 ? 'dia' : p.duration_days === 7 ? 'semana' : 'mês'}` : ''}</span>
                </div>
                <ul style={{ paddingLeft: 18, margin: '0 0 20px', fontSize: 13 }}>
                  {(p.features || []).map((f: string) => <li key={f}>{f}</li>)}
                </ul>
                <span className={p.price === 0 ? 'btn btn-secondary' : 'btn btn-primary'} style={{ width: '100%', justifyContent: 'center' }}>{p.price === 0 ? 'Usar grátis' : 'Escolher'}</span>
              </button>
            ))}
          </div>
        )}

        {step >= 1 && sel && !pay && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16, maxWidth: 860 }}>
            <div className="card" style={{ padding: 24 }}>
              <span className="section-label">[Passo 2 — método]</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {methods.map((x) => (
                  <button key={x.id} onClick={() => setMethod(x.id)} className={method === x.id ? 'btn btn-primary' : 'btn btn-secondary'} style={{ justifyContent: 'space-between' }}>
                    <span>{x.label}</span><span className="tnum" style={{ fontSize: 11 }}>{x.kind === 'auto' ? 'AUTOMÁTICO' : 'VIA ADMIN'}</span>
                  </button>
                ))}
              </div>
              <div className="arch-meta" style={{ marginTop: 16 }}>O TEU NÚMERO // para localizar o pagamento</div>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="ex. 841234567" inputMode="tel" className="dl-input" />
            </div>
            <div className="card featured" style={{ padding: 24 }}>
              <span className="section-label">[Resumo]</span>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{sel.name}</div>
              <div className="tnum" style={{ fontSize: 30, fontWeight: 800, color: 'var(--text-primary)', margin: '8px 0' }}>{sel.price} <span style={{ fontSize: 15, color: 'var(--accent)' }}>MT</span></div>
              <div style={{ fontSize: 13 }}>Método: <b>{m?.label}</b>{m?.merchant ? ` → ${m.merchant}` : ' (número comercial a configurar)'}</div>
              {error && <div style={{ fontSize: 13, color: '#e06c6c', marginTop: 8 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button onClick={create} className="btn btn-primary">Confirmar pedido</button>
                <button onClick={() => setStep(0)} className="btn btn-secondary">Voltar</button>
              </div>
            </div>
          </div>
        )}

        {pay && (
          <div className="card featured" style={{ padding: 32, marginTop: 8, maxWidth: 640, textAlign: 'center' }}>
            {['PENDING', 'PROCESSING'].includes(pay.status) && <>
              <span className="section-label">[Passo 3 — paga]</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, margin: '16px 0', textAlign: 'left' }}>
                {[
                  ['VALOR', `${pay.plan?.price ?? sel?.price} MT`],
                  ['NÚMERO', m?.merchant || 'por configurar'],
                  ['REFERÊNCIA', (pay.providerTransactionId || '').replace(/^(MPESA|EMOLA|MOCK)-/, '')],
                ].map(([k, v]) => (
                  <div key={k} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-medium)', borderRadius: 12, padding: '12px 14px' }}>
                    <div className="arch-meta" style={{ margin: '0 0 4px' }}>{k} // toca para copiar</div>
                    <button onClick={() => copy(k, v)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, width: '100%', textAlign: 'left' }}>
                      <span className="tnum" style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>{v}</span>
                      <span style={{ fontSize: 11, color: copied === k ? 'var(--success)' : 'var(--accent)', marginLeft: 8 }}>{copied === k ? 'copiado ✓' : 'copiar'}</span>
                    </button>
                  </div>
                ))}
              </div>
              <div className="tnum" style={{ fontSize: 13, textAlign: 'left', marginBottom: 16 }}>1. No teu telemóvel, transfere o valor para o número acima via {m?.label} com a referência indicada.</div>

              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16, textAlign: 'left' }}>
                <span className="section-label">[Passo 4 — foto do comprovativo]</span>
                <div className="tnum" style={{ fontSize: 13, marginBottom: 10 }}>2. Tira foto do SMS/recibo e anexa aqui — o admin confirma pelo ID:</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                    {receipt ? 'Trocar foto' : 'Escolher foto'}
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => onReceiptFile(e.target.files?.[0])} />
                  </label>
                  {receipt && receiptState !== 'sent' && <button onClick={sendReceipt} disabled={receiptState === 'sending'} className="btn btn-primary btn-sm">{receiptState === 'sending' ? 'A enviar…' : 'Enviar foto'}</button>}
                  {receiptState === 'sent' && <span className="chip chip-pos">FOTO RECEBIDA</span>}
                  {receiptState === 'error' && <span style={{ fontSize: 12, color: '#e06c6c' }}>Falhou o envio — tenta de novo.</span>}
                </div>
                {receipt && <img src={receipt} alt="comprovativo" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 12, marginTop: 10, border: '1px solid var(--border-medium)' }} />}
              </div>

              <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 16, paddingTop: 16 }}>
                <div className="tnum" style={{ fontSize: 13, marginBottom: 12 }}>3. Toca abaixo e envia também pelo WhatsApp ↓</div>
                {waLink
                  ? <a href={waLink} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ fontSize: 16, padding: '14px 32px' }}>Enviar no WhatsApp</a>
                  : <p style={{ fontSize: 13 }}>WhatsApp do admin por configurar — guarda a referência <b className="tnum">{pay.providerTransactionId}</b>.</p>}
              </div>

              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
                <span className="section-label">[Passo 5 — ativação]</span>
                <p style={{ fontSize: 13 }}>Pagamento {pay.status === 'PROCESSING' ? 'em análise (foto recebida)' : 'pendente'} — o admin confirma pelo ID e ativas direto na TV.</p>
                <div className="tnum" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>A verificar automaticamente…</div>
              </div>
            </>}
            {pay.status === 'COMPLETED' && <>
              <span className="section-label">[Ativa]</span>
              <p style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 20 }}>Subscrição ativa. Boa sessão.</p>
              <Link href="/tv" className="btn btn-primary">Abrir Kutsakai TV</Link>
            </>}
            {['FAILED', 'CANCELLED', 'EXPIRED'].includes(pay.status) && <>
              <span className="section-label">[Falhou]</span>
              <p>O pagamento não foi concluído ({pay.status}). Fala connosco no WhatsApp ou tenta de novo.</p>
              <button onClick={() => { setPay(null); setReceipt(null); setReceiptState('idle'); setStep(0); }} className="btn btn-secondary">Recomeçar</button>
            </>}
          </div>
        )}
      </main>
    </>
  );
}
