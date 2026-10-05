# Relatório de Segurança v2 (reteste) — Kutsakai TV
**Alvo:** https://tv.kutsakai.dpdns.org/ + API https://api.kutsakai.dpdns.org/v1
**Data:** 05/10/2026 · Reteste após correções do relatório v1 + novos testes (mass assignment, IDOR, rotação de refresh, novos endpoints)

---

## ✅ Corrigido desde a v1 (verificado)

| # | Achado v1 | Status |
|---|-----------|--------|
| 1 | Senha fraca aceita ("1", "123456") | **CORRIGIDO** — agora `400 password too short (min 8 characters)` + bloqueio de senhas comuns (`400 password too common, choose another` para "12345678" e "password") |
| 5 | Headers ausentes | **CORRIGIDO** — `Strict-Transport-Security: max-age=31536000; includeSubDomains` (frontend e API), `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`, `x-content-type-options`, CSP na API (`default-src 'none'; frame-ancestors 'none'`) |
| 3 | Enumeração de e-mails (409 vs 200) | **PARCIAL** — status agora é 200 nos dois casos, mas o corpo ainda diferencia: `{"ok":true,"alreadyExists":true,"message":"email already registered — sign in instead"}` vs retorno com accessToken |
| 7 | `og:image` apontando para `http://localhost:3000` | **CORRIGIDO** — não aparece mais |
| 7 | 404 HTML expondo rotas ("Cannot GET /v1/...") | **CORRIGIDO** — 404 JSON padronizado `{"statusCode":404,"message":"not found"}` |
| — | Rotação de refresh token | **NOVO CONTROLE FUNCIONANDO** — refresh emite cookie novo; reuso do cookie antigo → `401 {"message":"revoked"}`; cookie novo continua válido (implementação correta de rotação + detecção de reuso) |

## 🔴 Ainda em aberto

### 1. Sem rate limiting no login — ALTA (mantém-se o principal risco)
**Evidência:** 10-12 tentativas seguidas de `POST /v1/auth/login` com senha errada, todas `401` — sem 429, captcha, lockout ou atraso.
**Impacto:** brute-force e credential stuffing ilimitados. Com a política de senha melhorada o risco caiu, mas continua explorável.
**Correção:** rate limit por IP+conta (ex. 5/15min via Cloudflare Rate Limiting ou `express-rate-limit` + `rate-limit-redis`), lockout progressivo, ou proteção da Cloudflare na rota `/auth/*`.

### 2. Access token em localStorage — MÉDIA (mantém)
**Evidência:** bundle novo do login ainda contém `localStorage.setItem("access", ...)`.
**Correção:** mover para cookie HttpOnly de escopo restrito ou memória com refresh silencioso.

### 3. Enumeração de e-mails via corpo da resposta — BAIXA (rebaixada de MÉDIA)
**Evidência:** corpo ainda diz `alreadyExists:true` / "email already registered". Status já não diferencia.
**Correção:** mensagem idêntica em ambos os casos (ex. "se o e-mail estiver disponível, enviamos instruções").

### 4. CSP do frontend em modo report-only e permissivo — BAIXA
**Evidência:** `content-security-policy-report-only` com `script-src 'self' 'unsafe-inline' 'unsafe-eval' https:`.
**Correção:** revisar violações no report e promover para `Content-Security-Policy` (enforcement), reduzindo `unsafe-inline/eval` e o wildcard `https:`.

### 5. Higiene residual — INFO
- `x-powered-by: Express` e `x-render-origin-server: Render` ainda expostos na API.
- Cookie de refresh continua `SameSite=None; Max-Age=2592000` (30 dias) — proteção hoje depende só do CORS (que está correto).

## ✔ Novos testes desta rodada — sem vulnerabilidade explorável

- **Mass assignment no registro** (`role":"admin"`, `isAdmin`, `is_admin`): campos ignorados; token resultante continua `403 admin only` em `/admin/users`.
- **IDOR em favoritos** (`DELETE /v1/me/favorites/:channelId` com token de outro usuário): retorna 200 mas **não apaga** o favorito do dono (operação escopada por usuário, idempotente). Favorito da conta A sobreviveu intacto.
- **`/me/*` sem auth**: 401 em favorites/history/subscription/recommendations. Obs.: `/me/events` responde 404 sem auth (outros respondem 401) — provável rota inexistente no servidor chamada pelo cliente; verificar.
- **`/payments` sem auth**: 404 JSON (não revela existência).
- **`/epg/guide?ids=lixo`**: retorna `[]` — entrada malformada tratada sem erro.
- **`/plans`, `/meta/filters`**: públicos por design, sem dados sensíveis.
- **JWT**: TTL de 15 min mantido; claims mínimos (sub/iat/exp), papel validado server-side.
- **`alg:none`** e uso do refresh como access: seguem rejeitados (v1).

## ⚠ Observação de disponibilidade
Durante o reteste a API apresentou **502 (Render "Bad Gateway") e timeouts intermitentes** por alguns minutos. Não é vulnerabilidade, mas: (a) pode indicar free tier/redeploy; (b) o rodapé do site exibia "ALL SYSTEMS OPERATIONAL" nesse período — considere um healthcheck real (ex. `/api/health`) alimentando esse indicador.

## Contas de teste criadas (para remover)
- `retest.kutsakai3@example.com` (senha `Teste9999!`)
- `retest.massadmin@example.com` (senha `SenhaForte99!`)
- `retest.naexiste@example.com` (senha `OutraSenha123!`)

## Prioridade atualizada
1. **Rate limiting no login** (único achado ALTA restante)
2. Corpo da resposta do registro (finalizar anti-enumeração)
3. Access token fora do localStorage
4. Promover CSP para enforcement
5. Higiene: x-powered-by, SameSite, healthcheck real

## Não testado / limitações
- Área admin autenticada e pagamentos (requer conta admin — fora do escopo ético de burlar)
- Origem real atrás da Cloudflare (não escaneada)
- Disponibilidade intermitente da API reduziu a janela de alguns testes (repetidos com sucesso após estabilizar)
