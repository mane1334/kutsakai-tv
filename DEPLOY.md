# DEPLOY — Kutsakai TV em free tier com sub-domínio

Objetivo final:

- Site empresa (não mexer): `https://kutsakai.dpdns.org`
- App (Cloudflare Pages, free, sem sleep): `https://tv.kutsakai.dpdns.org`
- API (Render free, dorme sem tráfego): `https://api.kutsakai.dpdns.org`

> Onde criar os sub-domínios: no painel onde registaste o `dpdns.org`
> (normalmente afraid.org → Subdomains). São 2 registos CNAME (ver passo 4).

---

## 0. Limites honestos do free (lê antes)

1. **Render Free dorme** após ~15 min sem request. O 1º acesso acorda em ~30-60s.
   Mitigação incluída: `.github/workflows/keep-alive.yml` faz ping de 10 em 10 min
   (cobre as 750h/mês do free para 1 serviço ficar sempre acordado).
2. **Render Free NÃO tem disco.** O `data.db` (SQLite) vive em `/tmp` e **apaga
   a cada restart/redeploy** — users, favoritos, canais importados desaparecem.
   Para demo/teste com link personalizado chega. Para produção real tens 2 caminhos:
   - **Fase 2a (recomendada):** migrar DB para Turso (SQLite remoto free) ou
     Neon/Supabase (Postgres free). Obriga a passar o `db.prepare` sync para
     async — é refactor, deixo para quando validares o fluxo.
   - **Fase 2b:** VPS sempre-on (Oracle Always Free / Fly.io com volume) e
     `SQLITE_PATH=/data/data.db`. Zero mudança de código.
3. O `worker sync` (importar ~5000 canais) **não corre sozinho no Render Free**.
   Após o deploy fazes 1 seed manual (passo 3.5). Depois os canais ficam em
   memória/disco efémero até ao próximo restart — normal no free.

---

## 1. Subir para GitHub

```powershell
cd C:\Users\maneb\Desktop\Kutsakai\Projetos\IPTV
git init
git add .
git commit -m "kutsakai tv: deploy-ready (render+pages)"
gh repo create kutsakai-tv --private --source=. --push
# sem gh CLI: cria repo vazio no github.com e faz:
# git remote add origin https://github.com/TEUUSER/kutsakai-tv.git
# git branch -M main
# git push -u origin main
```

Confere que `apps/api/data.db` (32MB) **não** foi para o repo (está no `.gitignore`).

---

## 2. API no Render (free)

1. Vai a **dashboard.render.com → New → Blueprint** → escolhe o repo `kutsakai-tv`.
   O `render.yaml` já define tudo (Docker, `/health`, envs).
   Alternativa sem Blueprint: **New → Web Service → Docker**, root `./`,
   Dockerfile path `./apps/api/Dockerfile`.
2. Nas **Environment Variables** confirma/ajusta:
   - `ALLOWED_ORIGINS=https://tv.kutsakai.dpdns.org,https://kutsakai-tv.pages.dev`
     (acrescenta o URL `*.pages.dev` que a Cloudflare te der)
   - `JWT_SECRET` e `JWT_REFRESH_SECRET` → Generate (o Blueprint já gera)
   - `WHATSAPP_NUMBER`, `MPESA_MERCHANT_MSISDN`, `EMOLA_MERCHANT_MSISDN`
3. Deploy. No fim ficas com `https://kutsakai-api.onrender.com`.
   Testa: `https://kutsakai-api.onrender.com/health` → `{"ok":true}`.
4. **Domínio personalizado:** Settings → Custom Domains → Add
   `api.kutsakai.dpdns.org` → o Render dá-te um CNAME para colar no afraid.org.
5. **Seed inicial (1x):** no Render → Shell:
   ```sh
   npm --workspace apps/worker run sync
   ```
   (Se o Shell free não permitir, faz o seed local e aceita catálogo vazio
   até à fase 2 — a API funciona na mesma, só sem canais.)

---

## 3. WEB na Cloudflare Pages (free, sem sleep)

A pasta `apps/web` já tem `next.config.static.mjs` (`output: export`) pronta
para estático. Não uses o `next.config.mjs` de dev.

1. **dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git**
   → repo `kutsakai-tv`.
2. Build settings:
   - Root directory: `apps/web`
   - Build command: `cp next.config.static.mjs next.config.mjs && npm ci --prefix ../.. && npm run build --workspace apps/web`
     *(simplificação: se der erro de workspaces, alternativa: build local
     `npm --workspace apps/web run build` com o static config e faz upload
     da pasta `out/` via **Direct Upload**)*
   - Output directory: `out`
   - Env var (Production): `NEXT_PUBLIC_API_URL=https://api.kutsakai.dpdns.org/v1`
