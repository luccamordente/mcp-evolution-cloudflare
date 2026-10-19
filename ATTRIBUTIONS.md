# Atribuições e licenças

Este projeto não copia código dos dois servidores MCP analisados. Ele usa os repositórios como referência de nomenclatura, schemas e limites de contrato, e adapta as rotas efetivamente implementadas pelo Evolution Go.

## Referências analisadas

- `evolution-foundation/mcp-evolution-api`, commit `4a84f5523d8b0aa2b2409f2f24c67fee89ff01a1`, MIT, copyright IntuitivePhella 2025. A referência completa está em `.scratch/upstream-research.md`.
- `aiteks-ltda/mcp-evolution-whatsapp-api`, commit `e61528e0eb50dd361ea628102dff88d5d2bfd1ba`, MIT, copyright Steven Stavrakis 2025. A referência completa está em `.scratch/upstream-research.md`.
- `evolution-foundation/evolution-go`, commit `9337afc47e10b86cc896a6f432240e40fee95dd1`, versão upstream `0.7.2`, Apache-2.0 com avisos e condições adicionais do projeto. O Worker não redistribui código Go; a compatibilidade de rotas e os avisos de marca devem ser preservados em qualquer distribuição que inclua material do Evolution Go.

## Dependências diretas

As licenças e versões fixadas estão no lockfile:

- `@modelcontextprotocol/server` 2.3.1 — Apache-2.0; SDK oficial com suporte à revisão MCP `2026-07-28`.
- `@modelcontextprotocol/client` 2.3.1 — Apache-2.0; peer do SDK MCP Apps v2.
- `@modelcontextprotocol/ext-apps` 2.0.3 — SDK oficial MCP Apps. O pacote declara MIT, mas o arquivo LICENSE distribuído registra a transição de código para Apache-2.0, preservando trechos MIT; veja [texto integral preservado](third_party/mcp-ext-apps-LICENSE.txt). O build da UI mantém os avisos distribuídos.
- `@cloudflare/workers-oauth-provider` 1.2.3 — MIT; OAuth 2.1, PKCE S256, RFC 8414/7591/8707/9207/9728 e armazenamento KV.
- `hono` 4.13.13 — MIT; roteamento Web API para a interface e webhook.
- `jose` 6.2.12 — MIT; validação JWT/JWKS de assertions do Cloudflare Access.
- `zod` 4.6.7 — MIT; schemas explícitos das ferramentas.

Consulte os arquivos LICENSE distribuídos pelos pacotes para os textos completos. Nenhum token, segredo ou dado de usuário é incluído neste repositório.
