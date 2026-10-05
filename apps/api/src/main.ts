import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { db, isTurso, syncNow } from './db.js';
import { scoreChannel, EVENT_WEIGHTS } from '../../../packages/recommendation-engine/index.js';
import { providers, seedPlans, getPlan, getPaymentMethods, hasActiveSubscription, authorizeChannel, completePayment, refreshPaymentStatus } from './payments.js';
import { checkStream, probeCodecs } from '../../../packages/stream-monitor/index.js';
import { autoSeedIfEmpty } from './autoseed.js';
import { startR2Backups, r2UploadDb, r2Configured } from './persist-r2.js';

import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'node:path';
import { Readable } from 'node:stream';
dotenv.config({ path: path.join(process.cwd(), '.env') });

const app = express();
app.disable('x-powered-by'); // achado 7: não anunciar stack no cabeçalho
app.set('trust proxy', 1);
// Diagnóstico de quedas: logar em vez de morrer em silêncio. uncaughtException
// reinicia limpo (o Render levanta em ~15s); sem isto, o processo podia ficar
// meio-morto com a porta aberta até ao healthcheck falhar.
process.on('unhandledRejection', (e: any) => console.error('[fatal] unhandledRejection:', e?.message || e));
process.on('uncaughtException', (e: any) => {
  console.error('[fatal] uncaughtException:', e?.message || e);
  setTimeout(() => process.exit(1), 500);
});
// achado 5: cabeçalhos de segurança na API (JSON — sem risco de quebrar UI)
app.use((_req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  next();
});
app.use(cookieParser());
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean);
// sufixos extra (ex. previews do Pages: 29ec2579.kutsakai-tv.pages.dev) — só os nossos
const allowedSuffixes = (process.env.ALLOWED_ORIGIN_SUFFIXES || '.kutsakai-tv.pages.dev').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => {
    if (!origin) return cb(null, true); // curl / server-side / same-origin sem Origin
    if (allowedOrigins.includes(origin)) return cb(null, true);
    if (allowedSuffixes.some((s) => origin.endsWith(s))) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
// JSON malformado -> 400 JSON (o handler defeito do body-parser cospe HTML
// com stack trace e paths do servidor)
app.use((err: any, _req: any, res: any, next: any) => {
  if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
    return res.status(400).json({ statusCode: 400, message: 'invalid json' });
  }
  next(err);
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-change-me';

// --- achado 2: rate limiting em memória (1 instância no Render Free) ---
// Janela deslizante: key -> timestamps. Ultrapassou -> 429 + Retry-After.
const _rl = new Map<string, number[]>();
function rateLimit(max: number, windowMs: number, keyFn: (req: any) => string) {
  return (req: any, res: any, next: any) => {
    const key = keyFn(req);
    const now = Date.now();
    const hits = (_rl.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ statusCode: 429, message: 'too many attempts, try later' });
    }
    hits.push(now);
    _rl.set(key, hits);
    if (_rl.size > 5000) for (const [k, v] of _rl) { if (!v.length || now - v[v.length - 1] > 3600000) _rl.delete(k); }
    next();
  };
}
const ipOf = (req: any) => String(req.ip || req.socket?.remoteAddress || 'unknown');
const loginLimit = rateLimit(10, 15 * 60 * 1000, (req) =>
  `login:${ipOf(req)}:${String(req.body?.email || '').trim().toLowerCase()}`);
const registerLimit = rateLimit(20, 60 * 60 * 1000, (req) => `register:${ipOf(req)}`);
const refreshLimit = rateLimit(60, 15 * 60 * 1000, (req) => `refresh:${ipOf(req)}`);

// --- achado 1: política de senha (register + troca) ---
const COMMON_PASSWORDS = new Set(['123456', '12345678', '123456789', 'password', 'password1', 'qwerty', 'abc123', '111111', '123123', 'admin123', 'kutsakai', 'mocambique', 'moçambique', 'televisao', '1234567890', '00000000', '987654321']);
function passwordError(pw: unknown): string | null {
  const s = String(pw || '');
  if (s.length < 8) return 'password too short (min 8 characters)';
  if (COMMON_PASSWORDS.has(s.toLowerCase())) return 'password too common, choose another';
  return null;
}

// --- achado 6: refresh/logout usam cookie -> exigir Origin legítima quando
// o browser a envia (fetch cross-site manda sempre Origin; nativo/curl sem
// Origin continua a passar para não partir a app Android/Capacitor) ---
function enforceOrigin(req: any, res: any, next: any) {
  const origin = String(req.headers.origin || '');
  if (!origin) return next();
  if (allowedOrigins.includes(origin)) return next();
  if (allowedSuffixes.some((suf) => origin.endsWith(suf))) return next();
  return res.status(403).json({ statusCode: 403, message: 'bad origin' });
}

function signAccess(userId: string) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '15m' });
}
function signRefresh(userId: string) {
  return jwt.sign({ sub: userId }, REFRESH_SECRET, { expiresIn: '30d' });
}
function auth(req: any, res: any, next: any) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ statusCode: 401, message: 'unauthorized' });
  try {
    (req as any).userId = (jwt.verify(h.slice(7), JWT_SECRET) as any).sub;
    next();
  } catch { return res.status(401).json({ statusCode: 401, message: 'token expired' }); }
}
const j = (s: string) => { try { return JSON.parse(s); } catch { return []; } };
const isSecureStream = (url: unknown) => typeof url === 'string' && url.trim().toLowerCase().startsWith('https://');
const isHttpStream = (url: unknown) => typeof url === 'string' && /^https?:\/\//i.test(url.trim());

// Token curto, preso a UM canal: o hls.js e o <video> não enviam o header
// Authorization nos pedidos de playlist/segmentos, por isso o relay PREMIUM
// aceita este token na query (?st=) em vez do Bearer.
const signStreamToken = (channelId: string) => jwt.sign({ k: 'stream', cid: channelId }, JWT_SECRET, { expiresIn: '6h' });
function validStreamToken(t: unknown, channelId: string): boolean {
  try { const p: any = jwt.verify(String(t || ''), JWT_SECRET); return p.k === 'stream' && p.cid === channelId; }
  catch { return false; }
}
function viewerId(req: any): string | null {
  if (req._vid !== undefined) return req._vid;
  let id: string | null = null;
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) { try { id = (jwt.verify(h.slice(7), JWT_SECRET) as any).sub; } catch { /* expirado = anónimo */ } }
  req._vid = id;
  return id;
}

function relayUrl(req: any, channelId: string, sourceUrl: string, st?: string): string {
  const base = `${req.protocol}://${req.get('host')}`;
  return `${base}/v1/channels/${encodeURIComponent(channelId)}/stream?url=${encodeURIComponent(sourceUrl)}${st ? `&st=${encodeURIComponent(st)}` : ''}`;
}

