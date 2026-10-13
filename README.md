# mcp-evolution-cloudflare

Scaffold de um servidor MCP remoto para Evolution Go em Cloudflare Workers. O Worker expõe o protocolo MCP **2026-07-28** em `/mcp` usando `@modelcontextprotocol/server@2.3.1`, com uma instância de servidor por troca HTTP. O handler está configurado com `legacy: 'reject'` e `responseMode: 'json'`: não há SSE, WebSocket, transporte stateful, sessões persistentes ou rota `/sse`.

## Estado desta base

- Cliente HTTP isolado para Evolution Go, com API key global opcional e token por instância somente em cabeçalhos.
- Ferramentas MCP para conexões, status, contatos, conversas, grupos, histórico paginado, mensagens recentes, texto, resposta, mídia e download de mídia.
- Schemas explícitos Zod e respostas estruturadas (`structuredContent.data`).
- D1 com usuários, conexões criptografadas (AES-GCM) e auditoria mínima.
- Interface protegida mínima em `/connections` e API `/api/connections` para cadastro, atualização, validação via status (pela ferramenta MCP) e remoção apenas local.
- Validação de JWT via JWKS configurável (Cloudflare Access/OAuth bridge deve fornecer `ACCESS_JWKS_URL`, emissor e audiência).
- `.env.example`, migration e testes unitários iniciais.

A implementação deliberadamente não presume que os caminhos da Evolution API v2 sejam os mesmos do Evolution Go. Os caminhos usados pelo cliente são concentrados em `src/lib/evolution.ts` e devem ser conferidos contra a versão implantada e seu OpenAPI antes do primeiro deploy real.

## Desenvolvimento

```sh
npm install
npm run typecheck
npm test
npx wrangler deploy --dry-run
```

Preencha `wrangler.jsonc` com os IDs reais de D1/KV e configure segredos sem gravá-los no Git:

```sh
wrangler secret put TOKEN_ENCRYPTION_KEY
wrangler secret put ACCESS_JWKS_URL
wrangler secret put ACCESS_ISSUER
wrangler secret put ACCESS_AUDIENCE
wrangler secret put EVOLUTION_GLOBAL_API_KEY # se o deployment exigir
```

`TOKEN_ENCRYPTION_KEY` deve ser uma chave AES de 128, 192 ou 256 bits codificada em base64url. Tokens das instâncias nunca aparecem em respostas, URLs ou logs.

## Dependências e atribuições

- [`@modelcontextprotocol/server`](https://github.com/modelcontextprotocol/typescript-sdk), Apache-2.0, versão `2.3.1`, suporte ao protocolo MCP 2026-07-28 e transporte HTTP por troca.
- [`hono`](https://github.com/honojs/hono), MIT, roteamento Web APIs compatível com Workers.
- [`zod`](https://github.com/colinhacks/zod), MIT, schemas de entrada e saída.
- [`jose`](https://github.com/panva/jose), MIT, validação JWT/JWKS e primitives criptográficas.
- [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider), Apache-2.0, reservado para a ponte OAuth 2.1/PKCE do deployment.

As licenças completas das dependências estão no lockfile e nos pacotes instalados. Nenhum código de `mcp-evolution-api` ou `mcp-evolution-whatsapp-api` é copiado nesta base; a comparação e a atribuição desses projetos devem ser adicionadas após a análise dos commits upstream.
