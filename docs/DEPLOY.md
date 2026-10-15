# Deploy e configuração

## Estado publicado

- Worker: `mcp-evolution-cloudflare`
- URLs: `https://app.wapilot.com.br`, `https://mcp-evolution-cloudflare.luccamordente.workers.dev`
- Revisão publicada durante esta entrega: `37af8e4a-b506-4b8c-9d74-6e36ba276418`
- D1: `mcp-evolution` (`d25ad771-5b81-4e41-88ed-6f980a32dbf9`), migrations `0001_init` e `0002_webhook_events` aplicadas remotamente.
- KV OAuth: `3a5b420e14594ee4ae821b720a9bf74a`; preview `29bb2b67785b46bfa7c31d84bbbe9344`.

## Deploy automático

O Worker está conectado ao repositório GitHub `luccamordente/mcp-evolution-cloudflare` pelo Workers Builds. Pushes em `main` executam `npm ci` e `npx wrangler deploy`, com `auto_build_enabled` ativo e sem previews.

O push do commit `371901d` gerou o build `1b2e77e1-8469-498d-826e-da7655778a88`, encerrado com sucesso. O endpoint `/healthz` publicado respondeu `200` depois do build.

O `/healthz` publicado respondeu `protocol: 2026-07-28`, e `/mcp` respondeu `401` com `resource_metadata` RFC 9728. A configuração de Access existente protege `/authorize`, `/connections` e `/api` por One-time PIN para os dois e-mails autorizados. O `/user/contacts` passa a repassar o parâmetro `search` diretamente ao Evolution Go além da normalização em memória.

## Segredos

Foram configurados `TOKEN_ENCRYPTION_KEY`, `CONSENT_SECRET`, `ACCESS_JWKS_URL`, `ACCESS_ISSUER`, `ACCESS_AUDIENCE` e `EVOLUTION_GLOBAL_API_KEY` como Workers Secrets. `EVOLUTION_BASE_URL` está configurado como `https://zipt-zopt.neurau.com.br`. Uma chamada controlada sem token de instância respondeu `401 not authorized`, confirmando que o endpoint está acessível sem declarar uma conexão autenticada como sucesso.

Para concluir a integração, configure:

```sh
npx wrangler secret put EVOLUTION_GLOBAL_API_KEY # somente se o deployment usar chave administrativa
npx wrangler d1 migrations apply mcp-evolution --remote
npx wrangler deploy
```

Cadastre cada instância em `/connections` ou `POST /api/connections` com nome amigável, ID da instância, número opcional e token específico. A resposta de criação entrega uma única URL de webhook; não reutilize nem registre o segredo. Configure no Evolution Go os eventos `MESSAGE`, `SEND_MESSAGE`, `HISTORY_SYNC` e `GROUP` para essa URL.

## Verificação

```sh
curl -i https://mcp-evolution-cloudflare.luccamordente.workers.dev/healthz
curl -i https://mcp-evolution-cloudflare.luccamordente.workers.dev/mcp
curl -i https://mcp-evolution-cloudflare.luccamordente.workers.dev/.well-known/oauth-protected-resource/mcp
```

O teste com um cliente real MCP e qualquer envio WhatsApp dependem da autenticação do cliente e de uma conexão Evolution Go real. Não execute envio real sem destinatário e conteúdo definidos.
