// scripts/channel-janitor.ts — testa canais a fundo e limpa os mortos.
// Usa a verificação profunda (playlist + 1º segmento com bytes) + sonda de
// codecs, e funciona contra a cloud Turso ou ficheiro local:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/channel-janitor.ts [opções]
//   SQLITE_PATH=apps/api/data.db npx tsx scripts/channel-janitor.ts [opções]
//
// Opções:
//   --limit N        nº de canais por passagem (os há mais tempo sem check primeiro)
//   --concurrency N  verificações em paralelo (defeito 8)
//   --purge-days N   apagar canais 'offline' há mais de N dias (defeito 21)
//   --purge          executa o purge (sem isto só lista o que seria apagado)
//
// O purge também limpa plan_channels/favorites órfãos do canal.
import { checkStream, probeCodecs } from '../packages/stream-monitor/index.js';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { DatabaseSync } from 'node:sqlite';

type Db = {
  q: (sql: string, a?: any[]) => Promise<any[]>;
  x: (sql: string, a?: any[]) => Promise<void>;
};

function getDb(): Db {
  const TURSO_URL = process.env.TURSO_DATABASE_URL || '';
  const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || '';
  if (TURSO_URL && TURSO_TOKEN) {
    const db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
    console.log('[janitor] cloud Turso');
    return {
      q: async (sql: string, a: any[] = []) => (await db.execute({ sql, args: a })).rows as any[],
      x: async (sql: string, a: any[] = []) => { await db.execute({ sql, args: a }); },
    };
  }
  const dbPath = process.env.SQLITE_PATH || 'apps/api/data.db';
  const db = new DatabaseSync(dbPath);
  console.log(`[janitor] local ${dbPath}`);
  return {
    q: async (sql: string, a: any[] = []) => db.prepare(sql).all(...a) as any[],
    x: async (sql: string, a: any[] = []) => { db.prepare(sql).run(...a); },
  };
}

async function main(): Promise<void> {
  const args: Record<string, string | boolean> = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)(=(.*))?$/.exec(a);
    if (m) args[m[1]] = m[3] === undefined ? true : m[3];
  }
  const LIMIT = Math.max(1, parseInt(String(args.limit || '200')));
  const CONC = Math.max(1, Math.min(20, parseInt(String(args.concurrency || '8'))));
  const PURGE_DAYS = Math.max(1, parseInt(String(args['purge-days'] || '21')));
  const DO_PURGE = args.purge === true || args.purge === '1';

  const { q, x } = getDb();

  const rows = await q(
    `SELECT id,name,stream_url,status FROM channels WHERE status != 'offline' ORDER BY last_checked ASC LIMIT ?`,
    [LIMIT],
  );
  console.log(`[janitor] a verificar ${rows.length} canais (conc=${CONC})…`);

  let online = 0, degraded = 0, offline = 0;
  async function checkOne(c: any): Promise<void> {
    const r = await checkStream(c.stream_url, 12000);
    const status = r.status;
    try {
      await x(
        `INSERT INTO stream_checks (id,channel_id,status,latency_ms,error) VALUES (?,?,?,?,?)`,
        [randomUUID(), c.id, status, r.latencyMs ?? null, (r.error || '').slice(0, 200) || null],
      );
    } catch { /* tabela pode não existir em DBs antigas */ }
    let rel = status === 'online' ? 100 : 0;
    try {
      const w: any = (await q(
        `SELECT COUNT(*) t, SUM(CASE WHEN status='online' THEN 1 ELSE 0 END) o FROM stream_checks WHERE channel_id=? AND checked_at > datetime('now','-7 days')`,
        [c.id],
      ))[0];
      if (w && Number((w as any).t) > 0) rel = (100 * Number((w as any).o || 0)) / Number((w as any).t);
    } catch { /* noop */ }
    let codec: string | null = null;
    if (status !== 'offline') {
      try { codec = (await probeCodecs(c.stream_url, 10000)).videoCodec; } catch { /* noop */ }
    }
    if (codec) await x(`UPDATE channels SET status=?, reliability_score=?, last_checked=datetime('now'), codec=? WHERE id=?`, [status, rel, codec, c.id]);
    else await x(`UPDATE channels SET status=?, reliability_score=?, last_checked=datetime('now') WHERE id=?`, [status, rel, c.id]);
    if (status === 'online') online++;
    else if (status === 'degraded') degraded++;
    else { offline++; console.log(`[offline] ${c.name} (${r.error || 'sem sinal'})`); }
  }

  const queue = [...rows];
  const workers = Array.from({ length: Math.min(CONC, queue.length) }, async () => {
    while (queue.length) {
      const c = queue.shift();
      if (!c) break;
      try { await checkOne(c); }
      catch (e: any) { console.log(`[erro] ${c.name}: ${String(e?.message || e).slice(0, 120)}`); }
    }
  });
  await Promise.all(workers);
  console.log(`[janitor] online=${online} degraded=${degraded} offline=${offline}`);

  try {
    await x(`DELETE FROM stream_checks WHERE checked_at < datetime('now','-30 days')`);
    console.log('[janitor] stream_checks >30d limpos');
  } catch { /* noop */ }

  const dead = await q(
    `SELECT id,name FROM channels WHERE status='offline' AND last_checked < datetime('now', '-' || ? || ' days')`,
    [PURGE_DAYS],
  ).catch(() => [] as any[]);
  if (!dead.length) {
    console.log('[janitor] nada para purge');
  } else if (!DO_PURGE) {
    console.log(`[janitor] DRY-RUN: ${dead.length} canais seriam apagados (offline há +${PURGE_DAYS}d). Corre com --purge para executar:`);
    for (const d of dead.slice(0, 20)) console.log(`  - ${d.name}`);
    if (dead.length > 20) console.log(`  … e mais ${dead.length - 20}`);
  } else {
    for (const d of dead) {
      await x(`DELETE FROM plan_channels WHERE channel_id=?`, [d.id]);
      await x(`DELETE FROM favorites WHERE channel_id=?`, [d.id]);
      await x(`DELETE FROM stream_checks WHERE channel_id=?`, [d.id]).catch(() => {});
      await x(`DELETE FROM channels WHERE id=?`, [d.id]);
    }
    console.log(`[janitor] purge: ${dead.length} canais apagados`);
  }
  console.log('[janitor] DONE');
}

main().catch((e) => { console.error('janitor falhou:', e?.message || e); process.exit(1); });