function publicChannel(req: any, c: any) {
  const stream = String(c.stream_url || '').trim();
  let st: string | undefined;
  if ((c.access_level || 'FREE').toUpperCase() === 'PREMIUM') {
    const uid = viewerId(req);
    const adm = uid ? (db.prepare('SELECT is_admin FROM users WHERE id=?').get(uid) as any)?.is_admin : 0;
    if (uid && (adm || authorizeChannel(uid, c).authorized)) st = signStreamToken(c.id);
  }
  return {
    ...c,
    stream_url: isHttpStream(stream) && !isSecureStream(stream) ? relayUrl(req, c.id, stream, st) : stream,
    languages: j(c.languages),
    categories: j(c.categories),
  };
}

// bootstrap do 1º admin sem Shell: define ADMIN_EMAIL no Render;
// a conta registada (ou login) com esse email fica is_admin=1 sozinha.
function maybePromoteAdmin(userId: string, email: string) {
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!adminEmail || email.trim().toLowerCase() !== adminEmail) return;
  try {
    db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(userId);
    console.log(`[admin] promovido: ${email}`);
  } catch (e: any) { console.log('[admin] promote falhou', e?.message); }
}

function setRefreshCookie(res: any, token: string) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('refresh_token', token, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd ? true : false,
    maxAge: 30 * 24 * 3600 * 1000,
    path: '/',
  });
}

// health para Render/UptimeRobot (sem auth, sem DB pesada)
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/v1/health', (_req, res) => res.json({ ok: true }));

// --- auth ---
app.post('/v1/auth/register', registerLimit, async (req, res) => {
  const { name, email, password, country, language } = req.body;
  if (!name || !email || !password) return res.status(400).json({ statusCode: 400, message: 'name,email,password required' });
  const weak = passwordError(password);
  if (weak) return res.status(400).json({ statusCode: 400, message: weak });
  const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  // achado 3: sem oráculo por status code — duplicado devolve 200 genérico
  // sem token (o cliente mostra "já tens conta, faz login"). Combinado com o
  // rate limit acima, a enumeração em massa deixa de ser viável.
  if (exists) return res.json({ ok: true, alreadyExists: true, message: 'email already registered — sign in instead' });
  const id = randomUUID();
  const hash = await bcrypt.hash(password, 10);
  db.prepare('INSERT INTO users (id,name,email,password_hash,country,language) VALUES (?,?,?,?,?,?)')
    .run(id, name, email, hash, country || null, language || 'pt');
  db.prepare('INSERT INTO user_preferences (user_id) VALUES (?)').run(id);
  maybePromoteAdmin(id, email);
  const freePlan: any = db.prepare("SELECT id FROM plans WHERE code='free'").get();
  db.prepare('INSERT INTO subscriptions (id,user_id,plan,plan_id,status) VALUES (?,?,?,?,?)').run(randomUUID(), id, 'free', freePlan?.id || null, 'ACTIVE');
  const rt = signRefresh(id);
  db.prepare("INSERT INTO refresh_tokens (id,user_id,token,expires_at) VALUES (?,?,?,datetime('now','+30 days'))").run(randomUUID(), id, rt);
  setRefreshCookie(res, rt);
  res.json({ accessToken: signAccess(id), user: { id, name, email } });
});

app.post('/v1/auth/login', loginLimit, async (req, res) => {
  const { email, password } = req.body;
  const u: any = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !(await bcrypt.compare(password, (u as any).password_hash)))
    return res.status(401).json({ statusCode: 401, message: 'invalid credentials' });
  const rt = signRefresh(u.id);
  db.prepare("INSERT INTO refresh_tokens (id,user_id,token,expires_at) VALUES (?,?,?,datetime('now','+30 days'))").run(randomUUID(), u.id, rt);
  setRefreshCookie(res, rt);
  maybePromoteAdmin(u.id, u.email);
  res.json({ accessToken: signAccess(u.id), user: { id: u.id, name: u.name, email: u.email } });
});

app.post('/v1/auth/refresh', refreshLimit, enforceOrigin, (req, res) => {
  const token = req.cookies?.refresh_token || req.body?.refreshToken;
  if (!token) return res.status(401).json({ statusCode: 401, message: 'no refresh' });
  try {
    const { sub } = jwt.verify(token, REFRESH_SECRET) as any;
    const row: any = db.prepare('SELECT * FROM refresh_tokens WHERE token=?').get(token);
    if (!row) return res.status(401).json({ statusCode: 401, message: 'revoked' });
    // rotate
    db.prepare('DELETE FROM refresh_tokens WHERE token=?').run(token);
    const rt = signRefresh(sub);
    db.prepare("INSERT INTO refresh_tokens (id,user_id,token,expires_at) VALUES (?,?,?,datetime('now','+30 days'))").run(randomUUID(), sub, rt);
    setRefreshCookie(res, rt);
    res.json({ accessToken: signAccess(sub) });
  } catch { res.status(401).json({ statusCode: 401, message: 'invalid refresh' }); }
});

app.post('/v1/auth/logout', enforceOrigin, (req, res) => {
  const token = req.cookies?.refresh_token;
  if (token) db.prepare('DELETE FROM refresh_tokens WHERE token=?').run(token);
  res.clearCookie('refresh_token', { path: '/' });
  res.json({ ok: true });
});

// --- me ---
app.get('/v1/me', auth, (req: any, res) => {
  const u: any = db.prepare('SELECT id,name,email,country,language,created_at FROM users WHERE id=?').get(req.userId);
  res.json(u);
});
app.put('/v1/me', auth, async (req: any, res) => {
  const { name, country, language } = req.body || {};
  if (name !== undefined && String(name).trim().length < 2)
    return res.status(400).json({ statusCode: 400, message: 'name too short' });
  db.prepare('UPDATE users SET name=COALESCE(?,name), country=COALESCE(?,country), language=COALESCE(?,language) WHERE id=?')
    .run(
      name !== undefined ? String(name).trim() : null,
      country !== undefined ? (String(country).trim() || null) : null,
      language !== undefined ? (String(language).trim() || null) : null,
      req.userId,
    );
  const u: any = db.prepare('SELECT id,name,email,country,language,created_at FROM users WHERE id=?').get(req.userId);
  res.json(u);
});
app.post('/v1/me/password', auth, async (req: any, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const weak = passwordError(newPassword);
  if (weak) return res.status(400).json({ statusCode: 400, message: weak });
  const u: any = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
  if (!u || !(await bcrypt.compare(String(currentPassword || ''), u.password_hash)))
    return res.status(401).json({ statusCode: 401, message: 'current password invalid' });
  const hash = await bcrypt.hash(String(newPassword), 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.userId);
  res.json({ ok: true });
});

