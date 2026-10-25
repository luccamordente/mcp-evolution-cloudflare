# Guia para agentes

## Escopo e fontes de verdade

Este repositório publica um MCP remoto para Evolution Go no Cloudflare Workers. Antes de alterar código, leia `DEVELOPMENT.md` e consulte a fonte adequada:

- `docs/ARCHITECTURE.md`: transporte, OAuth, Access, D1, KV e isolamento.
- `docs/TOOLS.md`: ferramentas MCP, schemas conceituais e a origem dos dados.
- `docs/DEPLOY.md`: bindings, segredos, migrations e verificações de produção.
- `ATTRIBUTIONS.md` e `.scratch/upstream-research.md`: licenças e comparação dos projetos upstream.

Esses documentos são a referência técnica; o histórico das conversas registra decisões e diagnósticos que devem ser preservados conforme abaixo. Não transforme versões, QR codes, IDs de conexão ou resultados de uma sessão em garantia permanente sem nova leitura no ambiente.

## Invariantes de arquitetura

- O entrypoint publicado é `src/worker.ts`; `src/index.ts` contém o app Hono para UI, webhook e fallback de testes.
- O endpoint MCP é `POST /mcp`, com MCP `2026-07-28`, Streamable HTTP stateless, `legacy: 'reject'` e `responseMode: 'json'`. Cada request cria o servidor. Preserve a ausência de sessões de transporte, `Mcp-Session-Id`, SSE, WebSocket, stdio, `/sse` e `createLegacyMcpHandler`.
- OAuth do MCP e Cloudflare Access têm papéis separados. `/mcp` aceita somente o bearer OAuth emitido pelo OAuth Provider; a assertion `Cf-Access-Jwt-Assertion` autentica `/authorize` e a UI de conexões. Nunca aceite a assertion do Access como token MCP.
- D1 guarda usuários, conexões, auditoria e eventos de webhook; KV guarda o estado do OAuth Provider. O token de instância é cifrado com `TOKEN_ENCRYPTION_KEY`. Ferramentas recebem apenas o UUID interno da conexão e sempre resolvem `(user_id, connection_id)` antes de descriptografar.
- O webhook usa segredo opaco por conexão, confere a instância, remove credenciais do payload e deduplica em D1. Histórico, conversas e mensagens significam eventos capturados depois do webhook; Evolution Go não oferece busca retroativa equivalente à API v2.

## Contrato Evolution Go

Mantenha a diferença entre a chave administrativa global e o token de cada instância. A chave global é usada pelo cliente administrativo para criação; rotas de uma instância usam o token específico no header `apikey`. O contrato analisado usa `/instance/status`, `/user/contacts`, `/group/list`, `/send/text`, `/send/media` e `/message/downloadmedia`. O download exige o envelope completo da mensagem capturada, não apenas um ID.

Quando precisar consultar a implementação da API Evolution Go, use o checkout local ignorado `.scratch/evolution-go/`, que é o clone canônico de `https://github.com/neurau/evolution-go.git`. Se o diretório ainda não existir, clone o repositório nesse caminho; se já existir, execute `git -C .scratch/evolution-go pull --ff-only` antes de ler qualquer arquivo, para garantir que a consulta usa a versão mais recente. Não crie clones alternativos em outros diretórios do projeto.

Concentre mudanças de contrato em `src/lib/evolution.ts` e acrescente testes mockados das rotas reais. Leituras GET podem sofrer 5xx transitório: o cliente tenta até três vezes, enquanto operações de escrita não são repetidas para evitar duplicação. Erros e auditoria devem registrar somente status e mensagem sanitizados, nunca tokens, chaves, payloads sensíveis ou conteúdo desnecessário.

## UI, Access e provisionamento

- A UI do navegador fica em `/connections`. O carregamento usa `/connections/data` sob a mesma aplicação Access; não troque por um `fetch` que redirecione para outra audiência Access, pois o HTML de login vira um erro CORS.
- A UI/API pode aceitar bearer OAuth como compatibilidade de cliente, mas `/mcp` continua exclusivamente OAuth. Qualquer nova rota de navegador deve validar Access e manter o escopo do usuário.
- O provisionamento administrativo (`/connections?provision=1`, `/connections/provision` e a página `/admin/evolution`) é separado da superfície MCP e protegido. Ele pode criar/conferir instâncias, cadastrar a conexão no D1, configurar o webhook e devolver QR redigido; nunca devolve credenciais.
- Para QR expirado, o fluxo existente usa `reconnect` da instância já cadastrada. Não crie uma segunda conexão local só para renovar QR. Confirme sempre o estado no D1 e no Evolution antes de declarar conexão ou teste concluído.

## Segurança e dados reais

Use os e-mails autorizados configurados no projeto (`luccamordente@gmail.com` e `heitorsalazar@gmail.com`) somente através da autenticação existente. Segredos pertencem a Workers Secrets (`TOKEN_ENCRYPTION_KEY`, `CONSENT_SECRET`, `ACCESS_JWKS_URL`, `ACCESS_ISSUER`, `ACCESS_AUDIENCE` e, quando exigido pelo deployment, `EVOLUTION_GLOBAL_API_KEY`). A URL do Evolution está em `EVOLUTION_BASE_URL`; não copie seus valores para commits, logs, URLs, HTML, respostas MCP ou documentação.

Não trate uma mensagem enviada, um QR gerado, um deploy ou uma resposta HTTP isolada como prova de autenticação, conexão, histórico ou envio WhatsApp. Para falar com o Heitor, use exclusivamente a skill `whatsapp-via-wacli`, resolva o JID sem ambiguidade e leia a resposta antes de registrar qualquer teste como concluído.

Ao enviar mensagens WhatsApp a terceiros ou parceiros em nome do Heitor, sempre incluir no rodapé a identificação de que a mensagem foi enviada pelo agente IA do Heitor (ex: `—\n_Enviado pelo Agente IA do Heitor_`). Manter o texto direto, sem saudações desnecessárias e sem links redundantes.

## Desenvolvimento e validação

Use Node 20+:

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
