// scripts/load-test-k6.js — teste de carga com k6 (https://k6.io).
// Instalar: winget install k6   (ou: choco install k6)
// Correr LOCAL primeiro (nunca carga total em produção no free tier):
//   npx tsx apps/api/src/main.ts &
//   k6 run scripts/load-test-k6.js
// Contra produção, só smoke leve fora de hora:
//   k6 run -e BASE_URL=https://api.kutsakai.dpdns.org/v1 -e SMOKE=1 scripts/load-test-k6.js
//
// O que mede: latência p95 + taxa de erro em navegação (canais/epg) e, se
// CHANNEL_ID vier de fonte relayed, throughput de playlist via relay.
// thresholds falham o teste se p95 > 1.5s ou erros > 5%.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3001/v1';
const SMOKE = __ENV.SMOKE === '1';
const CHANNEL_ID = __ENV.CHANNEL_ID || '';

export const options = SMOKE
  ? {
      vus: 5,
      duration: '1m',
      thresholds: { http_req_failed: ['rate<0.05'], http_req_duration: ['p(95)<2000'] },
    }
  : {
      scenarios: {
        browse: {
          executor: 'ramping-vus',
          startVUs: 1,
          stages: [
            { duration: '1m', target: 10 },
            { duration: '2m', target: 30 },
            { duration: '2m', target: 50 },
            { duration: '1m', target: 0 },
          ],
          exec: 'browse',
        },
        ...(CHANNEL_ID ? {
          relay: {
            executor: 'constant-vus',
            vus: 5,
            duration: '3m',
            exec: 'relayStream',
          },
        } : {}),
      },
      thresholds: { http_req_failed: ['rate<0.05'], http_req_duration: ['p(95)<1500'] },
    };

export function browse() {
  const r1 = http.get(`${BASE}/channels?limit=48&page=1`);
  check(r1, { 'channels 200': (r) => r.status === 200 });
  const r2 = http.get(`${BASE}/epg/now`);
  check(r2, { 'epg/now 200': (r) => r.status === 200 });
  const r3 = http.get(`${BASE}/plans`);
  check(r3, { 'plans 200': (r) => r.status === 200 });
  sleep(1);
}

// Puxa a playlist via relay (custo real de CPU/rede por viewer relayed).
export function relayStream() {
  const meta = http.get(`${BASE}/channels/${CHANNEL_ID}`);
  check(meta, { 'channel 200': (r) => r.status === 200 });
  if (meta.status !== 200) { sleep(1); return; }
  const streamUrl = meta.json().stream_url;
  if (!streamUrl) { sleep(1); return; }
  const r = http.get(streamUrl);
  check(r, { 'stream 200': (x) => x.status === 200 });
  sleep(4); // ~ cadência de segmentos HLS
}