// opções reais para os filtros do catálogo (só valores que existem na BD)
app.get('/v1/meta/filters', (req, res) => {
  const countries: any[] = db.prepare(`SELECT country, COUNT(*) n FROM channels WHERE country IS NOT NULL AND country != '' GROUP BY country ORDER BY n DESC LIMIT 30`).all();
  const regions: any[] = db.prepare(`SELECT region, COUNT(*) n FROM channels WHERE region IS NOT NULL AND region != '' GROUP BY region ORDER BY n DESC`).all();
  const langs: any[] = db.prepare(`SELECT value lang, COUNT(*) n FROM channels, json_each(channels.languages) GROUP BY value ORDER BY n DESC LIMIT 20`).all();
  const cats: any[] = db.prepare(`SELECT value cat, COUNT(*) n FROM channels, json_each(channels.categories) GROUP BY value ORDER BY n DESC LIMIT 30`).all();
  res.json({ countries, regions, languages: langs, categories: cats });
});

app.get('/v1/me/preferences', auth, (req: any, res) => {
  const p: any = db.prepare('SELECT * FROM user_preferences WHERE user_id=?').get(req.userId);
  res.json({ ...p, languages: j(p.languages), countries: j(p.countries), regions: j(p.regions), categories: j(p.categories) });
});

app.put('/v1/me/preferences', auth, (req: any, res) => {
  const { languages, countries, regions, categories, qualityMode, dataSaver } = req.body;
  db.prepare(`UPDATE user_preferences SET languages=?,countries=?,regions=?,categories=?,quality_mode=?,data_saver=? WHERE user_id=?`)
    .run(JSON.stringify(languages || ['pt']), JSON.stringify(countries || []), JSON.stringify(regions || []),
      JSON.stringify(categories || []), qualityMode || 'auto', dataSaver ? 1 : 0, req.userId);
  res.json({ ok: true });
});

app.post('/v1/onboarding', auth, (req: any, res) => {
  const { languages, countries, regions, categories, qualityMode } = req.body;
  db.prepare(`UPDATE user_preferences SET languages=?,countries=?,regions=?,categories=?,quality_mode=? WHERE user_id=?`)
    .run(JSON.stringify(languages || ['pt']), JSON.stringify(countries || []), JSON.stringify(regions || []),
      JSON.stringify(categories || []), qualityMode || 'auto', req.userId);
  res.json({ ok: true });
});

// --- channels ---
// Visibilidade: lista SEMPRE tudo (teaser). Sem sub paga o PREMIUM vem sem
// stream_url e com locked:true — o cadeado/upsell é no frontend + gate.
// Esconder o PREMIUM da lista fazia o site parecer vazio/partido quando
// todos os canais estavam em PREMIUM.
function paidViewer(req: any): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  try {
    const userId = (jwt.verify(h.slice(7), JWT_SECRET) as any).sub;
    const admin: any = db.prepare('SELECT is_admin FROM users WHERE id=?').get(userId);
    if (admin?.is_admin) return userId;
    const subs: any[] = db.prepare(`SELECT s.*, p.duration_days FROM subscriptions s LEFT JOIN plans p ON p.id=s.plan_id WHERE s.user_id=? AND s.status='ACTIVE' AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))`).all(userId);
    return subs.some((s) => (s.duration_days || 0) > 0) ? userId : null;
  } catch { return null; }
}
app.get('/v1/channels', (req, res) => {
  const { q, country, language, category, region, status, page = '1', limit = '48' } = req.query as any;
  const viewer = paidViewer(req);
  let rows: any[] = db.prepare('SELECT * FROM channels ORDER BY reliability_score DESC, name LIMIT 5000').all();
  if (status !== 'all') rows = rows.filter((c) => c.status !== 'offline');
  if (q) rows = rows.filter((c) => c.name.toLowerCase().includes(String(q).toLowerCase()));
  if (country) rows = rows.filter((c) => (c.country || '').toLowerCase() === String(country).toLowerCase());
  if (region) rows = rows.filter((c) => (c.region || '').toLowerCase().includes(String(region).toLowerCase()));
  if (language) rows = rows.filter((c) => j(c.languages).map((x: string) => x.toLowerCase()).includes(String(language).toLowerCase()));
  if (category) rows = rows.filter((c) => j(c.categories).map((x: string) => x.toLowerCase()).includes(String(category).toLowerCase()));
  if (status && status !== 'all') rows = rows.filter((c) => c.status === status);
  const p = Math.max(1, parseInt(String(page))), l = Math.min(100, parseInt(String(limit)));
  const map = (c: any) => {
    const pub: any = publicChannel(req, c);
    // teaser: sem sub paga o PREMIUM lista mas sem stream (cadeado + upsell no
    // frontend; o playback continua gated em /authorization e no relay /stream).
    // Sem isto, ou o site fica vazio (se filtrar) ou há bypass (stream direto).
    if (!viewer && (c.access_level || 'FREE').toUpperCase() === 'PREMIUM') {
      pub.stream_url = null;
      pub.locked = true;
    }
    return pub;
  };
  res.json({ total: rows.length, page: p, data: rows.slice((p - 1) * l, p * l).map(map) });
});

