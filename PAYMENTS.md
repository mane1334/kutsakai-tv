# Pagamentos — Kutsakai TV

## Modelo atual: aprovação manual via WhatsApp + admin
1. Cliente escolhe plano e método (M-Pesa / e-Mola) em `/plans`.
2. A API cria o pagamento `PENDING` com instruções: número comercial + referência.
3. Cliente paga no telemóvel e toca no botão WhatsApp (link `wa.me` com texto
   pré-preenchido: plano, valor, referência).
4. Admin vê os pendentes em `/admin` (secção Pagamentos) e aprova/rejeita:
   `POST /v1/admin/payments/:id/approve` → `completePayment()` → subscrição ACTIVE.
   `POST /v1/admin/payments/:id/reject` → pagamento FAILED.
5. Só o backend ativa. O frontend mostra "Pagamento pendente" até lá.

## Configuração (sem isto, o fluxo mostra avisos em vez de números)
```powershell
$env:WHATSAPP_NUMBER="258841234567"      # admin que recebe comprovativos
$env:MPESA_MERCHANT_MSISDN="841234567"   # número comercial M-Pesa
$env:EMOLA_MERCHANT_MSISDN="861234567"   # número comercial e-Mola
```
`GET /v1/payment-methods` expõe ao frontend: id, label, kind (manual/auto/test),
número comercial e WhatsApp — nada hardcoded no cliente.
`apps/api/src/payments.ts` define a interface `PaymentProvider`:
`createPayment()`, `getPaymentStatus()`, `verifyWebhook()`. O registo `providers`
mapeia `mock | mpesa | emola`. O frontend nunca ativa subscrições — só o backend,
em `completePayment()`, após confirmação do gateway (webhook ou poll).

## Mock (local, sem dinheiro real)
- `POST /v1/payments` com `"provider": "mock"` cria pagamento `PENDING`.
- O mock aprova sozinho ao fim de ~25s (o `GET /v1/payments/:id` faz poll ao provider).
- Para testes imediatos: `POST /v1/payments/:id/mock-confirm` (requer login).
- Webhook mock: `POST /v1/webhooks/mock` com `{ "providerTransactionId": "MOCK-..." }`.

## M-Pesa (Vodacom Moçambique) — onde pôr as credenciais
1. Obter no portal developer Vodacom: `API Key`, `Public Key`, `Service Provider Code`, URL base (`sandbox` vs `production`).
2. Definir no ambiente da API:
```powershell
$env:MPESA_API_KEY="..."
$env:MPESA_PUBLIC_KEY="..."
$env:MPESA_SERVICE_CODE="..."
$env:MPESA_BASE_URL="https://sandbox.vm.co.mz/..."  # trocar para produção quando for a sério
$env:MPESA_WEBHOOK_SECRET="segredo-partilhado"
```
3. Implementar em `mpesaProvider.createPayment()` a chamada C2B (customer → business,
   com `input_TransactionReference` = `reference` que já geramos) e em
   `getPaymentStatus()` a consulta de transação. O webhook público é
   `POST https://<tua-api>/v1/webhooks/mpesa` com header `X-Signature`
   = HMAC do corpo com `MPESA_WEBHOOK_SECRET` (ajustar em `verifyWebhook()` ao
   formato real da Vodacom).

## e-Mola (Movitel) — idem
```powershell
$env:EMOLA_API_KEY="..."
$env:EMOLA_MERCHANT_ID="..."
$env:EMOLA_BASE_URL="https://sandbox.emola.co.mz/..."
$env:EMOLA_WEBHOOK_SECRET="segredo-partilhado"
```
Webhook: `POST https://<tua-api>/v1/webhooks/emola`. Implementar em `emolaProvider`.

## Verificação profunda (corrige "offline" que funciona)
- `npm --workspace apps/worker run verify` — percorre offline primeiro e prova o
  1º segmento de cada stream (HLS incluído); atualiza status + fiabilidade.
- No admin, botão **Verificar** por canal: `POST /v1/admin/channels/:id/verify`.
- O monitor antigo só fazia GET à playlist (marcava lento como offline); o
  verificador só declara offline se nem a playlist nem o segmento responderem.

## Pacotes (planos ↔ canais)
- `plan_channels`: que canais cada plano pago cobre. Gerir em `/admin` (Pacotes)
  ou API `GET/POST /v1/admin/plans/:id/channels`, `DELETE .../:channelId`.
- Canal PREMIUM sem atribuição: qualquer sub paga autoriza. Com atribuição:
  só sub de um desses planos (`plan_required` senão).

## Fluxo garantido
`PENDING → (webhook | poll COMPLETED) → completePayment() → subscription ACTIVE`.
Sem confirmação do backend, a subscrição nunca ativa — mesmo que o frontend diga "success".

## Preços de teste (ENV, alteráveis sem código)
`PLAN_DAILY_PRICE` (def. 15), `PLAN_WEEKLY_PRICE` (def. 105),
`PLAN_MONTHLY_PRICE` (def. 450), moeda `MZN`. O admin muda depois via
`PUT /v1/admin/plans/:id` sem restart.
