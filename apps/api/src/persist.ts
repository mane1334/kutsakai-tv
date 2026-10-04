// apps/api/src/persist.ts — persistência da SQLite em storage S3-compatível
// (Cloudflare R2, Backblaze B2, MinIO...). O Render Free apaga /tmp a cada
// restart/redeploy; aqui a DB é restaurada no arranque e copiada de forma
// periódica (VACUUM INTO = snapshot consistente) e no SIGTERM.
// Sem as variáveis S3_* o módulo fica desligado e nada muda.
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data.db');

const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
const PREFIX = (process.env.S3_PREFIX || 'kutsakai-tv').replace(/^\/+|\/+$/g, '');
const KEY_LATEST = `${PREFIX}/data.db.gz`;
export const persistEnabled = !!(S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY);

const s3 = persistEnabled
  ? new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: S3_ENDPOINT || undefined,
      forcePathStyle: true,
      credentials: { accessKeyId: S3_ACCESS_KEY_ID!, secretAccessKey: S3_SECRET_ACCESS_KEY! },
    })
  : null;

// Se o restore falhar por motivo que NÃO seja "ainda não há backup", não podemos
// deixar uma DB vazia sobrescrever o último snapshot bom.
let backupAllowed = persistEnabled;

function isNotFound(e: any): boolean {
  return e?.name === 'NoSuchKey' || e?.Code === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/** Chamar antes de abrir a DB. Só restaura se o ficheiro local não existir. */
export async function restoreSnapshot(): Promise<void> {
  if (!persistEnabled || !s3) {
    if (process.env.NODE_ENV === 'production')
      console.warn('[persist] S3_* não definido — DB efémera (perde-se em cada restart no Render Free).');
    return;
  }
  if (fs.existsSync(dbPath)) { console.log('[persist] DB local já existe, sem restore'); return; }
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET!, Key: KEY_LATEST }));
    const raw = Buffer.from(await out.Body!.transformToByteArray());
    const db = gunzipSync(raw);
    if (db.subarray(0, 15).toString('latin1') !== 'SQLite format 3') throw new Error('snapshot inválido');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, db);
    console.log(`[persist] DB restaurada do storage (${db.length} bytes)`);
  } catch (e: any) {
    if (isNotFound(e)) { console.log('[persist] ainda não há backup — DB nova'); return; }
    backupAllowed = false;
    console.error('[persist] ERRO no restore; backups desligados nesta execução para não sobrescrever o snapshot:', e?.message);
  }
}

let lastHash = '';
let lastDay = '';
let busy = false;

async function backupNow(db: DatabaseSync, reason: string): Promise<void> {
  if (!s3 || !backupAllowed || busy) return;
  busy = true;
  const tmp = path.join(os.tmpdir(), `snap-${process.pid}-${Date.now()}.db`);
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const buf = fs.readFileSync(tmp);
    const hash = createHash('sha256').update(buf).digest('hex');
    if (hash === lastHash) return;
    const body = gzipSync(buf);
    await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET!, Key: KEY_LATEST, Body: body, ContentType: 'application/gzip' }));
    const day = new Date().toISOString().slice(0, 10);
    if (day !== lastDay) {
      await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET!, Key: `${PREFIX}/daily/${day}.db.gz`, Body: body, ContentType: 'application/gzip' }));
      lastDay = day;
    }
    lastHash = hash;
    console.log(`[persist] backup ok (${reason}, ${body.length} bytes gz)`);
  } catch (e: any) {
    console.error('[persist] backup falhou:', e?.message);
  } finally {
    fs.rmSync(tmp, { force: true });
    busy = false;
  }
}

export function startBackups(db: DatabaseSync): void {
  if (!persistEnabled) return;
  const everyMs = Math.max(15, Number(process.env.BACKUP_INTERVAL_SEC || 60)) * 1000;
  setTimeout(() => backupNow(db, 'inicial'), 20_000).unref();
  setInterval(() => backupNow(db, 'periódico'), everyMs).unref();
  const shutdown = async (sig: string) => {
    console.log(`[persist] ${sig} — backup final`);
    await backupNow(db, 'shutdown');
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}
