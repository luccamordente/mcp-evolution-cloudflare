# Deploy e configuração

## Estado publicado

- Worker: `mcp-evolution-cloudflare`
- URLs: `https://app.wapilot.com.br`, `https://mcp-evolution-cloudflare.luccamordente.workers.dev`
- Revisão publicada durante esta entrega: `37af8e4a-b506-4b8c-9d74-6e36ba276418`
- D1: `mcp-evolution` (`d25ad771-5b81-4e41-88ed-6f980a32dbf9`). O último estado remoto registrado nesta nota tinha as migrations `0001_init` e `0002_webhook_events`; as migrations `0003_connection_defaults` e `0004_remove_connection_runtime_state` fazem parte desta entrega, mas ainda exigem aplicação remota e read-back antes de declarar o schema de produção atualizado.
- KV OAuth: `3a5b420e14594ee4ae821b720a9bf74a`; preview `29bb2b67785b46bfa7c31d84bbbe9344`.

## Deploy automático

O Worker está conectado ao repositório GitHub `luccamordente/mcp-evolution-cloudflare` pelo Workers Builds. Pushes em `main` executam `npm ci` e `npx wrangler deploy`, com `auto_build_enabled` ativo e sem previews.

O push do commit `371901d` gerou o build `1b2e77e1-8469-498d-826e-da7655778a88`, encerrado com sucesso. O endpoint `/healthz` publicado respondeu `200` depois do build.

O `/healthz` publicado respondeu `protocol: 2026-07-28`, e `/mcp` respondeu `401` com `resource_metadata` RFC 9728. O read-back de 17 de outubro de 2026 confirmou que a aplicação Cloudflare Access de `/connections` também cobre `/admin`, reutilizando a audiência configurada para o dashboard, One-time PIN e os dois e-mails autorizados. `/admin` e `/admin/data` também exigem a allowlist operacional explícita de Lucca e Heitor no Worker; mantenha `ADMIN_EMAILS` ausente para usar essa dupla padrão ou configure apenas essa mesma dupla. O `/user/contacts` passa a repassar o parâmetro `search` diretamente ao Evolution Go além da normalização em memória.

O painel `/admin` é somente leitura e não substitui o provisionamento em `/connections?provision=1`. Uma consulta ao painel produz um snapshot único; a atualização é manual e não há polling. Valide `/admin` e `/admin/data` com sessões Access de Lucca e de Heitor, confirme que um usuário autenticado fora da allowlist recebe `403`, e confira que usuários sem conexões ou autorizações continuam presentes. Verifique também que uma falha individual do Evolution Go, do OAuth Provider ou da auditoria aparece como fonte indisponível sem apagar os demais dados; a conexão deve distinguir auditoria indisponível de ausência de atividade. A resposta não contém tokens, claims, payloads ou metadados de auditoria.

As rotas usadas pelo dashboard (`GET /connections/authorizations`, `DELETE /connections/authorizations/:id` e `POST /connections/authorizations/:id/revoke`) devem permanecer na mesma aplicação Access de `/connections`; assim, o `fetch` não redireciona para a aplicação `/api`. Os aliases (`GET /api/authorizations`, `DELETE /api/authorizations/:id` e `POST /api/authorizations/:id/revoke`) permanecem sob a aplicação Access separada de `/api` para clientes compatíveis. Valide a listagem com um usuário autenticado, confirme que grants expirados não são exibidos, que cursores retornam a próxima página e que a revogação de um grant é refletida após o read-back da lista. A política de consentimento aceita múltiplos grants; não declare os demais clientes desconectados ao revogar apenas um.

Para entrar na interface, abra `https://app.wapilot.com.br/connections` ou `https://app.wapilot.com.br/admin`, escolha a autenticação Cloudflare Access, informe `luccamordente@gmail.com` ou `heitorsalazar@gmail.com` e digite o One-time PIN enviado por e-mail. A sessão do navegador é independente do OAuth usado por clientes MCP; não use o token MCP no navegador.

## Segredos

Foram configurados `TOKEN_ENCRYPTION_KEY`, `CONSENT_SECRET`, `ACCESS_JWKS_URL`, `ACCESS_ISSUER`, `ACCESS_AUDIENCE` e `EVOLUTION_GLOBAL_API_KEY` como Workers Secrets. `EVOLUTION_BASE_URL` está configurado como `https://zipt-zopt.neurau.com.br`. Uma chamada controlada sem token de instância respondeu `401 not authorized`, confirmando que o endpoint está acessível sem declarar uma conexão autenticada como sucesso.

Para concluir a integração, configure:

```sh
npx wrangler secret put EVOLUTION_GLOBAL_API_KEY # somente se o deployment usar chave administrativa
npx wrangler d1 migrations apply mcp-evolution --remote
npx wrangler deploy
```

Cadastre cada instância em `/connections` ou `POST /api/connections` com nome amigável, ID da instância, número opcional e token específico. A resposta de criação entrega uma única URL de webhook; não reutilize nem registre o segredo. Configure no Evolution Go os eventos `MESSAGE`, `SEND_MESSAGE`, `HISTORY_SYNC` e `GROUP` para essa URL.

## Proxy de mídia e domínio `media.wapilot.com.br`

O proxy usa o mesmo Worker `mcp-evolution-cloudflare`. O `wrangler.jsonc` declara `app.wapilot.com.br` e `media.wapilot.com.br` como domínios customizados; o Worker reconhece o hostname de mídia antes do OAuth Provider e mantém a aplicação principal no hostname canônico. O MCP entrega URLs públicas no formato `/r/<arquivo>`; o proxy redireciona para o objeto em `storage.neurau.com.br` sem transferir os bytes pelo Worker.

Os dois domínios customizados são gerenciados pelo próprio Worker. Não deixe CNAMEs externos para `app.wapilot.com.br` ou `media.wapilot.com.br` antes do deploy: a API de Custom Domains rejeita hostnames que já tenham registros DNS externos. O deploy com `custom_domain: true` cria os registros gerenciados (read-only, normalmente `AAAA 100::`) e os certificados; confirme os dois hostnames em **Workers & Pages → mcp-evolution-cloudflare → Settings → Domains & Routes** e por uma leitura posterior da zona. A resposta de criação dos domínios não substitui essa confirmação.

Valide uma URL assinada com `GET` e `HEAD`. A resposta deve ser `302` e o `Location` deve apontar para `https://storage.neurau.com.br/attachment-storage-production/evolution-go-medias/<arquivo>`, mantendo os seis parâmetros `X-Amz-*` com a mesma codificação e removendo qualquer parâmetro adicional.

```sh
npx wrangler deploy --dry-run
curl -sS -D - -o /dev/null \
  'https://media.wapilot.com.br/r/example.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test%2Fcredential&X-Amz-Date=20261016T175902Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=test&utm_source=some_source'
```

## Verificação

```sh
curl -i https://app.wapilot.com.br/healthz
curl -i https://app.wapilot.com.br/mcp
curl -i https://app.wapilot.com.br/.well-known/oauth-protected-resource/mcp
```

O teste com um cliente real MCP e qualquer envio WhatsApp dependem da autenticação do cliente e de uma conexão Evolution Go real. Não execute envio real sem destinatário e conteúdo definidos.
