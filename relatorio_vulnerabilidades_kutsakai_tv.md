# Relatório de Segurança — Kutsakai TV
**Alvo:** https://tv.kutsakai.dpdns.org/ (+ API https://api.kutsakai.dpdns.org/v1)
**Data:** 05/10/2026 · **Tipo:** Teste externo não autenticado (black-box) · **Autorização:** projeto do próprio usuário

---

## Arquitetura identificada
- Frontend: Next.js (React) atrás da Cloudflare — `tv.kutsakai.dpdns.org`
- API: Express (NestJS-like, respostas `statusCode/message`) hospedada na Render — `api.kutsakai.dpdns.org/v1`
- Autenticação: JWT access token (HS256, 15 min) em `localStorage` + refresh token (30 dias) em cookie `HttpOnly; Secure; SameSite=None`
- TLS válido (Google Trust Services / Cloudflare), WAF Cloudflare ativo (bloqueou payload de SQLi no teste)

---

## Achados

### 1. Senha fraca aceita no registro — ALTA
**Evidência (confirmada):** `POST /v1/auth/register` aceitou senha `"1"` (1 caractere) e `"123456"`, retornando 200 + token.
**Impacto:** contas triviais de adivinhar; combinado com o achado 2 (sem rate limit), brute-force em contas existentes é viável.
**Correção:** exigir mínimo de 10-12 caracteres (ou verificador de senhas vazadas, ex. zxcvbn/HIBP); rejeitar senhas comuns no cadastro e na troca de senha.

### 2. Ausência de rate limiting / proteção contra brute-force no login — ALTA
**Evidência (confirmada):** 25 tentativas rápidas de `POST /v1/auth/login` com senha errada — todas `401`, sem 429/423, sem captcha, sem atraso.
**Impacto:** credential stuffing e brute-force ilimitados.
**Correção:** rate limit por IP+conta (ex. 5 tentativas/15 min), lockout progressivo ou captcha; considerar Fail2Ban/Cloudflare Rate Limiting na rota `/auth/*`.

### 3. Enumeração de e-mails registrados — MÉDIA
**Evidência (confirmada):** `POST /v1/auth/register` com e-mail existente retorna `409 {"message":"email in use"}`; e-mail inexistente retorna 200.
**Impacto:** atacante mapeia quais e-mails têm conta (alvo de phishing/credential stuffing).
**Correção:** responder sempre 200 genérico ("verifique seu e-mail") e enviar e-mail informando o dono da conta sobre a tentativa de cadastro duplicado.

### 4. Token de acesso em localStorage — MÉDIA
**Evidência (confirmada no bundle):** chave `access` lida/gravada em `localStorage` (`localStorage.getItem("access")`).
**Impacto:** qualquer XSS (mesmo em dependência comprometida) exfiltra o token de 15 min; sem HttpOnly não há proteção do browser. Sem CSP atualmente (achado 5), a barreira extra não existe.
**Correção:** manter refresh em cookie HttpOnly (já feito) e mover o access token para cookie `HttpOnly` + `SameSite=Strict` de escopo restrito, ou memória com renovação silenciosa; adicionar CSP.

### 5. Cabeçalhos de segurança ausentes — MÉDIA
**Evidência (confirmada):** respostas de `tv.kutsakai.dpdns.org` sem `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Permissions-Policy` (nem na API o HSTS).
**Impacto:** sem CSP, XSS tem impacto amplificado; sem XFO/`frame-ancestors`, clickjacking possível; sem HSTS, downgrade SSL é viável no primeiro acesso.
**Correção:** 
- HSTS: `Strict-Transport-Security: max-age=31536000; includeSubDomains` (habilitar também no Cloudflare)
- CSP: `default-src 'self'; frame-ancestors 'none'; object-src 'none';` + relaxar conforme necessário
- `X-Frame-Options: DENY` e `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### 6. Refresh cookie com `SameSite=None` e vida de 30 dias — BAIXA
**Evidência (confirmada):** `Set-Cookie: refresh_token=...; Max-Age=2592000; HttpOnly; Secure; SameSite=None`.
**Impacto:** o cookie é enviado em qualquer contexto cross-site; a proteção atual depende só do CORS. Um POST simples cross-site não lê a resposta, mas dispara efeitos (rotação de token). Se um subdomínio irmão for comprometido, o CORS deixa de proteger.
**Correção:** avaliar `SameSite=Lax` (se tv/api forem mesmo site, o fetch com `credentials: include` ainda funciona para same-site) ou token CSRF no refresh.

### 7. Vazamento de informação / configuração — BAIXA
**Evidências (confirmadas):**
- `og:image` e `twitter:image` apontam para `http://localhost:3000/assets/hero-bg.jpg` (config interna de dev vazada no HTML público; previews em redes sociais ficam quebrados)
- `x-powered-by: Express`, `x-render-origin-server: Render` (aumenta precisão de ataques direcionados)
- Páginas 404 da API expõem rotas ("Cannot GET /v1/admin/backup/snapshot")
- `Access-Control-Allow-Origin: *` no host do frontend (baixo risco — é host de assets)
**Correção:** usar URL absoluta de produção para og:image (`NEXT_PUBLIC_SITE_URL`); remover `x-powered-by` (`app.disable('x-powered-by')`); padronizar 404 JSON.

---

## Controles bem implementados (verificados)
- ✔ Endpoints `/admin/*` exigem papel admin no servidor (`403 admin only` com token comum) — não é gate só no cliente
- ✔ `alg: none` no JWT rejeitado
- ✔ Refresh token não é aceito como access token (separação de tipo correta)
- ✔ Logout revoga o refresh token no servidor (`"revoked"` no reuso)
- ✔ CORS da API restrito à origem legítima (não reflete origens arbitrárias nem `null`)
- ✔ Cookie de refresh `HttpOnly; Secure`
- ✔ WAF Cloudflare bloqueou payload de SQLi; parâmetros `page`/`limit`/`search` tratam entradas malformadas sem vazar erro
- ✔ Sem sourcemaps públicos, sem `.env`/`.git`/backups expostos, certificado TLS válido

## Não testado / limitações
- Portas além de 80/443: origem oculta pela Cloudflare — não escaneada
- Lógica de pagamentos/admin autenticado: exigiria conta admin (não disponível)
- Contas de teste criadas durante o teste (remova se quiser): `sec.teste.kutsakai@example.com` (senha "1", sessão encerrada) e `sec.teste2.kutsakai@example.com` (senha "123456")

## Prioridade de correção
1. Política de senha mínima + rate limiting no login (achados 1 e 2 — combinados, críticos)
2. Mensagem genérica no registro duplicado (achado 3)
3. HSTS + CSP + X-Frame-Options (achado 5)
4. Access token fora do localStorage (achado 4)
5. Higiene: og:image, x-powered-by, 404 (achado 7)
