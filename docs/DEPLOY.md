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

As rotas de autorizações (`GET /api/authorizations`, `DELETE /api/authorizations/:id` e `POST /api/authorizations/:id/revoke`) devem permanecer na mesma aplicação Access de `/connections`. Valide a listagem com um usuário autenticado, confirme que grants expirados não são exibidos, que cursores retornam a próxima página e que a revogação de um grant é refletida após o read-back da lista. A política de consentimento aceita múltiplos grants; não declare os demais clientes desconectados ao revogar apenas um.

Para entrar na interface, abra `https://app.wapilot.com.br/connections`, escolha a autenticação Cloudflare Access, informe `luccamordente@gmail.com` ou `heitorsalazar@gmail.com` e digite o One-time PIN enviado por e-mail. A sessão do navegador é independente do OAuth usado por clientes MCP; não use o token MCP no navegador.

## Segredos

Foram configurados `TOKEN_ENCRYPTION_KEY`, `CONSENT_SECRET`, `ACCESS_JWKS_URL`, `ACCESS_ISSUER`, `ACCESS_AUDIENCE` e `EVOLUTION_GLOBAL_API_KEY` como Workers Secrets. `EVOLUTION_BASE_URL` está configurado como `https://zipt-zopt.neurau.com.br`. Uma chamada controlada sem token de instância respondeu `401 not authorized`, confirmando que o endpoint está acessível sem declarar uma conexão autenticada como sucesso.

Para concluir a integração, configure:

```sh
npx wrangler secret put EVOLUTION_GLOBAL_API_KEY # somente se o deployment usar chave administrativa
npx wrangler d1 migrations apply mcp-evolution --remote
npx wrangler deploy
```

Cadastre cada instância em `/connections` ou `POST /api/connections` com nome amigável, ID da instância, número opcional e token específico. A resposta de criação entrega uma única URL de webhook; não reutilize nem registre o segredo. Configure no Evolution Go os eventos `MESSAGE`, `SEND_MESSAGE`, `HISTORY_SYNC` e `GROUP` para essa URL.

## Proxy de mídia e domínio `storage.wapilot.com.br`

O proxy usa o mesmo Worker `mcp-evolution-cloudflare`. O arquivo `wrangler.jsonc` declara o domínio customizado; o domínio cobre todos os caminhos (`storage.wapilot.com.br/*`) e não cria um segundo Worker.

1. No Cloudflare Dashboard, abra **DNS** da zona `wapilot.com.br` e crie o registro `CNAME` `storage` apontando para `mcp-evolution-cloudflare.luccamordente.workers.dev`. Deixe o proxy laranja ativado.
2. Em **Workers & Pages → mcp-evolution-cloudflare → Settings → Domains & Routes**, adicione `storage.wapilot.com.br` como domínio customizado. A configuração deve ficar equivalente a `{ "pattern": "storage.wapilot.com.br", "custom_domain": true }`.
3. Se houver um coletor de métricas, configure a variável não secreta `MEDIA_TRACKING_ENDPOINT` com a URL HTTPS desse coletor. O Worker envia `source` e `path` por `POST`, sem repassar query assinada. Sem essa variável, o redirect continua funcionando e nenhum evento externo é enviado.
4. Valide o comportamento com uma URL assinada de teste. A resposta deve ser `302`; o `Location` deve apontar para `https://neurau.com.br`, manter a sequência completa de `X-Amz-*` e remover somente `utm_*`. O MCP nunca retorna o hostname bruto: ele entrega a URL pública `storage.wapilot.com.br` com `utm_source=chatgpt`.

```sh
npx wrangler deploy --dry-run
curl -sS -D - -o /dev/null \
  'https://storage.wapilot.com.br/attachment-storage-production/evolution-go-medias/example.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=test&utm_source=chatgpt'
```

O `302` é intencional: o Worker não faz `fetch` do objeto e não duplica o tráfego de bytes. A origem de armazenamento aparece apenas no `Location` usado pelo cliente para seguir o redirect; ela não é emitida nos payloads MCP.

## Verificação

```sh
curl -i https://app.wapilot.com.br/healthz
curl -i https://app.wapilot.com.br/mcp
curl -i https://app.wapilot.com.br/.well-known/oauth-protected-resource/mcp
```

O teste com um cliente real MCP e qualquer envio WhatsApp dependem da autenticação do cliente e de uma conexão Evolution Go real. Não execute envio real sem destinatário e conteúdo definidos.
