# Desenvolvimento

Instale Node 20+ e rode `npm install`, `npm run check` e `npx wrangler deploy --dry-run`. O entrypoint de produção é `src/worker.ts`; `src/index.ts` exporta o fallback Hono usado por testes e pelas rotas de UI/webhook.

## Desenvolvimento local

Para abrir o Worker e a UI no navegador, rode:

```sh
npm install
npm run dev:local
```

Esse comando cria `.dev.vars` a partir de `.dev.vars.example` se necessário, aplica as migrations ao D1 local e inicia o Wrangler em `http://localhost:8787`. O D1 e o KV ficam persistidos em `.wrangler/local-dev`, portanto os dados de desenvolvimento sobrevivem à reinicialização. Para recomeçar com uma base vazia, pare o Worker e remova essa pasta.

No perfil `local`, `/connections` usa deliberadamente a identidade sintética `dev@example.test`; essa exceção só existe quando `ENVIRONMENT=local` e não altera a autenticação de produção. O perfil também usa `http://127.0.0.1:8789` como Evolution Go; o provisionamento e as chamadas reais só funcionam quando um mock local ou uma instância de desenvolvimento compatível estiver rodando nesse endereço. Para usar a UI visual sem backend, `npm run prototype:connections` continua disponível em `http://localhost:4173`.

O MCP continua protegido pelo OAuth Provider. Para validar somente a superfície HTTP local, use `/healthz` e espere `401` em `/mcp` sem bearer; um cliente MCP local precisa completar o fluxo OAuth usando o `MCP_PUBLIC_URL` do perfil local.

A UI de conexões também gerencia autorizações OAuth em `GET /api/authorizations`, `DELETE /api/authorizations/:id` e no alias `POST /api/authorizations/:id/revoke`. Essas rotas são same-origin e usam a mesma autenticação Cloudflare Access da página; a assertion Access não é aceita em `/mcp`. A listagem é paginada, filtra grants expirados pelo timestamp Unix em segundos e redige metadados do cliente. A política permite múltiplos grants (`revokeExistingGrants: false`); revogar um grant exige seu identificador e o usuário autenticado, e a UI confirma a remoção com uma nova leitura do Provider.


A revisão MCP publicada é `2026-07-28`. O `createMcpHandler` é criado por request com `legacy: 'stateless'`, `responseMode: 'json'` e limite de corpo configurável. Clientes sem os headers `Mcp-Method` / `_meta` da revisão 2026 são atendidos no modo stateless. Não adicione `sessionIdGenerator`, `StreamableHTTPServerTransport` stateful, SSE, WebSocket, stdio ou `createLegacyMcpHandler`.

O OAuth Provider exige o binding `OAUTH_KV`, um recurso canônico HTTPS em `MCP_PUBLIC_URL` e um `CONSENT_SECRET`. As aplicações de navegador `/authorize`, `/connections` e `/api` usam audiences Access distintas; `/admin` reutiliza a mesma aplicação e audiência de `/connections`. `ACCESS_AUDIENCE` aceita esses valores separados por vírgula. Essas rotas recebem a assertion JWT do Cloudflare Access, protegido por One-time PIN e pela allowlist dos dois e-mails. O token emitido pelo OAuth Provider é o único bearer aceito em `/mcp`.

A identidade do bearer chega ao servidor como `ctx.props.user`. As ferramentas que operam uma conexão chamam `ensureUser` e resolvem `(user_id, connection_id)` no D1 antes de descriptografar o token da instância. `connectionId` pode ser omitido para usar a conexão padrão; o resolvedor falha se não houver exatamente uma, e um UUID explícito sempre tem prioridade. `list_connections` é a exceção: consulta diretamente `GET /instance/all` com a chave administrativa do Evolution Go e redige credenciais da resposta. O webhook nunca confia no token recebido no corpo do Evolution Go: valida o segredo opaco da URL, confere `instanceId`, remove credenciais do envelope e deduplica no D1.

`list_messages` busca diretamente as mensagens persistidas no Evolution Go em `GET /message/search`, e não os eventos de webhook materializados no D1. O filtro opcional `conversationId` aceita número de contato ou JID individual/de grupo dentro da conta escolhida por `connectionId` ou pela conexão padrão. O schema remove espaços nas extremidades e rejeita strings vazias, valores de outros tipos e strings com mais de 200 caracteres após a remoção. O cliente envia o valor como `chat`, combinado com `q` para `text` e `limit` (padrão MCP 25, máximo 50), com codificação segura de query. O provedor restringe a consulta por instância e conversa antes do limite; não filtre localmente uma página geral. Omitir a conversa preserva o uso anterior, a ordenação e a resposta normalizada.

A busca depende da retenção de mensagens no Evolution Go, incluindo `DATABASE_SAVE_MESSAGES=true`; não garante todo o histórico do WhatsApp, e um resultado vazio é inconclusivo. O fork não oferece listagem de chats. Ajustes de contrato devem ficar concentrados em `src/lib/evolution.ts`, com testes mockados das rotas reais. Para o filtro de conversa, `test/mcp-messages.test.ts` exercita o caminho MCP até o cliente Evolution real com D1 e HTTP simulados; testes de schema e rotas complementam validação e serialização. Esses testes verificam o contrato emitido, sem comprovar a versão ou a retenção da instância de produção.
