import { randomUUID } from 'node:crypto';
import { db } from './db.js';

// ---------------------------------------------------------------------------
// Kutsakai TV — infraestrutura de monetização (modular, sem dependência de gateway)
// Ver PAYMENTS.md para credenciais, webhooks e como ligar M-Pesa / e-Mola reais.
// ---------------------------------------------------------------------------

export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';
export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING' | 'PAUSED';

export interface CreatePaymentInput {
  userId: string;
  planId: string;
  provider: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderPayment {
  providerTransactionId: string;
  status: PaymentStatus;
  instructions?: string;
}

export interface PaymentProvider {
  id: string;
  label: string;
  createPayment(input: { amount: number; currency: string; phone?: string; reference: string }): Promise<ProviderPayment>;
  getPaymentStatus(providerTransactionId: string): Promise<PaymentStatus>;
  verifyWebhook(payload: any, signature?: string): boolean;
}

// --- Mock (sandbox local: aprova sozinho após ~25s ou via /mock-confirm) ---
const mockStore = new Map<string, number>();
const mockProvider: PaymentProvider = {
  id: 'mock',
  label: 'Mock / Sandbox (testes locais)',
  async createPayment({ reference }) {
    const tx = `MOCK-${reference.slice(0, 8).toUpperCase()}`;
    mockStore.set(tx, Date.now());
    return { providerTransactionId: tx, status: 'PENDING', instructions: 'Pagamento simulado: será confirmado automaticamente em ~25s ou via botão de teste.' };
  },
  async getPaymentStatus(tx) {
    const t0 = mockStore.get(tx);
    if (!t0) return 'FAILED';
    return Date.now() - t0 > 25_000 ? 'COMPLETED' : 'PENDING';
  },
  verifyWebhook() { return true; },
};

// --- Pagamento MANUAL (M-Pesa / e-Mola via aprovação do admin) ---
// O cliente paga para o número comercial e envia o comprovativo via WhatsApp.
// A subscrição só ativa quando o admin aprova em /admin. Sem APIs ligadas.
function manualProvider(id: string, label: string, merchantEnv: string): PaymentProvider {
  return {
    id,
    label,
    async createPayment({ amount, currency, reference }) {
      const merchant = process.env[merchantEnv] || '';
      const wa = process.env.WHATSAPP_NUMBER || '';
      const lines = [
        `Paga ${amount} ${currency} para o número ${merchant || '(número comercial por configurar)'} via ${label}.`,
        `Referência: ${reference.slice(0, 8).toUpperCase()}.`,
        wa ? `Envia o comprovativo para o WhatsApp ${wa} e aguarda aprovação.` : `Envia o comprovativo para o WhatsApp da Kutsakai TV e aguarda aprovação.`,
      ];
      return { providerTransactionId: `${id.toUpperCase()}-${reference.slice(0, 8).toUpperCase()}`, status: 'PENDING', instructions: lines.join(' ') };
    },
    async getPaymentStatus() { return 'PENDING'; }, // só o admin muda o estado
    verifyWebhook() { return false; },
  };
}

// --- M-Pesa (Vodacom Moçambique) ---
// Automático (API C2B) quando houver credenciais — ver PAYMENTS.md.
// Sem credenciais: funciona em modo manual (instruções + aprovação admin).
const mpesaProvider: PaymentProvider = process.env.MPESA_API_KEY
  ? {
      id: 'mpesa',
      label: 'M-Pesa',
      async createPayment() { throw new Error('M-Pesa automático: implementar chamada C2B (ver PAYMENTS.md)'); },
      async getPaymentStatus() { throw new Error('M-Pesa automático: implementar consulta (ver PAYMENTS.md)'); },
      verifyWebhook() { return false; },
    }
  : manualProvider('mpesa', 'M-Pesa', 'MPESA_MERCHANT_MSISDN');

// --- e-Mola (Movitel): idem ---
const emolaProvider: PaymentProvider = process.env.EMOLA_API_KEY
  ? {
      id: 'emola',
      label: 'e-Mola',
      async createPayment() { throw new Error('e-Mola automático: implementar chamada (ver PAYMENTS.md)'); },
      async getPaymentStatus() { throw new Error('e-Mola automático: implementar consulta (ver PAYMENTS.md)'); },
      verifyWebhook() { return false; },
    }
  : manualProvider('emola', 'e-Mola', 'EMOLA_MERCHANT_MSISDN');

export const providers: Record<string, PaymentProvider> = {
  mock: mockProvider,
  mpesa: mpesaProvider,
  emola: emolaProvider,
};

// Métodos expostos ao frontend (sem hardcodar no cliente)
export function getPaymentMethods() {
  const meta: Record<string, { merchantEnv: string; kind: string }> = {
    mock: { merchantEnv: '', kind: 'test' },
    mpesa: { merchantEnv: 'MPESA_MERCHANT_MSISDN', kind: process.env.MPESA_API_KEY ? 'auto' : 'manual' },
    emola: { merchantEnv: 'EMOLA_MERCHANT_MSISDN', kind: process.env.EMOLA_API_KEY ? 'auto' : 'manual' },
  };
  return Object.values(providers).map((p) => ({
    id: p.id,
    label: p.label,
    kind: meta[p.id]?.kind || 'manual',
    merchant: (meta[p.id]?.merchantEnv && process.env[meta[p.id].merchantEnv]) || '',
    whatsapp: process.env.WHATSAPP_NUMBER || '',
  }));
}

// --- Planos (preços via ENV para testes; admin altera via API) ---
const SEED_PLANS = [
  { code: 'free', name: 'Kutsakai Free', price: 0, currency: 'MZN', duration_days: 0, max_devices: 1, max_quality: '480p', features: ['Catálogo limitado', 'Qualidade até 480p', '1 dispositivo'] },
  { code: 'daily', name: 'Kutsakai Daily', price: parseFloat(process.env.PLAN_DAILY_PRICE || '15'), currency: 'MZN', duration_days: 1, max_devices: 1, max_quality: '720p', features: ['Catálogo completo', 'Qualidade até 720p', '1 dispositivo', 'Sem anúncios'] },
  { code: 'weekly', name: 'Kutsakai Weekly', price: parseFloat(process.env.PLAN_WEEKLY_PRICE || '105'), currency: 'MZN', duration_days: 7, max_devices: 2, max_quality: '1080p', features: ['Catálogo completo', 'Qualidade até 1080p', '2 dispositivos', 'Sem anúncios', 'Recomendações'] },
  { code: 'monthly', name: 'Kutsakai Monthly', price: parseFloat(process.env.PLAN_MONTHLY_PRICE || '450'), currency: 'MZN', duration_days: 30, max_devices: 3, max_quality: '1080p', features: ['Catálogo completo', 'Qualidade máxima', '3 dispositivos', 'Sem anúncios', 'Recomendações', 'Estatísticas'] },
];

export function seedPlans() {
  const ins = db.prepare(`INSERT INTO plans (id,code,name,price,currency,duration_days,max_devices,max_quality,features) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(code) DO NOTHING`);
  for (const p of SEED_PLANS) ins.run(randomUUID(), p.code, p.name, p.price, p.currency, p.duration_days, p.max_devices, p.max_quality, JSON.stringify(p.features));
  // amostra PREMIUM para testar o gate (só onde ainda é FREE)
  db.exec(`UPDATE channels SET access_level='PREMIUM' WHERE id IN (SELECT id FROM channels WHERE status='online' AND categories LIKE '%sport%' LIMIT 8)`);
  db.exec(`UPDATE channels SET access_level='PREMIUM' WHERE id IN (SELECT id FROM channels WHERE status='online' AND categories LIKE '%movi%' AND (access_level IS NULL OR access_level='FREE') LIMIT 8)`);
  // atribui os PREMIUM aos 3 planos pagos (ponto de partida; admin reorganiza no painel)
  const paid: any[] = db.prepare(`SELECT id FROM plans WHERE duration_days > 0`).all();
  const prem: any[] = db.prepare(`SELECT id FROM channels WHERE access_level='PREMIUM'`).all();
  const link = db.prepare('INSERT OR IGNORE INTO plan_channels (plan_id,channel_id) VALUES (?,?)');
  for (const p of paid) for (const c of prem) link.run(p.id, c.id);
}

export function getPlan(idOrCode: string): any {
  return db.prepare('SELECT * FROM plans WHERE (id=? OR code=?) AND is_active=1').get(idOrCode, idOrCode);
}

// Central: o utilizador tem subscrição válida? Nunca confiar no frontend.
export function hasActiveSubscription(userId: string): { active: boolean; subscription?: any; plan?: any } {
  const sub: any = db.prepare(`SELECT * FROM subscriptions WHERE user_id=? AND status='ACTIVE' AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY expires_at DESC LIMIT 1`).get(userId);
  if (!sub) return { active: false };
  const plan = sub.plan_id ? db.prepare('SELECT * FROM plans WHERE id=?').get(sub.plan_id) : null;
  return { active: true, subscription: sub, plan };
}

// Autorização de conteúdo: FREE liberta; PREMIUM exige sub paga ativa.
// Qualquer sub paga (daily/weekly/monthly) abre QUALQUER premium —
// plan_channels é só organizacional/contadores, nunca gate (evita o
// "plan_required" fantasma quando o bulk muda tudo para PREMIUM).
// Admin passa sempre (preview sem precisar de comprar).
export function authorizeChannel(userId: string | null, channel: any): { authorized: boolean; reason: string } {
  const level = (channel.access_level || 'FREE').toUpperCase();
  if (level === 'FREE') return { authorized: true, reason: 'free' };
  if (!userId) return { authorized: false, reason: 'login_required' };
  try {
    if ((db.prepare('SELECT is_admin FROM users WHERE id=?').get(userId) as any)?.is_admin)
      return { authorized: true, reason: 'admin' };
  } catch { /* segue */ }
  const subs: any[] = db.prepare(`SELECT s.*, p.duration_days FROM subscriptions s LEFT JOIN plans p ON p.id=s.plan_id WHERE s.user_id=? AND s.status='ACTIVE' AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))`).all(userId);
  const paid = subs.filter((s) => (s.duration_days || 0) > 0);
  if (!paid.length) return { authorized: false, reason: 'upgrade_required' };
  return { authorized: true, reason: 'subscription' };
}

// Ativação — SÓ chamada pelo backend após confirmação do gateway/webhook/poll.
export function completePayment(paymentId: string) {
  const pay: any = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
  if (!pay || pay.status === 'COMPLETED') return pay;
  const plan: any = pay.plan_id ? db.prepare('SELECT * FROM plans WHERE id=?').get(pay.plan_id) : null;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(`UPDATE payments SET status='COMPLETED', updated_at=datetime('now'), completed_at=datetime('now') WHERE id=?`).run(paymentId);
  if (plan && plan.duration_days > 0) {
    const end = new Date(Date.now() + plan.duration_days * 86400_000).toISOString().slice(0, 19).replace('T', ' ');
    db.prepare(`UPDATE subscriptions SET status='EXPIRED' WHERE user_id=? AND status='ACTIVE'`).run(pay.user_id);
    const sid = randomUUID();
    db.prepare(`INSERT INTO subscriptions (id,user_id,plan,plan_id,status,started_at,expires_at,auto_renew,payment_provider) VALUES (?,?,?,?,?,datetime('now'),?,?,?)`)
      .run(sid, pay.user_id, plan.code, plan.id, 'ACTIVE', end, 0, pay.provider);
    db.prepare(`UPDATE payments SET subscription_id=? WHERE id=?`).run(sid, paymentId);
  }
  return db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
}

// Poll honesto: pergunta ao provider; só ativa no COMPLETED real.
export async function refreshPaymentStatus(paymentId: string) {
  const pay: any = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
  if (!pay) return null;
  if (['COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED', 'EXPIRED'].includes(pay.status)) return pay;
  const provider = providers[pay.provider];
  if (!provider) return pay;
  try {
    const st = await provider.getPaymentStatus(pay.provider_transaction_id);
    if (st === 'COMPLETED') return completePayment(paymentId);
    // com comprovativo anexado (PROCESSING) nunca regride para PENDING
    if (pay.status === 'PROCESSING' && st === 'PENDING') return pay;
    if (st !== pay.status) db.prepare(`UPDATE payments SET status=?, updated_at=datetime('now') WHERE id=?`).run(st, paymentId);
  } catch { /* gateway indisponível: mantém estado, frontend continua a mostrar pendente */ }
  return db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
}
