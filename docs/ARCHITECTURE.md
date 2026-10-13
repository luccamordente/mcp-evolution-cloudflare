# Arquitetura

O endpoint público é `POST /mcp`. O Worker cria um servidor MCP e transporte por troca HTTP a cada request. A configuração usada é `legacy: 'reject'` e `responseMode: 'json'`; não existem sessões de transporte, `Mcp-Session-Id`, SSE, WebSocket, stdio, `/sse` ou `createLegacyMcpHandler`.

O protocolo implementado é MCP `2026-07-28`. O SDK v2.3.1 mantém uma constante histórica de compatibilidade para a era 2025, então o Worker publica explicitamente a revisão 2026 no health check e usa a entrada moderna do `createMcpHandler`. Requests MCP devem conter a versão e os cabeçalhos de roteamento exigidos pela revisão (`MCP-Protocol-Version`, `Mcp-Method` e `Mcp-Name`).

O OAuth Provider do Cloudflare é usado no mesmo Worker. Ele responde descoberta, registro compatível, Authorization Code + PKCE S256, refresh e revogação. O recurso canônico é `https://mcp-evolution-cloudflare.luccamordente.workers.dev/mcp`. A rota `/authorize` fica sob uma aplicação Cloudflare Access separada, com One-time PIN e allowlist de `luccamordente@gmail.com` e `heitorsalazar@gmail.com`. O Access autentica o navegador; o OAuth Provider emite o token MCP. A assertion do Access nunca é aceita como token MCP.

D1 guarda usuários, conexões, auditoria e eventos de webhook. KV é reservado ao estado do OAuth Provider. O token de cada instância é cifrado com AES-GCM usando `TOKEN_ENCRYPTION_KEY` em Secret. As ferramentas recebem somente o UUID interno da conexão; o Worker resolve `(user_id, connection_id)` antes de descriptografar o token e enviar `apikey` ao Evolution Go.

O Evolution Go não oferece `findChats`/`findMessages` equivalente à API v2. Contatos e grupos são consultados por suas rotas reais; conversas e histórico são derivados de eventos `Message` recebidos após a configuração do webhook. O webhook usa um segredo opaco por conexão, verifica a instância, remove o token do payload, e deduplica por `(connection_id, event_name, message_id)`. Histórico anterior à integração não é inventado.
