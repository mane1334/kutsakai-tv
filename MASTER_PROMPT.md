# Prompt Mestre — Plataforma Inteligente de Descoberta IPTV

## 0. Contexto
Construir plataforma personalizada de descoberta e reprodução de canais públicos (fonte inicial: iptv-org), com conta, onboarding, recomendações, filtros, monitorização de qualidade, consumo de dados e assinatura pelo uso da plataforma.
Não acoplar a app diretamente ao `index.m3u`. Importar → normalizar → PostgreSQL → API → Apps.

Fontes iptv-org:
- `https://iptv-org.github.io/iptv/index.m3u` (geral)
- `https://iptv-org.github.io/iptv/categories/<categoria>.m3u`
- `https://iptv-org.github.io/iptv/languages/<codigo>.m3u`
- `https://iptv-org.github.io/iptv/countries/<codigo>.m3u`
- Database: `https://github.com/iptv-org/database` (canais, logos, categorias)
- EPG: `https://github.com/iptv-org/epg`

## 1. Stack (não trocar sem motivo)
- Frontend Web MVP: Next.js 14 + TypeScript + Tailwind + shadcn/ui + hls.js
- Backend: NestJS + TypeScript + Prisma + PostgreSQL 16 + Redis 7 + BullMQ
- Workers: Node.js + BullMQ + ffmpeg/ffprobe
- Auth: JWT access (15min) + refresh (30d, rotativo, httpOnly cookie) + argon2
- Infra local: Docker Compose (postgres, redis, api, worker, web, nginx)

## 2. Estrutura de pastas (criar exatamente)
```
./
├── apps/web/              # Next.js
├── apps/api/              # NestJS
├── apps/worker/           # playlist-sync, stream-monitor, recommendation, usage
├── packages/database/     # Prisma client export
├── packages/types/        # DTOs partilhados
├── packages/recommendation-engine/
├── packages/m3u-parser/
├── packages/stream-monitor/
├── prisma/schema.prisma
├── docker-compose.yml
├── README.md
```

## 3. Modelo de dados (Prisma + PostgreSQL)
Implementar tabelas: users, user_preferences, channels, watch_history, favorites, user_channel_events, recommendations, subscriptions, payments, stream_checks.

```prisma
model User {
  id String @id @default(uuid())
  name String
  email String @unique
  passwordHash String
  country String?
  language String @default("pt")
  createdAt DateTime @default(now())
  preferences UserPreferences?
  favorites Favorite[]
  history WatchHistory[]
  events UserChannelEvent[]
  recommendations Recommendation[]
  subscriptions Subscription[]
}

model UserPreferences {
  userId String @id
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  languages String[] @default(["pt"])
  countries String[] @default([])
  regions String[] @default([])
  categories String[] @default([])
  qualityMode String @default("auto") // auto | saver | max
  dataSaver Boolean @default(false)
}

model Channel {
  id String @id @default(uuid())
  name String
  logo String?
  streamUrl String @unique
  country String?
  region String?
  languages String[] @default([])
  categories String[] @default([])
  resolution String?
  bitrate Int?
  codec String?
  status String @default("unknown") // online | degraded | offline | unknown
  reliabilityScore Float @default(0)
  lastChecked DateTime?
  updatedAt DateTime @updatedAt
  favorites Favorite[]
  history WatchHistory[]
  events UserChannelEvent[]
  checks StreamCheck[]
  recommendations Recommendation[]
}

model WatchHistory {
  id String @id @default(uuid())
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  channelId String
  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  startedAt DateTime @default(now())
  endedAt DateTime?
  durationSec Int @default(0)
  dataConsumedMB Float @default(0)
}

model Favorite {
  userId String
  channelId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  @@id([userId, channelId])
}

model UserChannelEvent {
  id String @id @default(uuid())
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  channelId String
  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  type String // opened | watched_30s | watched_5min | watched_30min | favorite | returned | skipped
  weight Int
  createdAt DateTime @default(now())
}

model Recommendation {
  id String @id @default(uuid())
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  channelId String
  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  score Float
  reason String
  generatedAt DateTime @default(now())
}

model Subscription {
  id String @id @default(uuid())
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan String // free | basic | premium
  status String @default("active")
  startedAt DateTime @default(now())
  expiresAt DateTime?
}

model Payment {
  id String @id @default(uuid())
  userId String
  amount Float
  currency String @default("MZN")
  provider String
  transactionId String? @unique
  status String @default("pending")
  createdAt DateTime @default(now())
}

model StreamCheck {
  id String @id @default(uuid())
  channelId String
  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  checkedAt DateTime @default(now())
  status String
  latencyMs Int?
  resolution String?
  bitrate Int?
  error String?
}
```