// Relay HTTPS controlado: só permite a URL que pertence ao mesmo host da fonte
// registada no canal; não aceita URLs arbitrários nem encaminha credenciais.
app.get('/v1/channels/:id/stream', async (req: any, res) => {
  const c: any = db.prepare('SELECT * FROM channels WHERE id=?').get(req.params.id);
  if (!c || !isHttpStream(c.stream_url)) return res.status(404).json({ statusCode: 404, message: 'stream not found' });
  const premium = (c.access_level || 'FREE').toUpperCase() === 'PREMIUM';
  const hasToken = validStreamToken(req.query.st, c.id);
  if (premium && !hasToken && !paidViewer(req))
    return res.status(403).json({ statusCode: 403, message: 'upgrade_required' });
  const st = premium ? (hasToken ? String(req.query.st) : signStreamToken(c.id)) : undefined;
  const requested = String(req.query.url || '');
  let source: URL, original: URL;
  try {
    source = new URL(requested);
    original = new URL(c.stream_url);
  } catch { return res.status(400).json({ statusCode: 400, message: 'invalid stream URL' }); }
  if (!['http:', 'https:'].includes(source.protocol) || source.hostname !== original.hostname)
    return res.status(403).json({ statusCode: 403, message: 'stream host not allowed' });
  try {
    const headers: Record<string, string> = { 'User-Agent': 'KutsakaiTV/1.0' };
    if (req.headers.range) headers.Range = String(req.headers.range);
    // Timeout por tentativa: fonte pendurada não pode pendurar o pedido até
    // ao 502 do proxy (com 2 aparelhos a ver, um upstream lento se nota).
    const withTimeout = () => {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 15000);
      return { signal: ctrl.signal, done: () => clearTimeout(to) };
    };
    let t = withTimeout();
    let upstream = await fetch(source, { headers, redirect: 'manual', signal: t.signal } as any);
    t.done();
    for (let i = 0; i < 3 && upstream.status >= 300 && upstream.status < 400; i++) {
      const location = upstream.headers.get('location');
      if (!location) break;
      const next = new URL(location, source);
      if (!['http:', 'https:'].includes(next.protocol) || next.hostname !== original.hostname)
        return res.status(403).json({ statusCode: 403, message: 'redirect host not allowed' });
      source = next;
      t = withTimeout();
      upstream = await fetch(source, { headers, redirect: 'manual', signal: t.signal } as any);
      t.done();
    }
    if (!upstream.ok || !upstream.body) return res.status(upstream.status || 502).end();
    const contentType = upstream.headers.get('content-type') || '';
    const looksPlaylist = contentType.includes('mpegurl') || contentType.includes('m3u8') || source.pathname.toLowerCase().endsWith('.m3u8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    if (looksPlaylist) {
      let text = await upstream.text();
      const rewrite = (raw: string) => relayUrl(req, c.id, new URL(raw, source).toString(), st);
      text = text.replace(/^(?!#)(\s*[^\s]+\s*)$/gm, (line) => rewrite(line.trim()));
      text = text.replace(/URI="([^"]+)"/g, (_m, raw) => `URI="${rewrite(raw)}"`);
      res.type('application/vnd.apple.mpegurl').send(text);
    } else {
      if (contentType) res.setHeader('Content-Type', contentType);
      const length = upstream.headers.get('content-length');
      if (length) res.setHeader('Content-Length', length);
      const range = upstream.headers.get('content-range');
      if (range) res.setHeader('Content-Range', range);
      res.status(upstream.status);
      // Se o cliente desligar (zap/troca de canal), destrói o pipe para não
      // deixar bytes pendurados a consumir a instância.
      // Erros do pipe TÊM de ter listener: sem isto, uma fonte que cai a meio
      // do segmento lança 'error' sem handler -> uncaughtException -> o Node
      // morre e o Render reinicia (era o "cai tudo" com 2 aparelhos em relay).
      const out = Readable.fromWeb(upstream.body as any);
      out.on('error', () => { try { res.destroy(); } catch { /* noop */ } });
      res.on('error', () => { /* cliente foi embora */ });
      req.on('close', () => { try { out.destroy(); } catch { /* noop */ } });
      out.pipe(res);
    }
  } catch (e: any) {
    const aborted = String(e?.name || '').includes('Abort') || String(e?.message || '').includes('aborted');
    res.status(aborted ? 504 : 502).json({ statusCode: aborted ? 504 : 502, message: aborted ? 'upstream timeout' : String(e?.message || 'upstream unavailable').slice(0, 160) });
  }
});

