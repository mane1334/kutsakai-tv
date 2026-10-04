# IPTV Discovery Platform — MVP local (sem Docker)

Funciona neste workspace Windows só com Node 24. Postgres/Redis/Docker ficam para prod (ver `docker-compose.yml` + `prisma/schema.prisma`).

## O que já funciona
- `apps/api` (Express + node:sqlite + bcryptjs + JWT): register, login, refresh, me, onboarding, channels com filtros, related, favorites, history, events, recommendations com reason, usage, admin/stats
- `apps/worker`: `sync` importa 10 listas iptv-org reais (~5000 canais únicos), `monitor` classifica online/degraded/offline + reliability
- `apps/web` (Next.js + hls.js): pesquisa + player + 🟢🟡🔴
- `packages/m3u-parser`, `packages/recommendation-engine` com scoring pref30/lang20/region15/cat15/behavior10/quality5/pop5

## Correr
```powershell
cp .env.example .env
npm --workspace apps/worker run sync
npm --workspace apps/api run start      # http://localhost:3001/v1/channels?limit=3
$env:MONITOR_LIMIT=50; npm --workspace apps/worker run monitor
npm --workspace apps/web run dev        # http://localhost:3000
```

## Teste rápido
```powershell
$b = @{name='Manuel'; email='manuel@test.mz'; password='Teste123!'} | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri http://localhost:3001/v1/auth/register -Body $b -ContentType 'application/json'
$h = @{Authorization="Bearer $($r.accessToken)"}
Invoke-RestMethod 'http://localhost:3001/v1/me/recommendations?limit=5' -Headers $h | ConvertTo-Json -Depth 4
```

## Próximo
- EPG (iptv-org/epg), paginação cursor, refresh rotativo em cookie httpOnly, admin UI, PWA, M-Pesa/e-Mola.
- Prod: `docker compose up`, `prisma migrate deploy`.
