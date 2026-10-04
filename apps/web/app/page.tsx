"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShaderAnimation } from '../components/ui/shader-animation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/v1';

export default function Home() {
  const [stats, setStats] = useState<any>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    const onScroll = () => document.querySelector('.nav')?.classList.toggle('scrolled', window.scrollY > 24);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    fetch(`${API}/channels?limit=1`).then(r => r.json()).then(d => setStats(d.total)).catch(() => {});
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver((entries) => entries.forEach((x) => {
      if (!x.isIntersecting) return;
      setTimeout(() => (x.target as HTMLElement).classList.add('visible'), Number((x.target as HTMLElement).dataset.delay || 0));
      obs.unobserve(x.target);
    }), { threshold: 0.08 });
    const els = Array.from(document.querySelectorAll('.reveal'));
    els.forEach((el) => {
      const sibs = Array.from(el.parentElement?.querySelectorAll('.reveal') || []);
      if (!(el as HTMLElement).dataset.delay) (el as HTMLElement).dataset.delay = String(sibs.indexOf(el) * 90);
      obs.observe(el);
    });
    return () => obs.disconnect();
  });

  return (
    <>
      <nav className="nav">
        <div className="dl-wrap" style={{ display: 'flex', alignItems: 'center', gap: 24, paddingTop: 16, paddingBottom: 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)' }}><img src="/assets/icon.jpg" alt="Kutsakai TV" style={{ width: 26, height: 26, borderRadius: 7 }} />Kutsakai<span style={{ color: 'var(--accent)' }}> TV</span></span>
          <Link href="/catalog" className="nav-hide-m">Catálogo</Link>
          <Link href="/tv" className="nav-hide-m">Modo TV</Link>
          <Link href="/plans" className="nav-hide-m">Planos</Link>
          <Link href="/admin" className="nav-hide-m">Admin</Link>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/login" className="btn btn-secondary btn-sm">Entrar</Link>
            <Link href="/login?mode=register" className="btn btn-primary btn-sm nav-hide-m">Criar conta</Link>
          </span>
        </div>
      </nav>

      <header style={{ position: 'relative', height: '100vh', minHeight: 600, overflow: 'hidden', background: '#000' }}>
        {reduced
          ? <img src="/assets/hero-bg.jpg" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          : <ShaderAnimation tint={[1.0, 0.7, 0.25]} speed={1} brightness={1} style={{ position: 'absolute', inset: 0, height: '100%' }} />}
        <div className="hero-orb" />
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: '0 32px', textAlign: 'center', pointerEvents: 'none', background: 'radial-gradient(ellipse at center, rgba(5,4,3,0.78) 0%, rgba(5,4,3,0.45) 45%, transparent 72%)' }}>
          <span className="hero-badge">{stats ? `${stats}+ canais públicos` : '5000+ canais públicos'} // recomendações pessoais</span>
          <h1 className="display-headline">
            <span className="hl-muted">Bem-vindo à televisão</span><br />
            <span className="hl-bright">que se descobre sozinha.</span>
          </h1>
          <p style={{ maxWidth: 560, color: 'rgba(240,235,224,0.8)', fontSize: 18 }}>Notícias, desporto, filmes e música de Moçambique ao mundo — escolhe as tuas línguas e géneros e nós tratamos do resto.</p>
          <div style={{ display: 'flex', gap: 12, pointerEvents: 'auto', flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link href="/login" className="btn btn-secondary">Entrar</Link>
            <Link href="/login?mode=register" className="btn btn-primary">Criar conta grátis</Link>
          </div>
          <div className="arch-meta">SEM CARTÃO // EPG INCLUÍDO // MONITOR DE QUALIDADE</div>
        </div>
      </header>

      <main className="dl-wrap" style={{ paddingTop: 64, paddingBottom: 32 }}>
        <section className="reveal">
          <span className="section-label">[Como funciona]</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>
            {[
              ['01 // CONTA', 'Cria a conta em 30 segundos.', 'Email e password. Sem cartão, sem complicação.'],
              ['02 // GOSTOS', 'Escolhe línguas e géneros.', 'Português, inglês, francês, espanhol — notícias, desporto, filmes, música e mais.'],
              ['03 // DESCOBERTA', 'Recebe recomendações.', 'O motor aprende com o que vês e sugere canais com explicação do porquê.'],
            ].map(([meta, title, desc]) => (
              <div key={meta} className="card reveal" style={{ padding: 24 }}>
                <div className="arch-meta">{meta}</div>
                <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>{title}</div>
                <div style={{ fontSize: 14 }}>{desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card featured reveal" style={{ marginTop: 48, textAlign: 'center', overflow: 'hidden', padding: 0 }}>
          <img src="/assets/og-banner.jpg" alt="Modo TV" loading="lazy" style={{ width: '100%', height: 240, objectFit: 'cover', display: 'block', borderBottom: '1px solid var(--border-subtle)' }} />
          <div style={{ padding: '32px 40px 40px' }}>
          <span className="section-label">[Modo TV]</span>
          <h2 style={{ color: 'var(--text-primary)', fontSize: 'var(--text-h2)', margin: '0 0 8px', letterSpacing: 'var(--tracking-tight)' }}>Uma televisão dentro do browser.</h2>
          <p>Lista vertical de canais ao lado de um ecrã em moldura de TV, com zapping por setas, EPG e favoritos.</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            <Link href="/login?mode=register" className="btn btn-primary">Criar conta grátis</Link>
            <Link href="/tv" className="btn btn-secondary">Ver modo TV</Link>
          </div>
          </div>
        </section>
      </main>

      <div className="footer-wrapper">
        <div className="footer-panel">
          <div className="dl-wrap" style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap', padding: 0 }}>
            <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Kutsakai TV</span>
            <span className="status-ok">● [ALL SYSTEMS OPERATIONAL]</span>
            <span style={{ marginLeft: 'auto', fontSize: 13 }}>Catálogo comunitário · verifica licenças antes de monetizar</span>
          </div>
        </div>
      </div>
    </>
  );
}
