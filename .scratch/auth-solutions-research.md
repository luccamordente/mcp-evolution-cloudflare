# Pesquisa: autenticação independente do Cloudflare para poucos usuários

Data da pesquisa: 2026-10-15.

## Requisitos levantados no app e no MCP antes da busca

### Aplicação web e provisionamento

- A UI principal é `/connections`; `/connections/data`, `/api/connections/*`, `/connections/provision` e `/admin/evolution` são superfícies do mesmo app e precisam de autenticação de navegador consistente.
- O estado de identidade hoje vem de uma assertion JWT de Cloudflare Access, validada por JWKS, issuer e audiences; há uma allowlist configurável com `luccamordente@gmail.com` e `heitorsalazar@gmail.com`.
- A aplicação precisa mapear a identidade autenticada para `users` em D1 e impor isolamento por `user_id` em todas as leituras e mutações de conexões, QR, status, webhook e auditoria.
- O provisionamento administrativo é restrito ao usuário de Lucca; a UI precisa permitir onboarding, renovação de QR e verificação de conexão sem devolver tokens Evolution ou segredos de webhook.
- A solução precisa oferecer sessão de navegador ou bearer equivalente, logout/revogação, expiração e, se usar cookies, proteção contra CSRF e configuração segura de `SameSite`, `Secure` e `HttpOnly`.
- A autenticação deve continuar compatível com poucos usuários autorizados, permitir MFA ou passwordless/OTP quando possível, e manter auditoria sem registrar tokens, JWTs ou credenciais.

### MCP remoto

- O recurso público é `POST /mcp`, com MCP `2026-07-28`, Streamable HTTP stateless, sem SSE, WebSocket, `Mcp-Session-Id` ou transporte legado.
- O contrato de autorização exige OAuth 2.1 com Authorization Code + PKCE S256 para clientes públicos, Protected Resource Metadata (RFC 9728), descoberta do Authorization Server (RFC 8414), Resource Indicators/audience (RFC 8707), validação de issuer/audience e respostas corretas `401`/`403`.
- O endpoint `/authorize` deve autenticar o usuário, exibir consentimento e emitir o resultado OAuth; somente o bearer OAuth emitido para o recurso MCP pode chegar a `/mcp`. A credencial de navegador usada pela UI não pode ser aceita como token MCP.
- Clientes MCP podem ser públicos e/ou registrados dinamicamente; a solução deve validar redirect URIs, `state`, PKCE e revogação/expiração de refresh tokens. Os escopos atuais são `mcp:read`, `mcp:write` e `offline_access`.
- O servidor precisa carregar a identidade do token em cada request, resolver `(user_id, connection_id)` e manter a autorização de cada ferramenta; não pode confiar em nome de instância ou token Evolution fornecido pelo cliente.
- O armazenamento atual separa D1 (usuários, conexões, auditoria, eventos) de KV (estado OAuth). Ao remover Cloudflare como dependência de autenticação, a alternativa precisa cobrir sessões, chaves, tokens, descoberta e rotação, ou deixar explícito o adaptador próprio que continuará necessário.

### Critérios de comparação

1. Cobertura do fluxo web e do OAuth/MCP sem implementar um servidor OAuth inteiro às pressas.
2. Custo recorrente zero ou gratuito para dois usuários e poucos clientes, incluindo limites relevantes.
3. Possibilidade de operar fora da Cloudflare (SaaS independente ou self-hosted) e custo/complexidade operacional.
4. MFA/passwordless, allowlist de usuários, revogação, auditoria e isolamento por tenant/usuário.
5. Compatibilidade com Workers/Hono e com um endpoint MCP stateless; limitações precisam ser explícitas.
6. Qualidade e estabilidade das fontes primárias, maturidade e risco de lock-in.

## Pesquisa de soluções

_A pesquisa em fontes primárias será registrada abaixo após os requisitos acima._
