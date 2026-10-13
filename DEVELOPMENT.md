# Desenvolvimento

O fluxo HTTP é stateless: `createMcpHandler` constrói um `McpServer` para cada request moderno; `legacy: 'reject'` recusa mensagens da era anterior. Não adicione `sessionIdGenerator`, `StreamableHTTPServerTransport` stateful, SSE, WebSocket ou `createLegacyMcpHandler`.

A identidade é obtida do JWT validado por `src/lib/auth.ts`. Somente os e-mails de `ALLOWED_EMAILS` podem alcançar ferramentas e API de conexões. Cada chamada resolve a conexão por `(user_id, connection_id)` antes de descriptografar o token e criar o cliente Evolution Go.

Quando o contrato real do Evolution Go estiver confirmado, ajuste apenas `src/lib/evolution.ts` e os testes de integração mockados. Não aceite token ou instance ID diretamente das ferramentas MCP.
