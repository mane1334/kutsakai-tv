export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/v1';

export const getToken = () =>
  typeof window === 'undefined' ? '' : localStorage.getItem('access') || '';

export const setToken = (t: string) => {
  if (typeof window === 'undefined') return;
  if (t) localStorage.setItem('access', t);
  else localStorage.removeItem('access');
};

export async function tryRefresh(): Promise<string | null> {
  try {
    const r = await fetch(`${API}/auth/refresh`, { method: 'POST', credentials: 'include' }).then((x) => x.json());
    if (r?.accessToken) {
      setToken(r.accessToken);
      window.dispatchEvent(new CustomEvent('kutsakai:token', { detail: r.accessToken }));
      return r.accessToken as string;
    }
  } catch { /* sem refresh */ }
  return null;
}

/** true se o JWT já expirou (ou expira dentro de skewSec). */
export function tokenExpiring(t: string, skewSec = 60): boolean {
  try {
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return !p.exp || p.exp * 1000 < Date.now() + skewSec * 1000;
  } catch { return true; }
}

/** fetch com Bearer + refresh automático 1x em 401. Devolve Response. */
export async function authFetch(url: string, opts: RequestInit = {}, retry = true): Promise<Response> {
  const t = getToken();
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
  });
  if (res.status !== 401 || !retry) return res;
  const nt = await tryRefresh();
  if (!nt) return res;
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${nt}` },
  });
}

/** fetch JSON que aceita anónimo e logado; faz refresh 1x se houver token. */
export async function apiGet(path: string, token?: string): Promise<any> {
  const t = token ?? getToken();
  let res = await fetch(`${API}${path}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (res.status === 401 && t) {
    const nt = await tryRefresh();
    if (nt) res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${nt}` } });
  }
  return res.json().catch(() => null);
}

export async function logout(push?: (href: string) => void) {
  try {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch { /* sai na mesma */ }
  setToken('');
  if (push) push('/login');
  else if (typeof window !== 'undefined') window.location.href = '/login';
}
