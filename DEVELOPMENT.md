# Desenvolvimento

Instale Node 20+ e rode `npm install`, `npm run check` e `npx wrangler deploy --dry-run`. O entrypoint de produção é `src/worker.ts`; `src/index.ts` exporta o fallback Hono usado por testes e pelas rotas de UI/webhook.

A revisão MCP publicada é `2026-07-28`. O `createMcpHandler` é criado por request com `legacy: 'reject'`, `responseMode: 'json'` e limite de corpo configurável. Não adicione `sessionIdGenerator`, `StreamableHTTPServerTransport` stateful, SSE, WebSocket, stdio ou `createLegacyMcpHandler`.

O OAuth Provider exige o binding `OAUTH_KV`, um recurso canônico HTTPS em `MCP_PUBLIC_URL` e um `CONSENT_SECRET`. As aplicações de navegador `/authorize`, `/connections` e `/api` usam audiences Access distintas; `ACCESS_AUDIENCE` aceita esses valores separados por vírgula. Essas rotas recebem a assertion JWT do Cloudflare Access, protegido por One-time PIN e pela allowlist dos dois e-mails. O token emitido pelo OAuth Provider é o único bearer aceito em `/mcp`.

A identidade do bearer chega ao servidor como `ctx.props.user`. Cada ferramenta chama `ensureUser` e resolve `(user_id, connection_id)` no D1 antes de descriptografar o token da instância. O webhook nunca confia no token recebido no corpo do Evolution Go: valida o segredo opaco da URL, confere `instanceId`, remove credenciais do envelope e deduplica no D1.

O Evolution Go analisado não fornece busca retroativa de conversas/mensagens. A camada `db.ts` materializa somente eventos capturados depois do cadastro do webhook e mantém essa origem na resposta. Ajustes de contrato devem ficar concentrados em `src/lib/evolution.ts`, com testes mockados das rotas reais.
