// Uso: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/turso-admin-reset.mjs <email> <nova-password>
import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
const [email, pw] = process.argv.slice(2);
if (!email || !pw || String(pw).length < 8) { console.error('Uso: ... <email> <nova-password-min-8>'); process.exit(1); }
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const hash = await bcrypt.hash(String(pw), 10);
const r = await db.execute({ sql: `UPDATE users SET password_hash=?, is_admin=1 WHERE email=?`, args: [hash, email] });
console.log('rowsAffected:', r.rowsAffected);
console.log((await db.execute({ sql: `SELECT id,name,email,is_admin FROM users WHERE email=?`, args: [email] })).rows[0]);
