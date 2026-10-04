// Persistência da SQLite no Cloudflare R2 (free: 10GB, sem custo de saída).
// O disco do Render Free é efémero: a cada restart/redeploy a data.db some.
// Solução sem reescrever queries: snapshot do ficheiro .db para o R2
// (restore no arranque se o disco estiver vazio + upload periódico + no SIGTERM).
// Sem env R2_* configurado, tudo é no-op (dev local não muda).
import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';

const ACCOUNT = process.env.R2_ACCOUNT_ID || '';
const KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const SECRET = process.env.R2_SECRET_ACCESS_KEY || '';
const BUCKET = process.env.R2_BUCKET || 'kutsakai-tv';
const DB_KEY = process.env.R2_DB_KEY || 'db/data.db';

export const r2Configured = () => !!(ACCOUNT && KEY_ID && SECRET && BUCKET);

const sha256hex = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();

function amzDate(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// Assinatura SigV4 mínima para PUT/GET (sem SDK — evita dependência pesada).
async function r2Request(method: 'GET' | 'PUT', key: string, body?: Buffer): Promise<{ status: number; buf: Buffer }> {
  const host = `${ACCOUNT}.r2.cloudflarestorage.com`;
  const path = `/${BUCKET}/${key}`;
  const now = amzDate();
  const date = now.slice(0, 8);
  const payloadHash = sha256hex(body || '');
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': now,
  };
  if (method === 'PUT') {
    headers['content-type'] = 'application/octet-stream';
    headers['content-length'] = String(body?.length || 0);
  }
  const signed = Object.keys(headers).sort();
  const canonical = [
    method, path, '',
    ...signed.map((k) => `${k}:${String(headers[k]).trim()}\n`),
    signed.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', now, scope, sha256hex(canonical)].join('\n');
  const kDate = hmac('AWS4' + SECRET, date);
  const kRegion = hmac(kDate, 'auto');
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const sig = createHmac('sha256', kSigning).update(toSign).digest('hex');
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${KEY_ID}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${sig}`;

  const res = await fetch(`https://${host}${path}`, { method, headers: headers as any, body: body as any });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf };
}

export async function r2DownloadDb(): Promise<Buffer | null> {
  if (!r2Configured()) return null;
  try {
    const r = await r2Request('GET', DB_KEY);
    if (r.status === 200 && r.buf.length > 1024) return r.buf;
    if (r.status !== 404) console.log(`[r2] download respondeu ${r.status}`);
    return null;
  } catch (e: any) {
    console.log('[r2] download falhou:', e?.message);
    return null;
  }
}

export async function r2UploadDb(dbPath: string): Promise<boolean> {
  if (!r2Configured()) return false;
  try {
    if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size < 1024) return false;
    const body = fs.readFileSync(dbPath);
    const r = await r2Request('PUT', DB_KEY, body);
    if (r.status === 200) {
      console.log(`[r2] snapshot ${(body.length / 1048576).toFixed(1)}MB guardado`);
      return true;
    }
    console.log(`[r2] upload respondeu ${r.status}:`, r.buf.toString().slice(0, 200));
    return false;
  } catch (e: any) {
    console.log('[r2] upload falhou:', e?.message);
    return false;
  }
}

// arranca backups: 1 upload imediato + periódico + no SIGTERM/SIGINT.
// Faz checkpoint do WAL antes de cada upload para o ficheiro conter tudo.
export function startR2Backups(dbPath: string, checkpoint: () => void) {
  if (!r2Configured()) {
    console.log('[r2] sem credenciais — snapshots desativados (define R2_* no Render)');
    return;
  }
  const mins = Math.max(5, Number(process.env.BACKUP_INTERVAL_MIN || 15));
  const once = () => {
    try { checkpoint(); } catch { /* noop */ }
    r2UploadDb(dbPath);
  };
  console.log(`[r2] snapshots a cada ${mins}min + no shutdown`);
  setTimeout(once, 30_000); // 1º upload 30s após arrancar (valida credenciais cedo)
  const iv = setInterval(once, mins * 60_000);
  (iv as any).unref?.();
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      console.log(`[r2] ${sig}: snapshot final…`);
      try { checkpoint(); } catch { /* noop */ }
      r2UploadDb(dbPath).finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 8000); // não prender o shutdown
    });
  }
}