## 4. API REST (NestJS, prefixo /v1)
- `POST /v1/auth/register` {name,email,password,country,language} → cria user + preferences default + subscription free
- `POST /v1/auth/login`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`
- `GET/PUT /v1/me`, `GET/PUT /v1/me/preferences`, `POST /v1/onboarding` {languages,countries,regions,categories,qualityMode,deviceType}
- `GET /v1/channels?q=&country=&language=&category=&region=&status=&page=&limit=` → paginado, só `status != offline` por defeito
- `GET /v1/channels/:id`, `GET /v1/channels/:id/related`
- `POST/DELETE /v1/me/favorites/:channelId`, `GET /v1/me/favorites`
- `POST /v1/me/history` {channelId, durationSec, dataConsumedMB}, `GET /v1/me/history`
- `POST /v1/me/events` {channelId, type} → converte type em weight no backend
- `GET /v1/me/recommendations?limit=20` → usa tabela recommendations, se vazia calcula on-the-fly
- `GET /v1/me/usage/daily`, `GET /v1/me/usage/monthly`
- `GET /v1/admin/stats`, `GET /v1/admin/channels?status=`, `GET /v1/admin/users`
Regras: validação com class-validator, paginação cursor/limit-offset, erro padrão `{statusCode,message}`, auth Bearer JWT, RBAC `admin` para /admin.

## 5. Importador M3U (apps/worker/playlist-sync)
- Job diário BullMQ `playlist-sync`. Sources iniciais: `countries/mz.m3u`, `countries/ao.m3u`, `countries/pt.m3u`, `countries/br.m3u`, `languages/por.m3u`, `languages/eng.m3u`, `categories/news.m3u`, `categories/sports.m3u`, `categories/movies.m3u`, `categories/documentary.m3u`.
- Parser em `packages/m3u-parser`: parse `#EXTINF` → tvg-id, tvg-logo, group-title, + URL. Normalizar: trim nome, lowercase país/idioma/categoria, dedup por streamUrl.
- Upsert por streamUrl. Nunca apagar; marcar `status=offline` se sumir da origem há >7 dias.
- Pesos de evento: opened +1, watched_30s +2, watched_5min +5, watched_30min +10, favorite +20, returned +10, skipped -5.

## 6. Motor de recomendação (packages/recommendation-engine)
Fase 1 — scoring determinístico, sem ML:
```
score = pref(30) + lang(20) + region(15) + cat(15) + behavior(10) + quality(5) + popularity(5)
```
- pref: overlap categorias onboarding vs canal
- lang/region/cat: overlap direto
- behavior: soma weights últimos 30 dias normalizada 0-1
- quality: reliabilityScore/100
- popularity: log(watch count)
Job `recommendation:rebuild` noite + on-the-fly se tabela vazia. Guardar `reason` ex: "porque vês notícias em inglês".
Endpoint related: mesma categoria+idioma, ordenar por reliability.

## 7. Monitor de streams (apps/worker/stream-monitor + packages/stream-monitor)
- Fila BullMQ `stream-check`, concorrência 10, cada canal verificado 1x/hora (online) ou 1x/6h (offline).
- Check: HEAD/GET com timeout 10s → latencyMs; se HLS, `ffprobe -v error -show_entries stream=width,height,codec_name,bit_rate` → resolution, bitrate, codec.
- Classificar: online (<3s + probe ok), degraded (probe ok mas bitrate <800k ou latency >3s), offline (erro/timeout).
- Atualizar channels.status, reliabilityScore = 100 * online_checks_7d / total_checks_7d, inserir stream_checks.
- Expor no card: 🟢/🟡/🔴 via status.

## 8. Web App (apps/web)
Rotas: `/`, `/login`, `/register`, `/onboarding`, `/browse`, `/channel/[id]`, `/favorites`, `/history`, `/settings`, `/admin`.
- Player: hls.js, mostra resolução/bitrate medidos, seletor qualidade (auto/saver/max filtra lista), regista events + history + consumo estimado (bitrate*duration).
- Home personalizada: "Boa noite, {nome}" + carrosséis Para ti / Porque gostas de X / África (MZ/AO/ZA/CV) / Economia de dados (480p).
- Filtros: país, idioma, categoria, região, status. Pesquisa com debounce.

## 9. Planos
Middleware de entitlements: free (catálogo, ads, 20 favs, recs básicas), basic (sem ads, favs ilimitados, histórico, filtros avançados), premium (+multi-device, stats, sync, rec avançada). Não bloquear stream público por plano na fase MVP — diferenciar por features da plataforma.

## 10. Docker + Env
Serviços: postgres:16, redis:7, api (3001), worker, web (3000), nginx. Env: DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_REFRESH_SECRET.

## 11. Testes e segurança
- Vitest/Jest para m3u-parser + recommendation-engine (cobrir parse, dedup, scoring).
- e2e mínimo: register→onboarding→browse→favorite→recommendations.
- Segurança: argon2, rate-limit login, helmet, CORS restrito, validação strict, nunca logar password/token.

## 12. Roadmap por fases (não saltar)
Fase 1 MVP: auth+onboarding, importer, catálogo+player, favs+histórico, recs v1, monitor básico, admin básico.
Fase 2: EPG, usage/consumo, search avançado, PWA.
Fase 3: Android/Android TV, pagamentos MZN (M-Pesa/e-Mola), analytics.
Fase 4: ML.

## 13. Regras incrementais (obrigatórias)
1. Nunca remover funcionalidade a funcionar sem pedido explícito.
2. Trabalhar por fase, um módulo de cada vez, migrar Prisma sem perder dados.
3. Cada entrega tem de correr com `docker compose up` + `prisma migrate deploy`.
4. Não prometer resolução que o monitor não mediu.
5. Commits pequenos, mensagens claras.
