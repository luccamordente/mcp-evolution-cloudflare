# Guia para agentes

## Escopo e fontes de verdade

Este repositório publica um MCP remoto para Evolution Go no Cloudflare Workers. Antes de alterar código, leia `DEVELOPMENT.md` e consulte a fonte adequada:

- `docs/ARCHITECTURE.md`: transporte, OAuth, Clerk, D1, KV e isolamento.
- `docs/TOOLS.md`: ferramentas MCP, schemas conceituais e a origem dos dados.
- `docs/DEPLOY.md`: bindings, segredos, migrations e verificações de produção.
- `docs/CLERK-OPERATIONS.md`: vínculo de identidade, convites, desativação e corte/retorno. Leia antes de operar usuários, trocar a instância Clerk ou executar manutenção com bindings reais.
- `ATTRIBUTIONS.md` e `.scratch/upstream-research.md`: licenças e comparação dos projetos upstream.

Esses documentos são a referência técnica; o histórico das conversas registra decisões e diagnósticos que devem ser preservados conforme abaixo. Não transforme versões, QR codes, IDs de conexão ou resultados de uma sessão em garantia permanente sem nova leitura no ambiente.

## Invariantes de arquitetura

- O MCP do WaPilot deve seguir a [especificação oficial MCP `2026-07-28`](https://modelcontextprotocol.io/specification/2026-07-28), a revisão estável mais recente verificada em 2026-11-06 e fixada neste projeto. Consulte essa revisão ao implementar ou revisar transporte, mensagens, capacidades e autorização; atualizações de versão devem ser explícitas, com revisão de compatibilidade, documentação e testes.
- O entrypoint publicado é `src/worker.ts`; `src/index.ts` contém o app Hono para UI, webhook e fallback de testes.
- O endpoint MCP é `POST /mcp`, com MCP `2026-07-28`, Streamable HTTP stateless, `legacy: 'reject'` e `responseMode: 'json'`. Cada request cria o servidor. Preserve a ausência de sessões de transporte, `Mcp-Session-Id`, SSE, WebSocket, `/sse` e `createLegacyMcpHandler`.
- A spec #17 autoriza stdio exclusivamente no entrypoint Node de desenvolvimento `src/dev/stdio.ts`; consulte `DEVELOPMENT.md`. Preserve D1 e chave locais por worktree, stdout exclusivo para MCP e bindings remotos desativados. O bundle publicado permanece independente desse entrypoint.
- OAuth do MCP e Clerk têm papéis separados. `/mcp` aceita somente o bearer do OAuth Provider WaPilot; o navegador usa cookie de sessão Clerk verificada. D1 exige vínculo existente e `active` em páginas, APIs, consentimento, requests MCP e troca de código/refresh. Preserve a chave de grants `encodeURIComponent(emailCanonico)`, inclusive para props legados Access, e os IDs/FKs existentes. O bootstrap sintético permanece exclusivamente local.
- D1 guarda usuários, conexões, auditoria e estado operacional com retenção definida em `docs/ARCHITECTURE.md`; KV guarda o estado do OAuth Provider. O token de instância é cifrado com `TOKEN_ENCRYPTION_KEY`. Ferramentas recebem apenas o UUID interno da conexão e sempre resolvem `(user_id, connection_id)` antes de descriptografar.
- O webhook valida segredo e instância e seleciona somente notificações autorizadas antes de guardar a prévia temporária. Histórico, leitura integral e encaminhamento dependem exclusivamente da retenção do provedor. Preserve a ausência de arquivo geral de webhooks e cache de envios; prazos e limpeza estão em `docs/ARCHITECTURE.md`.

## Contrato Evolution Go

Mantenha a diferença entre a chave administrativa global e o token de cada instância. A chave global é usada pelo cliente administrativo para criação; rotas de uma instância usam o token específico no header `apikey`. O contrato analisado usa `/instance/status`, `/user/contacts`, `/group/list`, `/send/text`, `/send/media` e `/message/downloadmedia`. O download exige o envelope completo da mensagem capturada, não apenas um ID.

Quando precisar consultar a implementação da API Evolution Go, use o checkout local ignorado `.scratch/evolution-go/`, que é o clone canônico de `https://github.com/neurau/evolution-go.git`. Se o diretório ainda não existir, clone o repositório nesse caminho; se já existir, execute `git -C .scratch/evolution-go pull --ff-only` antes de ler qualquer arquivo, para garantir que a consulta usa a versão mais recente. Não crie clones alternativos em outros diretórios do projeto.

Concentre mudanças de contrato em `src/lib/evolution.ts` e acrescente testes mockados das rotas reais. Leituras GET podem sofrer 5xx transitório: o cliente tenta até três vezes, enquanto operações de escrita não são repetidas para evitar duplicação. Erros e auditoria devem registrar somente status e mensagem sanitizados, nunca tokens, chaves, payloads sensíveis ou conteúdo desnecessário.

## UI, Clerk e provisionamento

- Em toda comunicação voltada ao usuário final (UI, consentimento, mensagens, erros e respostas MCP), use a marca WaPilot e linguagem de produto. Nunca mencione Evolution/Evolution Go nem qualquer outra tecnologia interna do WaPilot.
- A UI do navegador fica em `/connections`; dados e aliases usam a mesma origem e sessão Clerk. APIs retornam JSON mesmo quando o cliente pede HTML. Handshake de navegação preserva os cookies separados e o redirect validado; respostas autenticadas usam `no-store`, sem diagnósticos brutos do SDK em headers.
- Rotas de navegador usam o verificador Request compartilhado, com `session_token`, issuer e origem confiáveis, seguido de autorização D1. Bearer isolado e assertion Access não substituem a sessão; cookie/JWT Clerk não autentica `/mcp`. Mutações e aliases exigem origem e CSRF; GET só navega/lê.
- Convite não ativa acesso: reserve D1 `disabled` com pendência e vincule a identidade apenas após read-back administrativo do ID Clerk/e-mail primário verificado. Lucca e Heitor usam a mesma lista operacional nos endpoints de convite/ativação; o painel administrativo permanece somente leitura. Preserve a autorização própria do provisionamento restrito.
- O provisionamento administrativo (`/connections?provision=1`, `/connections/provision` e a página `/admin/evolution`) é separado da superfície MCP e protegido. Ele pode criar/conferir instâncias, cadastrar a conexão no D1, configurar o webhook e devolver QR redigido; nunca devolve credenciais.
- Para QR expirado, o fluxo existente usa `reconnect` da instância já cadastrada. Não crie uma segunda conexão local só para renovar QR. Confirme sempre o estado no D1 e no Evolution antes de declarar conexão ou teste concluído.

## Segurança e dados reais

Use os e-mails operacionais configurados no projeto (`luccamordente@gmail.com` e `heitorsalazar@gmail.com`) somente através da autenticação existente. Segredos pertencem a Workers Secrets (`TOKEN_ENCRYPTION_KEY`, `CONSENT_SECRET`, `CLERK_SECRET_KEY` e, quando exigido pelo deployment, `EVOLUTION_GLOBAL_API_KEY`). A publishable key é pública; chaves/IDs de usuário devem corresponder à instância Clerk do D1. Secrets Access só participam do corte/retorno autorizado. A URL do Evolution está em `EVOLUTION_BASE_URL`; não copie seus valores para commits, logs, URLs, HTML, respostas MCP ou documentação.

## Desenvolvimento e validação

Use Node 22+:

```sh
npm install
npm run check                 # typecheck + Vitest
npx wrangler deploy --dry-run
npx wrangler deploy           # somente quando o escopo autorizar publicação
```

Valide em produção, quando aplicável, `/healthz`, `/mcp` sem bearer e `/.well-known/oauth-protected-resource/mcp`; espere `401` com metadata OAuth para `/mcp` sem autenticação. Para investigar incidentes, diferencie erros do Worker (`/mcp`), da UI/provisionamento (`/connections`) e do upstream Evolution (`/user/contacts` etc.). Um 500/502 transitório no upstream não prova que o transporte MCP caiu.

Comece cada tarefa com `git status --short --branch` e `git diff`. Preserve alterações de outros agentes: não use reset amplo, não descarte arquivos sujos e não misture correções não relacionadas. Faça commits temáticos e só faça push ou alteração de infraestrutura quando a tarefa autorizar explicitamente.

## Decisões registradas nas conversas deste projeto

- A implementação publicada escolheu `@modelcontextprotocol/server` 2.3.1, `@cloudflare/workers-oauth-provider` 1.2.3, Hono, `jose` e Zod; as versões fixadas no `package-lock.json` são a fonte de verdade.
- O repositório remoto é `https://github.com/luccamordente/mcp-evolution-cloudflare` e o Worker é `mcp-evolution-cloudflare`; confirme o estado atual com GitHub/Wrangler antes de assumir que um deploy automático no `main` está ativo. A conversa que tentou configurar Workers Builds ainda não forneceu uma confirmação final.
- O diagnóstico de log encontrou o MCP respondendo 200/400/401/405/204 e falhas 502 no provisionamento; chamadas de contatos chegaram a 503 transitório. A correção adotada foi retry limitado para GET e auditoria sanitizada. Reproduza e valide novamente antes de ampliar retries ou repetir writes.
- O provisionamento de Lucca e Heitor foi implementado para usar chave global na criação, token por instância no cadastro e webhook por conexão. IDs, tokens, QR e supostos testes daquela sessão são dados operacionais; faça read-back atual antes de reutilizá-los.

Quando uma mudança alterar contratos, autenticação, rotas, histórico ou mídia, atualize o documento correspondente em `docs/` e os testes junto com o código.

## Agent skills

### Issue tracker

Issues e especificações vivem no GitHub Issues deste repositório e usam `gh`. Veja `docs/agents/issue-tracker.md`.

### Triage labels

Usar as labels padrão `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` e `wontfix`. Veja `docs/agents/triage-labels.md`.

### Domain docs

Repositório single-context: `GLOSSARY.md` na raiz e `docs/adr/` para ADRs. Veja `docs/agents/domain.md`.
