"use client";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { logout } from '../../lib/api';

export default function AdminNav({ active }: { active?: string }) {
  const router = useRouter();
  const link = (href: string, label: string) => (
    <Link
      key={href}
      href={href}
      className="nav-hide-m"
      style={{
        fontSize: 13,
        color: active === href ? 'var(--accent)' : undefined,
        fontWeight: active === href ? 700 : undefined,
      }}
    >
      {label}
    </Link>
  );
  return (
    <nav className="nav scrolled">
      <div className="dl-wrap" style={{ display: 'flex', alignItems: 'center', gap: 24, paddingTop: 16, paddingBottom: 16 }}>
        <Link href="/admin" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, color: 'var(--text-primary)', textDecoration: 'none' }}><img src="/assets/icon.jpg" alt="Kutsakai TV" style={{ width: 24, height: 24, borderRadius: 6 }} />Kutsakai<span style={{ color: 'var(--accent)' }}> TV</span></Link>
        <span className="section-label" style={{ margin: 0 }}>[Admin]</span>
        {link('/admin/payments', 'Pagamentos')}
        {link('/admin/users', 'Clientes')}
        {link('/admin/channels', 'Canais')}
        {link('/admin/plans', 'Pacotes')}
        {link('/admin/system', 'Sistema')}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => logout((h) => router.push(h))} className="btn btn-secondary btn-sm">Sair</button>
        </span>
      </div>
    </nav>
  );
}