3. Deploy → ficas com `https://kutsakai-tv.pages.dev`. Abre e confirma que
   carrega (o login vai falhar até a API permitir o CORS — passo seguinte).
4. **Domínio personalizado:** Pages → Custom domains → Add
   `tv.kutsakai.dpdns.org` → a Cloudflare dá-te o CNAME para colar no afraid.org.
5. Volta ao Render e garante que `ALLOWED_ORIGINS` contém exatamente os 2 URLs
   (o pages.dev + o tv.*), sem `/` no fim. Redeploy da API se mudaste.

---

## 4. DNS no dpdns.org (afraid.org)

No painel do teu domínio adiciona:

| Host | Tipo  | Valor (o que cada plataforma te deu) |
| ---- | ----- | ------------------------------------- |
| `tv` | CNAME | `kutsakai-tv.pages.dev` (ou o `*.pages.dev` real) |
| `api`| CNAME | `kutsakai-api.onrender.com` (ou o `*.onrender.com` real) |

Propagação: 5 min – 2h. Testa com `nslookup tv.kutsakai.dpdns.org`.
O root `kutsakai.dpdns.org` não é tocado.

Se o dpdns não aceitar sub-domínios (conta free limitada), usa os URLs
`*.pages.dev` / `*.onrender.com` como oficiais e mete redirect no painel.

---

## 5. Anti-sleep (keep-alive)

1. No repo GitHub → Settings → Secrets → Actions → New:
   `API_URL = https://api.kutsakai.dpdns.org/health`
2. O ficheiro `.github/workflows/keep-alive.yml` já faz ping de 10/10 min.
   Podes correr manual: Actions → keep-alive → Run workflow.
3. Extra (recomendado): cria conta free no **UptimeRobot** com 2 monitors
   (5 min) para `/health` da API e `/` do front — é o que a maioria usa
   porque corre fora do GitHub.

Primeiro acesso do dia continua a poder demorar ~50s se ambos os pings
falharem — normal no free.

---

## 6. Checklist final

- [ ] `https://api.kutsakai.dpdns.org/health` → `{"ok":true}`
- [ ] `https://tv.kutsakai.dpdns.org` abre sem erro de CORS
- [ ] Registo + login funcionam (cria 1 user de teste)
- [ ] `ALLOWED_ORIGINS` no Render tem os 2 domínios finais
- [ ] `NEXT_PUBLIC_API_URL` no Pages aponta para `https://api.kutsakai.dpdns.org/v1`
- [ ] Keep-alive ativo (Actions verde + UptimeRobot)
- [ ] **R2 configurado**: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` no Render → log mostra `[r2] snapshots a cada 15min`; força 1 snapshot em `/admin` (botão abaixo) e confirma `[r2] snapshot …MB guardado` nos logs

## 6b. Persistência no Render Free (SQLite + R2 — obrigatório)

O disco do Render Free apaga a cada restart. Em vez de reescrever tudo para
Turso/Neon, a API faz **snapshot do ficheiro `.db` para o Cloudflare R2**
(free: 10GB, sem custo de saída):

1. Cloudflare dashboard → **R2** → **Create bucket** (ex. `kutsakai-tv`).
2. R2 → **Manage R2 API tokens** → Create token com **Object Read & Write**
   aplicado **só a esse bucket**. Guarda: Account ID, Access Key, Secret.
3. No Render (serviço da API → Environment): adiciona as 4 envs
   (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`)
   + opcional `BACKUP_INTERVAL_MIN=15`. Faz **Manual Deploy**.
4. Comportamento: no arranque, se o disco estiver vazio, repõe o snapshot
   (`[db] snapshot reposto`); a cada 15 min + no shutdown faz upload;
   no `/admin` há botão **"Snapshot agora (R2)"** para forçar.
5. Sem as envs, a API avisa no log (`[db] R2_* sem configurar`) e funciona
   como antes (efémero) — nada parte em dev local.

## 7. Quando sair do free

- Persistência: Turso (`libsql://…`) ou Neon (`postgres://…`) + passar
  `apps/api/src/*.ts` e `apps/worker/src/*.ts` de `DatabaseSync` sync para
  cliente async. É o único refactor grande — tudo o resto (rotas, auth,
  payments manuais M-Pesa/e-Mola) fica igual.
- API sempre-on + disco: Fly.io (`fly volumes create data --size 3`) com
  `SQLITE_PATH=/data/data.db`, ou Oracle Always Free com este mesmo Dockerfile.
