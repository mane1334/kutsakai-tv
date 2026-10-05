// scripts/turso-set-codec.mjs — marca o codec de vídeo de 1 canal na cloud.
// Uso: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/turso-set-codec.mjs <channelId> <codec>
import { createClient } from '@libsql/client';
const [id, codec] = process.argv.slice(2);
if (!id || !codec) { console.error('Uso: node scripts/turso-set-codec.mjs <channelId> <codec>'); process.exit(1); }
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
await db.execute({ sql: 'UPDATE channels SET codec=? WHERE id=?', args: [codec, id] });
console.log((await db.execute({ sql: 'SELECT id,name,codec FROM channels WHERE id=?', args: [id] })).rows[0]);
