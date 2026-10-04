// scripts/export-apk.mjs — build estático para o APK sem tocar no config de dev.
// Uso: node scripts/export-apk.mjs  (a partir de apps/web)
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const live = 'next.config.mjs';
const statik = 'next.config.static.mjs';
const backup = 'next.config.mjs.bak';

if (!fs.existsSync(statik)) throw new Error('falta next.config.static.mjs');
fs.copyFileSync(live, backup);
fs.copyFileSync(statik, live);
try {
  execSync('npx next build', { stdio: 'inherit' });
} finally {
  fs.copyFileSync(backup, live);
  fs.unlinkSync(backup);
}
console.log('OK: out/ pronto para `npx cap sync`');
