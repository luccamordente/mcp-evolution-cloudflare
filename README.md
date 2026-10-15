# MCP Evolution Go no Cloudflare Workers

Servidor MCP remoto para conversas individuais e grupos do WhatsApp por meio do Evolution Go. O endpoint público é:

`https://mcp-evolution-cloudflare.luccamordente.workers.dev/mcp`

O protocolo publicado é **MCP 2026-07-28**, com transporte Streamable HTTP stateless, respostas JSON por troca e autenticação OAuth 2.1 + PKCE. Não há SSE, WebSocket, stdio, sessões persistentes, `/sse` ou `createLegacyMcpHandler`.

## O que está pronto

- Worker publicado com Hono, TypeScript, D1 e KV.
- OAuth Provider oficial `@cloudflare/workers-oauth-provider` 1.2.3, discovery, CIMD/DCR compatível, Authorization Code, PKCE S256, refresh e revogação.
- Cloudflare Access com One-time PIN e allowlist de `luccamordente@gmail.com` e `heitorsalazar@gmail.com` em `/authorize`, `/connections` e `/api`.
- Tokens das instâncias protegidos por AES-GCM e resolvidos apenas por UUID interno do usuário.
- Ferramentas de status, contatos, grupos, conversas/histórico capturados, texto, resposta e mídia.
- Webhook por conexão com segredo opaco, verificação da instância e deduplicação em D1.
- Testes unitários locais e dry-run do Wrangler.

## Limite do Evolution Go

O contrato efetivamente analisado no commit `9337afc`/versão upstream `0.7.2` usa o header `apikey` e as rotas `/instance/status`, `/user/contacts`, `/group/list`, `/send/text`, `/send/media` e `/message/downloadmedia`. Não há consulta retroativa de chats/mensagens equivalente à API v2. Por isso `list_conversations`, `list_messages` e `recent_messages` consultam eventos recebidos pelo webhook depois da integração e identificam essa origem na resposta. `download_media` exige o envelope completo da mensagem porque o endpoint Go não aceita somente um ID.

A URL do Evolution Go e a API key global já estão configuradas no Worker. Ainda falta cadastrar um token específico de instância em `/connections`; por isso nenhuma conexão, histórico real ou envio WhatsApp foi declarado como concluído.

## Desenvolvimento

```sh
npm install
npm run check
npx wrangler deploy --dry-run
```

Para abrir a aplicação localmente com D1/KV persistentes e uma identidade de desenvolvimento isolada:

```sh
npm run dev:local
```

Depois abra `http://localhost:8787/connections`. O comando aplica as migrations locais e cria `.dev.vars` somente com segredos de exemplo. O backend Evolution Go local é opcional; sem um mock ou uma instância de desenvolvimento em `127.0.0.1:8789`, a tela abre, mas o provisionamento de uma conexão não pode ser concluído.

Configure IDs de bindings em `wrangler.jsonc` e segredos com `wrangler secret put`. Nunca armazene tokens em `.env`, URLs ou respostas MCP. Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TOOLS.md](docs/TOOLS.md) e [docs/DEPLOY.md](docs/DEPLOY.md).

## Referências e atribuições

As comparações dos commits `evolution-foundation/mcp-evolution-api` (`4a84f552`) e `aiteks-ltda/mcp-evolution-whatsapp-api` (`e61528e0`) e a análise do Evolution Go estão em `.scratch/upstream-research.md`. O projeto não copia código desses repositórios; veja [ATTRIBUTIONS.md](ATTRIBUTIONS.md) para licenças e dependências.
