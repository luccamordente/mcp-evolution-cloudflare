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


A revisão MCP publicada é `2026-07-28`. O `createMcpHandler` é criado por request com `legacy: 'stateless'`, `responseMode: 'json'` e limite de corpo configurável. Clientes sem os headers `Mcp-Method` / `_meta` da revisão 2026 são atendidos no modo stateless. Não adicione `sessionIdGenerator`, `StreamableHTTPServerTransport` stateful, SSE, WebSocket, stdio ou `createLegacyMcpHandler`.

O OAuth Provider exige o binding `OAUTH_KV`, um recurso canônico HTTPS em `MCP_PUBLIC_URL` e um `CONSENT_SECRET`. As aplicações de navegador `/authorize`, `/connections` e `/api` usam audiences Access distintas; `ACCESS_AUDIENCE` aceita esses valores separados por vírgula. Essas rotas recebem a assertion JWT do Cloudflare Access, protegido por One-time PIN e pela allowlist dos dois e-mails. O token emitido pelo OAuth Provider é o único bearer aceito em `/mcp`.

A identidade do bearer chega ao servidor como `ctx.props.user`. As ferramentas que operam uma conexão chamam `ensureUser` e resolvem `(user_id, connection_id)` no D1 antes de descriptografar o token da instância. `connectionId` pode ser omitido para usar a conexão padrão; o resolvedor falha se não houver exatamente uma, e um UUID explícito sempre tem prioridade. `list_connections` é a exceção: consulta diretamente `GET /instance/all` com a chave administrativa do Evolution Go e redige credenciais da resposta. O webhook nunca confia no token recebido no corpo do Evolution Go: valida o segredo opaco da URL, confere `instanceId`, remove credenciais do envelope e deduplica no D1.

O Evolution Go analisado não fornece busca retroativa de conversas/mensagens. A camada `db.ts` materializa somente eventos capturados depois do cadastro do webhook e mantém essa origem na resposta. Ajustes de contrato devem ficar concentrados em `src/lib/evolution.ts`, com testes mockados das rotas reais.