app.get('/v1/channels/:id', (req, res) => {
  const c: any = db.prepare('SELECT * FROM channels WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ statusCode: 404, message: 'not found' });
  if ((c.access_level || 'FREE').toUpperCase() === 'PREMIUM' && !paidViewer(req)) {
    const { stream_url, ...rest } = c;
    return res.status(403).json({ ...rest, languages: j(c.languages), categories: j(c.categories), authorized: false, reason: 'upgrade_required' });
  }
  res.json(publicChannel(req, c));
});

app.get('/v1/channels/:id/related', (req, res) => {
  const c: any = db.prepare('SELECT * FROM channels WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ statusCode: 404, message: 'not found' });
  const cats = j(c.categories), langs = j(c.languages);
  const viewer = paidViewer(req);
  let rows: any[] = db.prepare('SELECT * FROM channels WHERE id != ? AND status != ? LIMIT 500').all(c.id, 'offline');
  const scored = rows.map((r) => {
    const rc = j(r.categories), rl = j(r.languages);
    const overlap = rc.filter((x: string) => cats.includes(x)).length + rl.filter((x: string) => langs.includes(x)).length;
    return { r, overlap };
  }).filter((x) => x.overlap > 0).sort((a, b) => b.overlap - a.overlap || b.r.reliability_score - a.r.reliability_score).slice(0, 12);
  res.json(scored.map((x) => {
    const pub: any = publicChannel(req, x.r);
    if (!viewer && (x.r.access_level || 'FREE').toUpperCase() === 'PREMIUM') {
      pub.stream_url = null;
      pub.locked = true;
    }
    return pub;
  }));
});

// --- favorites / history / events ---
app.get('/v1/me/favorites', auth, (req: any, res) => {
  const rows: any[] = db.prepare(`SELECT c.* FROM favorites f JOIN channels c ON c.id=f.channel_id WHERE f.user_id=?`).all(req.userId);
  res.json(rows.map((c) => ({ ...c, languages: j(c.languages), categories: j(c.categories) })));
});
app.post('/v1/me/favorites/:channelId', auth, (req: any, res) => {
  db.prepare('INSERT OR IGNORE INTO favorites (user_id,channel_id) VALUES (?,?)').run(req.userId, req.params.channelId);
  db.prepare('INSERT INTO user_channel_events (id,user_id,channel_id,type,weight) VALUES (?,?,?,?,?)')
    .run(randomUUID(), req.userId, req.params.channelId, 'favorite', EVENT_WEIGHTS.favorite);
  res.json({ ok: true });
});
app.delete('/v1/me/favorites/:channelId', auth, (req: any, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id=? AND channel_id=?').run(req.userId, req.params.channelId);
  res.json({ ok: true });
});

app.post('/v1/me/history', auth, (req: any, res) => {
  const { channelId, durationSec = 0, dataConsumedMB = 0 } = req.body;
  // telemetria best-effort: nunca prender o player por causa disto.
  // Se a escrita falhar (réplica ocupada no sync, rede), 503 JSON em vez
  // de deixar o pedido pendurado até o proxy dar 502 sem headers CORS.
  try {
    db.prepare('INSERT INTO watch_history (id,user_id,channel_id,duration_sec,data_consumed_mb) VALUES (?,?,?,?,?)')
      .run(randomUUID(), req.userId, channelId, durationSec, dataConsumedMB);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(503).json({ statusCode: 503, message: 'telemetry unavailable' });
  }
});
app.get('/v1/me/history', auth, (req: any, res) => {
  const rows = db.prepare(`SELECT h.*, c.name, c.logo FROM watch_history h JOIN channels c ON c.id=h.channel_id WHERE h.user_id=? ORDER BY h.started_at DESC LIMIT 100`).all(req.userId);
  res.json(rows);
});

app.post('/v1/me/events', auth, (req: any, res) => {
  const { channelId, type } = req.body;
  const w = (EVENT_WEIGHTS as any)[type];
  if (w === undefined) return res.status(400).json({ statusCode: 400, message: 'unknown event type' });
  try {
    db.prepare('INSERT INTO user_channel_events (id,user_id,channel_id,type,weight) VALUES (?,?,?,?,?)')
      .run(randomUUID(), req.userId, channelId, type, w);
    res.json({ ok: true });
  } catch {
    res.status(503).json({ statusCode: 503, message: 'telemetry unavailable' });
  }
});

// --- recommendations ---
app.get('/v1/me/recommendations', auth, (req: any, res) => {
  const limit = Math.min(50, parseInt(String((req.query as any).limit || '20')));
  const pref: any = db.prepare('SELECT * FROM user_preferences WHERE user_id=?').get(req.userId);
  const langs: string[] = j(pref.languages).map((x: string) => x.toLowerCase());
  const cats: string[] = j(pref.categories).map((x: string) => x.toLowerCase());
  const regs: string[] = j(pref.regions).map((x: string) => x.toLowerCase());
  const ev: any[] = db.prepare(`SELECT channel_id, SUM(weight) s FROM user_channel_events WHERE user_id=? AND created_at > datetime('now','-30 days') GROUP BY channel_id`).all(req.userId);
  const behav = new Map(ev.map((e) => [e.channel_id, e.s]));
  const maxB = Math.max(1, ...ev.map((e) => Math.abs(e.s)));
  const pop: any[] = db.prepare(`SELECT channel_id, COUNT(*) n FROM watch_history GROUP BY channel_id`).all();
  const maxP = Math.max(1, ...pop.map((p) => p.n));
  const popMap = new Map(pop.map((p) => [p.channel_id, Math.log1p(p.n) / Math.log1p(maxP)]));
  const isPaid = db.prepare(`SELECT COUNT(*) n FROM subscriptions s LEFT JOIN plans p ON p.id=s.plan_id WHERE s.user_id=? AND s.status='ACTIVE' AND (s.expires_at IS NULL OR s.expires_at > datetime('now')) AND (p.duration_days || 0) > 0`).get(req.userId) as any;
  const chans: any[] = db.prepare(`SELECT * FROM channels WHERE status != 'offline' LIMIT 2000`).all();
  const visible = isPaid.n ? chans : chans.filter((c) => (c.access_level || 'FREE').toUpperCase() === 'FREE');
  const scored = visible.map((c) => {
    const cl = j(c.languages).map((x: string) => String(x).toLowerCase());
    const cc = j(c.categories).map((x: string) => String(x).toLowerCase());
    const inp = {
      prefOverlap: cc.length ? cc.filter((x: string) => cats.includes(x)).length / cc.length : 0,
      langOverlap: cl.length ? cl.filter((x: string) => langs.includes(x)).length / cl.length : 0,
      regionOverlap: regs.length && c.region && regs.includes(String(c.region).toLowerCase()) ? 1 : 0,
      catOverlap: cc.length ? cc.filter((x: string) => cats.includes(x)).length / cc.length : 0,
      behavior: Math.max(0, (behav.get(c.id) || 0) / maxB),
      reliabilityScore: c.reliability_score || 0,
      popularity: popMap.get(c.id) || 0,
    };
    const score = scoreChannel(inp);
    let reason = 'popular na tua região';
    if (inp.behavior > 0.4) reason = `porque vês frequentemente ${cc.slice(0, 2).join(', ') || 'este tema'}`;
    else if (inp.langOverlap > 0) reason = `porque vês canais em ${langs.slice(0, 2).join(', ')}`;
    else if (inp.catOverlap > 0) reason = `porque gostas de ${cats.slice(0, 2).join(', ')}`;
    return { c, score, reason };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
  res.json(scored.map((s) => ({ channel: { ...s.c, languages: j(s.c.languages), categories: j(s.c.categories) }, score: +s.score.toFixed(4), reason: s.reason })));
});

// --- usage ---
app.get('/v1/me/usage/daily', auth, (req: any, res) => {
  const rows = db.prepare(`SELECT date(started_at) d, SUM(duration_sec) sec, SUM(data_consumed_mb) mb FROM watch_history WHERE user_id=? AND started_at > datetime('now','-1 day') GROUP BY d`).all(req.userId);
  res.json(rows);
});
app.get('/v1/me/usage/monthly', auth, (req: any, res) => {
  const rows = db.prepare(`SELECT strftime('%Y-%m',started_at) m, SUM(duration_sec) sec, SUM(data_consumed_mb) mb FROM watch_history WHERE user_id=? AND started_at > datetime('now','-30 days') GROUP BY m`).all(req.userId);
  res.json(rows);
});

// --- epg ---
// chaves de pesquisa: nome limpo (sem "1080p"/país), do mais específico ao mais curto.
// tokens genéricos ("tv", "canal") nunca valem sozinhos — davam falsos positivos (ex. "TV Zimbo" -> CCTV).
const EPG_STOP = new Set(['tv', 'tvs', 'canal', 'channel', 'canais', 'tele', 'tvhd', 'hdtv', 'hd', 'fhd', 'uhd', 'sd', 'plus', '+', 'ao', 'mz', 'pt', 'br']);
function epgKeys(name: string): string[] {
  const clean = String(name || '').replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim();
  const toks = clean.split(' ').filter(Boolean);
  const meaningful = toks.filter((t) => t.length >= 4 && !EPG_STOP.has(t.toLowerCase()));
  const out: string[] = [];
  if (clean.length >= 4) out.push(clean);
  const two = toks.slice(0, 2).join(' ');
  if (two.length >= 4 && !out.includes(two)) out.push(two);
  // token significativo mais longo primeiro (ex. "Mocambique" em vez de "TV")
  for (const t of [...meaningful].sort((a, b) => b.length - a.length)) {
    if (!out.includes(t)) out.push(t);
    if (out.length >= 4) break;
  }
  return [...new Set(out)].slice(0, 4);
}
function epgLookup(channelName: string) {
  for (const k of epgKeys(channelName)) {
    const rows = db.prepare(`SELECT title,start,stop,description FROM epg_programs WHERE channel_name LIKE ? AND stop > datetime('now','-30 minutes') ORDER BY start LIMIT 6`).all(`%${k}%`);
    if (rows.length) return rows;
  }
  return [];
}
app.get('/v1/channels/:id/epg', (req, res) => {
  const c: any = db.prepare('SELECT * FROM channels WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ statusCode: 404, message: 'not found' });
  const rows = epgLookup(c.name);
  res.json({ channel: c.name, now: rows[0] || null, next: rows.slice(1, 6) });
});
// guia em lote para o catálogo: 1 pedido para os N visíveis (max 60)
app.get('/v1/epg/guide', (req, res) => {
  const ids = String((req.query as any).ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60);
  if (!ids.length) return res.json([]);
  const out: any[] = [];
  for (const id of ids) {
    const c: any = db.prepare('SELECT id,name FROM channels WHERE id=?').get(id);
    if (!c) continue;
    const rows = epgLookup(c.name);
    if (rows.length) out.push({ channelId: id, now: rows[0], next: rows[1] || null });
  }
  res.json(out);
});
app.get('/v1/epg/now', (req, res) => {
  const rows = db.prepare(`SELECT channel_name,title,start,stop FROM epg_programs WHERE start <= datetime('now') AND stop > datetime('now') ORDER BY channel_name LIMIT 100`).all();
  res.json(rows);
});

// --- monetização: planos, pagamentos, subscrições ---
const fmtPlan = (p: any) => p && ({ ...p, features: j(p.features) });

app.get('/v1/plans', (req, res) => {
  const rows: any[] = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM plan_channels pc WHERE pc.plan_id=p.id) channels FROM plans p WHERE p.is_active=1 ORDER BY p.price`).all();
  res.json(rows.map(fmtPlan));
});

app.get('/v1/payment-methods', (req, res) => {
  res.json(getPaymentMethods());
});

app.post('/v1/payments', auth, async (req: any, res) => {
  const { planId, provider: providerId, phone } = req.body;
  const plan = getPlan(planId);
  if (!plan) return res.status(404).json({ statusCode: 404, message: 'plan not found' });
  const provider = (providers as any)[providerId];
  if (!provider) return res.status(400).json({ statusCode: 400, message: 'unknown provider' });
  const reference = randomUUID();
  try {
    const pp = await provider.createPayment({ amount: plan.price, currency: plan.currency, phone, reference });
    const id = randomUUID();
    db.prepare(`INSERT INTO payments (id,user_id,plan_id,provider,provider_transaction_id,amount,currency,status,metadata) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, req.userId, plan.id, provider.id, pp.providerTransactionId, plan.price, plan.currency, pp.status, JSON.stringify({ phone: phone || null }));
    res.json({ id, status: pp.status, instructions: pp.instructions || null, providerTransactionId: pp.providerTransactionId });
  } catch (e: any) {
    res.status(502).json({ statusCode: 502, message: e.message || 'provider error' });
  }
});

app.get('/v1/payments/:id', auth, async (req: any, res) => {
  const pay: any = db.prepare('SELECT * FROM payments WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!pay) return res.status(404).json({ statusCode: 404, message: 'not found' });
  const fresh = await refreshPaymentStatus(pay.id);
  res.json(fresh);
});

// foto do comprovativo (fica em metadata.receipt; admin vê no painel)
app.post('/v1/payments/:id/receipt', auth, (req: any, res) => {
  const pay: any = db.prepare('SELECT * FROM payments WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!pay) return res.status(404).json({ statusCode: 404, message: 'not found' });
  const { image } = req.body as any;
  if (typeof image !== 'string' || !image.startsWith('data:image/'))
    return res.status(400).json({ statusCode: 400, message: 'imagem inválida (usa JPG/PNG até 2MB)' });
  if (image.length > 2_800_000) return res.status(400).json({ statusCode: 400, message: 'imagem demasiado grande (máx 2MB)' });
  let meta: any = {};
  try { meta = JSON.parse(pay.metadata || '{}'); } catch { /* noop */ }
  meta.receipt = image;
  meta.receiptAt = new Date().toISOString();
  db.prepare(`UPDATE payments SET metadata=?, status=CASE WHEN status='PENDING' THEN 'PROCESSING' ELSE status END, updated_at=datetime('now') WHERE id=?`)
    .run(JSON.stringify(meta), pay.id);
  res.json({ ok: true, status: db.prepare('SELECT status FROM payments WHERE id=?').get(pay.id) });
});
// Produção (mpesa/emola) nunca passa por aqui: só webhook/poll do gateway ativa.
app.post('/v1/payments/:id/mock-confirm', auth, async (req: any, res) => {
  const pay: any = db.prepare('SELECT * FROM payments WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!pay || pay.provider !== 'mock') return res.status(404).json({ statusCode: 404, message: 'not found' });
  res.json(completePayment(pay.id));
});

app.post('/v1/webhooks/:provider', async (req, res) => {
  const provider = (providers as any)[req.params.provider];
  if (!provider) return res.status(404).json({ statusCode: 404, message: 'unknown provider' });
  const sig = req.headers['x-signature'] as string;
  if (!provider.verifyWebhook(req.body, sig)) return res.status(401).json({ statusCode: 401, message: 'bad signature' });
  const tx = req.body?.providerTransactionId || req.body?.transaction_id;
  if (!tx) return res.status(400).json({ statusCode: 400, message: 'missing transaction id' });
  const pay: any = db.prepare('SELECT * FROM payments WHERE provider_transaction_id=?').get(tx);
  if (!pay) return res.status(404).json({ statusCode: 404, message: 'payment not found' });
  const fresh = await refreshPaymentStatus(pay.id);
  res.json({ ok: true, status: (fresh as any)?.status });
});

app.get('/v1/me/payments', auth, (req: any, res) => {
  const rows = db.prepare(`SELECT p.*, pl.name plan_name FROM payments p LEFT JOIN plans pl ON pl.id=p.plan_id WHERE p.user_id=? ORDER BY p.created_at DESC LIMIT 100`).all(req.userId);
  res.json(rows);
});

app.get('/v1/me/subscription', auth, (req: any, res) => {
  const { active, subscription, plan } = hasActiveSubscription(req.userId);
  res.json({ active, subscription: subscription || null, plan: plan ? fmtPlan(plan) : null });
});

app.post('/v1/me/subscription/cancel', auth, (req: any, res) => {
  db.prepare(`UPDATE subscriptions SET status='CANCELLED' WHERE user_id=? AND status='ACTIVE'`).run(req.userId);
  res.json({ ok: true });
});

// gate de conteúdo: o player consulta antes de tocar PREMIUM
app.get('/v1/channels/:id/authorization', (req, res) => {
  let userId: string | null = null;
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    try { userId = (jwt.verify(h.slice(7), JWT_SECRET) as any).sub; }
    catch { return res.status(401).json({ statusCode: 401, message: 'token expired' }); } // não tratar como anónimo: o cliente renova o token
  }
  const c: any = db.prepare('SELECT id,access_level FROM channels WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ statusCode: 404, message: 'not found' });
  if (userId && (db.prepare('SELECT is_admin FROM users WHERE id=?').get(userId) as any)?.is_admin)
    return res.json({ authorized: true, reason: 'admin_preview' });
  res.json(authorizeChannel(userId, c));
});

// --- admin: planos + níveis de acesso ---
const isAdmin = (userId: string) => (db.prepare('SELECT is_admin FROM users WHERE id=?').get(userId) as any)?.is_admin;

app.get('/v1/admin/plans', auth, (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  res.json((db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM plan_channels pc WHERE pc.plan_id=p.id) channels FROM plans p ORDER BY p.price`).all() as any[]).map(fmtPlan));
});
app.put('/v1/admin/plans/:id', auth, (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  const { name, price, duration_days, max_devices, max_quality, features, is_active } = req.body;
  db.prepare(`UPDATE plans SET name=COALESCE(?,name), price=COALESCE(?,price), duration_days=COALESCE(?,duration_days), max_devices=COALESCE(?,max_devices), max_quality=COALESCE(?,max_quality), features=COALESCE(?,features), is_active=COALESCE(?,is_active) WHERE id=?`)
    .run(name ?? null, price ?? null, duration_days ?? null, max_devices ?? null, max_quality ?? null, features ? JSON.stringify(features) : null, is_active ?? null, req.params.id);
  res.json(fmtPlan(db.prepare('SELECT * FROM plans WHERE id=?').get(req.params.id)));
});
app.put('/v1/admin/channels/:id/access', auth, (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  const level = String(req.body.accessLevel || 'FREE').toUpperCase();
  if (!['FREE', 'PREMIUM'].includes(level)) return res.status(400).json({ statusCode: 400, message: 'use FREE or PREMIUM' });
  db.prepare(`UPDATE channels SET access_level=? WHERE id=?`).run(level, req.params.id);
  res.json({ ok: true, accessLevel: level });
});

// --- admin ---
app.get('/v1/admin/stats', auth, (req: any, res) => {
  const me: any = db.prepare('SELECT is_admin FROM users WHERE id=?').get((req as any).userId);
  if (!me?.is_admin) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  const users = (db.prepare('SELECT COUNT(*) n FROM users').get() as any).n;
  const chans = (db.prepare('SELECT COUNT(*) n FROM channels').get() as any).n;
  const online = (db.prepare("SELECT COUNT(*) n FROM channels WHERE status='online'").get() as any).n;
  const offline = (db.prepare("SELECT COUNT(*) n FROM channels WHERE status='offline'").get() as any).n;
  const watchH = (db.prepare('SELECT COALESCE(SUM(duration_sec),0) s FROM watch_history').get() as any).s;
  const epg = (db.prepare('SELECT COUNT(*) n FROM epg_programs').get() as any).n;
  res.json({ users, streams: chans, online, offline, watchSeconds: watchH, epg });
});
app.get('/v1/admin/channels', auth, (req: any, res) => {
  const me: any = db.prepare('SELECT is_admin FROM users WHERE id=?').get((req as any).userId);
  if (!me?.is_admin) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  const { status, q, access, page = '1', limit = '50' } = req.query as any;
  let rows: any[] = db.prepare('SELECT id,name,country,status,access_level,reliability_score,last_checked FROM channels ORDER BY name LIMIT 5000').all();
  if (status) rows = rows.filter((c) => c.status === status);
  if (access) rows = rows.filter((c) => (c.access_level || 'FREE').toUpperCase() === String(access).toUpperCase());
  if (q) rows = rows.filter((c) => c.name.toLowerCase().includes(String(q).toLowerCase()));
  const p = Math.max(1, parseInt(String(page))), l = Math.min(100, parseInt(String(limit)));
  res.json({ total: rows.length, page: p, data: rows.slice((p - 1) * l, p * l) });
});
app.get('/v1/admin/payments', auth, (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  const { status } = req.query as any;
  let rows: any[] = db.prepare(`SELECT p.*, pl.name plan_name, u.name user_name, u.email FROM payments p LEFT JOIN plans pl ON pl.id=p.plan_id LEFT JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 300`).all();
  if (status) rows = rows.filter((p) => p.status === String(status).toUpperCase());
  res.json(rows);
});
app.post('/v1/admin/payments/:id/approve', auth, (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  const pay: any = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);
  if (!pay) return res.status(404).json({ statusCode: 404, message: 'not found' });
  if (pay.status === 'COMPLETED') return res.json(pay);
  res.json(completePayment(pay.id));
});
app.post('/v1/admin/payments/:id/reject', auth, (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  db.prepare(`UPDATE payments SET status='FAILED', updated_at=datetime('now') WHERE id=? AND status NOT IN ('COMPLETED','REFUNDED')`).run(req.params.id);
  res.json(db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id));
});
app.get('/v1/admin/users', auth, (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  const rows = db.prepare('SELECT id,name,email,country,created_at FROM users ORDER BY created_at DESC LIMIT 200').all();
  res.json(rows);
});

// --- admin: backup / restore ---
// Efemeridade do Render Free resolvida por snapshots R2 (restore automático no
// arranque). O JSON de /backup continua para download manual; /backup/snapshot
// força um snapshot imediato para o R2.
// snapshot imediato para o R2 (o JSON de /backup continua para download manual)
app.post('/v1/admin/backup/snapshot', auth, async (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  if (!r2Configured()) return res.status(400).json({ statusCode: 400, message: 'R2 sem configurar (env R2_*)' });
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* noop */ }
  const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data.db');
  const ok = await r2UploadDb(dbPath);
  res.json({ ok, at: new Date().toISOString() });
});
const BACKUP_TABLES = ['users', 'user_preferences', 'channels', 'favorites', 'watch_history', 'user_channel_events', 'recommendations', 'subscriptions', 'plans', 'plan_channels', 'payments'];

// Núcleo do restore, reutilizado pelo endpoint manual e pelo restore
// automático no arranque (cofre GitHub). Devolve resumo por tabela.
function restoreTables(incoming: any): { ok: boolean; restored?: any; error?: string } {
  if (!incoming || typeof incoming !== 'object') return { ok: false, error: 'body.tables required' };
  const summary: any = {};
  try {
    db.exec('BEGIN');
    for (const t of BACKUP_TABLES) {
      const rows = Array.isArray(incoming[t]) ? incoming[t] : [];
      if (!rows.length) { summary[t] = 0; continue; }
      const cols: any[] = db.prepare(`PRAGMA table_info(${t})`).all() as any[];
      const names = cols.map((c) => c.name).filter((n) => n in (rows[0] as any));
      if (!names.length) { summary[t] = 0; continue; }
      const stmt = db.prepare(`INSERT OR REPLACE INTO ${t} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`);
      let n = 0;
      for (const r of rows) {
        try { stmt.run(...names.map((k) => (r as any)[k] ?? null)); n++; }
        catch { /* linha incompatível: ignora */ }
      }
      summary[t] = n;
    }
    db.exec('COMMIT');
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch { /* noop */ }
    return { ok: false, error: 'restore falhou: ' + (e?.message || e) };
  }
  return { ok: true, restored: summary };
}

// Cofre GitHub (repo privado, sem cartão): se a DB está vazia no arranque
// (restart no Render) e BACKUP_GIT_URL aponta para o latest.json,
// repõe users/subs/pagamentos antes do seed. RPO = intervalo do workflow.
async function restoreFromGitHubIfEmpty(): Promise<boolean> {
  const url = process.env.BACKUP_GIT_URL || '';
  if (!url) return false;
  try {
    const n = (db.prepare('SELECT COUNT(*) n FROM channels').get() as any).n;
    if (n > 0) return false; // disco com dados — nada a fazer
  } catch { /* segue para tentar repor */ }
  console.log('[backup] DB vazia, a repor do cofre GitHub…');
  try {
    const headers: Record<string, string> = {};
    if (process.env.BACKUP_GIT_TOKEN) headers.authorization = `Bearer ${process.env.BACKUP_GIT_TOKEN}`;
    const r = await fetch(url, { headers });
    if (!r.ok) { console.log(`[backup] cofre respondeu ${r.status}`); return false; }
    const j: any = await r.json();
    const res = restoreTables(j?.tables);
    console.log('[backup] restore do cofre:', res.ok ? JSON.stringify(res.restored) : res.error);
    return res.ok;
  } catch (e: any) {
    console.log('[backup] cofre falhou:', e?.message);
    return false;
  }
}
app.get('/v1/admin/backup', auth, (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  const tables: any = {};
  for (const t of BACKUP_TABLES) {
    try { tables[t] = db.prepare(`SELECT * FROM ${t}`).all(); }
    catch { tables[t] = []; }
  }
  res.setHeader('Content-Disposition', `attachment; filename="kutsakai-backup-${Date.now()}.json"`);
  res.json({ exportedAt: new Date().toISOString(), tables });
});
app.post('/v1/admin/restore', auth, (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  const r = restoreTables((req.body as any)?.tables);
  if (!r.ok) return res.status(400).json({ statusCode: 400, message: r.error });
  res.json({ ok: true, restored: r.restored });
});

// --- pacotes: canais por plano + verificação profunda ---
app.get('/v1/admin/plans/:id/channels', auth, (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  const rows = db.prepare(`SELECT c.id,c.name,c.country,c.status,c.access_level FROM plan_channels pc JOIN channels c ON c.id=pc.channel_id WHERE pc.plan_id=? ORDER BY c.name`).all(req.params.id);
  res.json(rows);
});
app.post('/v1/admin/plans/:id/channels', auth, (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  const { channelId } = req.body;
  if (!channelId) return res.status(400).json({ statusCode: 400, message: 'channelId required' });
  db.prepare('INSERT OR IGNORE INTO plan_channels (plan_id,channel_id) VALUES (?,?)').run(req.params.id, channelId);
  db.prepare(`UPDATE channels SET access_level='PREMIUM' WHERE id=? AND (access_level IS NULL OR access_level='FREE')`).run(channelId);
  res.json({ ok: true });
});
app.delete('/v1/admin/plans/:id/channels/:channelId', auth, (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  db.prepare('DELETE FROM plan_channels WHERE plan_id=? AND channel_id=?').run(req.params.id, req.params.channelId);
  const left: any = db.prepare('SELECT COUNT(*) n FROM plan_channels WHERE channel_id=?').get(req.params.channelId);
  if (!left.n) db.prepare(`UPDATE channels SET access_level='FREE' WHERE id=?`).run(req.params.channelId);
  res.json({ ok: true });
});
// liberta um canal: sai de todos os pacotes e volta a FREE
app.post('/v1/admin/channels/:id/make-free', auth, (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  db.prepare('DELETE FROM plan_channels WHERE channel_id=?').run(req.params.id);
  db.prepare(`UPDATE channels SET access_level='FREE' WHERE id=?`).run(req.params.id);
  res.json({ ok: true, accessLevel: 'FREE' });
});
// bulk: mete TODOS os canais em FREE ou PREMIUM de uma vez
// (depois escolhes à mão os que ficam FREE, um a um na tabela)
// Sincroniza plan_channels para os contadores do /plans não mentirem.
app.post('/v1/admin/channels/access-bulk', auth, (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  const level = String(req.body?.accessLevel || '').toUpperCase();
  if (!['FREE', 'PREMIUM'].includes(level)) return res.status(400).json({ statusCode: 400, message: 'use FREE or PREMIUM' });
  const r = db.prepare(`UPDATE channels SET access_level=?`).run(level);
  if (level === 'PREMIUM') {
    // bulk NUMA só ida (ver seedPlans: loop N×M matava a réplica Turso)
    db.exec(`INSERT OR IGNORE INTO plan_channels (plan_id,channel_id)
      SELECT p.id, c.id FROM plans p, channels c
      WHERE p.duration_days > 0 AND c.access_level='PREMIUM'`);
  } else {
    db.prepare('DELETE FROM plan_channels').run();
  }
  res.json({ ok: true, accessLevel: level, updated: r.changes });
});

// verificação profunda de UM canal (prova o segmento; corrige falsos offline)
app.post('/v1/admin/channels/:id/verify', auth, async (req: any, res) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ statusCode: 403, message: 'admin only' });
  const c: any = db.prepare('SELECT * FROM channels WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ statusCode: 404, message: 'not found' });
  const r = await checkStream(c.stream_url);
  // sonda de codecs (melhor esforço, ~256KB do 1º segmento): grava o codec de
  // vídeo para o frontend avisar quando a fonte é incompatível com browsers
  // (ex. mpeg2video → áudio no browser, vídeo só no VLC).
  let videoCodec: string | null = null;
  try {
    const probe = await probeCodecs(c.stream_url);
    videoCodec = probe.videoCodec;
    if (videoCodec) db.prepare(`UPDATE channels SET codec=? WHERE id=?`).run(videoCodec, c.id);
  } catch { /* sonda é opcional */ }
  db.prepare(`INSERT INTO stream_checks (id,channel_id,status,latency_ms,error) VALUES (?,?,?,?,?)`)
    .run(randomUUID(), c.id, r.status, r.latencyMs || null, r.error || null);
  const week: any = db.prepare(`SELECT COUNT(*) t, SUM(CASE WHEN status='online' THEN 1 ELSE 0 END) o FROM stream_checks WHERE channel_id=? AND checked_at > datetime('now','-7 days')`).get(c.id) as any;
  const rel = week?.t ? (100 * (week.o || 0)) / week.t : (r.status === 'online' ? 100 : 0);
  db.prepare(`UPDATE channels SET status=?, reliability_score=?, last_checked=datetime('now') WHERE id=?`).run(r.status, rel, c.id);
  res.json({ status: r.status, latencyMs: r.latencyMs || null, provedBySegment: !!r.provedBySegment, error: r.error || null, reliability: Math.round(rel), videoCodec });
});

// achado 7: 404 JSON padronizado (sem "Cannot GET" do Express a expor rotas)
app.use((_req, res) => res.status(404).json({ statusCode: 404, message: 'not found' }));

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API on :${PORT}`);
  // seed de planos DEPOIS do bind (na réplica Turso cada escrita é um
  // round-trip à cloud; antes do listen o Render matava o deploy por
  // "no open ports detected").
  try { seedPlans(); } catch (e: any) { console.log('[plans] seed falhou:', e?.message); }
  // Turso = persistência real: sem snapshots R2, sem checkpoint WAL manual.
  // Modo local: snapshots R2 (persistência no Render Free) + seed se a DB estiver vazia
  try {
    if (isTurso()) {
      console.log('[r2] modo Turso — snapshots R2 desativados (a cloud é a persistência)');
    } else {
      const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data.db');
      startR2Backups(dbPath, () => db.exec('PRAGMA wal_checkpoint(TRUNCATE)'));
    }
  } catch (e: any) { console.log('[r2] arranque falhou:', e?.message); }
  // cofre GitHub (sem cartão): repõe users/subs/pagamentos se o disco acordou
  // vazio; só depois o seed semeia canais se continuar vazio.
  (async () => {
    await restoreFromGitHubIfEmpty().catch((e) => console.log('[backup] falhou', e?.message));
    // free tier sem Shell: semeia canais sozinho se a DB estiver vazia (não bloqueia o arranque)
    autoSeedIfEmpty().catch((e) => console.log('[seed] falhou', e?.message));
  })();
});
