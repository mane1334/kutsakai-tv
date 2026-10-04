"use client";
import { useRouter } from 'next/navigation';
import { logout } from '../lib/api';

export default function LogoutButton({ small = false }: { small?: boolean }) {
  const router = useRouter();
  return (
    <button
      onClick={() => logout((h) => router.push(h))}
      className={small ? 'btn btn-secondary btn-sm' : 'btn btn-secondary'}
      title="Terminar sessão"
    >
      Sair
    </button>
  );
}
