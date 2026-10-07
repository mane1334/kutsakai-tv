// Uso: tsx apps/api/src/admin-reset.ts <email> <nova-password>
// Funciona local e no Render Shell (usa as env TURSO_* / SQLITE_PATH do ambiente).
// Define a password, promove a admin e mostra o resultado.
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const [email, pass] = process.argv.slice(2);
if (!email) {
  const rows = db.prepare('SELECT email,is_admin,created_at FROM users WHERE is_admin=1 ORDER BY created_at DESC').all();
  console.log(JSON.stringify(rows, null, 1));
  process.exit(0);
}
if (!email || !pass || pass.length < 8) {
  console.error('Uso: tsx apps/api/src/admin-reset.ts <email> <nova-password-min-8>');
  process.exit(1);
}
const u: any = db.prepare('SELECT id,email,is_admin FROM users WHERE email=?').get(email.trim().toLowerCase());
if (!u) {
  console.error(`Utilizador não encontrado: ${email}`);
  process.exit(1);
}
const hash = await bcrypt.hash(pass, 10);
db.prepare('UPDATE users SET password_hash=?, is_admin=1 WHERE id=?').run(hash, u.id);
console.log(`OK: ${u.email} com nova password e is_admin=1`);
process.exit(0);
