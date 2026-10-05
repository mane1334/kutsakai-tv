"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShaderAnimation } from '../../components/ui/shader-animation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/v1';

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('MZ');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'register') {
      setMode('register');
    }
  }, []);

  const afterAuth = async (accessToken: string, isRegister: boolean) => {
    localStorage.setItem('access', accessToken);
    if (isRegister) { router.push('/onboarding'); return; }
    try {
      const p = await fetch(`${API}/me/preferences`, { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => r.json());
      const empty = (!p.categories || p.categories.length === 0) && (!p.countries || p.countries.length === 0);
      router.push(empty ? '/onboarding' : '/catalog');
    } catch { router.push('/catalog'); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`${API}/auth/${mode}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'register' ? { name, email, password, country } : { email, password }),
      });
      const d = await res.json();
      // achado 3: e-mail já registado devolve 200 genérico sem token
      if (res.ok && d.alreadyExists) { setMode('login'); setError('essa conta já existe — faz login'); return; }
      if (!res.ok || !d.accessToken) { setError(d.message || 'falhou — verifica os dados'); return; }
      await afterAuth(d.accessToken, mode === 'register');
    } catch { setError('API indisponível — verifica a ligação e tenta de novo'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {reduced
        ? <img src="/assets/login-bg.jpg" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        : <ShaderAnimation tint={[1.0, 0.7, 0.25]} speed={0.5} brightness={0.6} lineWidth={0.0015} style={{ position: 'absolute', inset: 0, height: '100%' }} />}
      <div className="hero-orb" />

      <div className="card featured" style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 420, padding: 36 }}>
        <Link href="/" style={{ fontSize: 13, color: 'var(--text-tertiary)', textDecoration: 'none' }}>← voltar</Link>
        <span className="section-label" style={{ marginTop: 16 }}>[{mode === 'login' ? 'Entrar' : 'Criar conta'}]</span>
        <h1 style={{ color: 'var(--text-primary)', fontSize: 32, margin: '0 0 4px', letterSpacing: 'var(--tracking-tight)' }}>
          {mode === 'login' ? 'Boa noite.' : 'Bem-vindo.'}
        </h1>
        <p style={{ fontSize: 14, marginTop: 0 }}>
          {mode === 'login' ? 'Os teus canais continuam onde os deixaste.' : '5000+ canais. A seguir escolhes línguas e géneros.'}
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 20 }}>
          {mode === 'register' && (
            <>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="nome" required className="dl-input" />
              <input value={country} onChange={e => setCountry(e.target.value)} placeholder="país (MZ, PT, BR…)" className="dl-input" />
            </>
          )}
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="email" required className="dl-input" />
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder={mode === 'register' ? 'password (mín. 8 caracteres)' : 'password'} required minLength={8} className="dl-input" />
          {error && <span style={{ fontSize: 13, color: '#e06c6c' }}>{error}</span>}
          <button type="submit" disabled={busy} className="btn btn-primary" style={{ justifyContent: 'center' }}>
            {busy ? '…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>

        <div style={{ marginTop: 20, fontSize: 13, textAlign: 'center' }}>
          {mode === 'login' ? (
            <>Sem conta? <button onClick={() => setMode('register')} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13 }}>Criar conta</button></>
          ) : (
            <>Já tens conta? <button onClick={() => setMode('login')} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13 }}>Entrar</button></>
          )}
        </div>
      </div>
    </div>
  );
}
