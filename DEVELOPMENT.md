# Desenvolvimento

Instale Node 22+ e rode `npm install`, `npm run check` e `npx wrangler deploy --dry-run`. O entrypoint de produção é `src/worker.ts`; `src/index.ts` exporta o fallback Hono usado por testes e pelas rotas de UI/webhook.

## TokenSave por worktree

Com o CLI `tokensave` instalado e a integração MCP configurada no agente, rode:

```sh
node scripts/worktree-setup.mjs
```

O Orca executa esse comando no setup de novas worktrees via `orca.yaml`, seguindo o padrão da Lovell. Ele cria ou atualiza o índice local em `.tokensave/` (ignorado pelo Git), inclui `wrangler.jsonc`, HTML, CSS e `.github/` nas buscas e preserva configurações existentes. A ferramenta é opcional: sua ausência ou falha não interrompe o setup.

Cada worktree precisa do próprio índice. Depois de criá-lo, reinicie a conexão MCP do agente se ela ainda estiver usando o índice da worktree principal. Para atualizar um índice existente após mudanças no código, use `tokensave sync`.

## Desenvolvimento local

Para abrir o Worker e a UI no navegador, rode:

```sh
npm install
npm run dev:local
```

Esse comando cria `.dev.vars` a partir de `.dev.vars.example` se necessário, aplica as migrations ao D1 local e inicia o Wrangler em `http://localhost:8787`. O D1 e o KV ficam persistidos em `.wrangler/local-dev`, portanto os dados de desenvolvimento sobrevivem à reinicialização. Para recomeçar com uma base vazia, pare o Worker e remova essa pasta.

No perfil `local`, `/connections` usa deliberadamente a identidade sintética `dev@example.test`; essa exceção só existe quando `ENVIRONMENT=local` e não altera a autenticação de produção. O perfil também usa `http://127.0.0.1:8789` como Evolution Go; o provisionamento e as chamadas reais só funcionam quando um mock local ou uma instância de desenvolvimento compatível estiver rodando nesse endereço. Para usar a UI visual sem backend, `npm run prototype:connections` continua disponível em `http://localhost:4173`.

O MCP continua protegido pelo OAuth Provider. Para validar somente a superfície HTTP local, use `/healthz` e espere `401` em `/mcp` sem bearer; um cliente MCP local precisa completar o fluxo OAuth usando o `MCP_PUBLIC_URL` do perfil local.

A UI de conexões também gerencia autorizações OAuth em `GET /api/authorizations`, `DELETE /api/authorizations/:id` e no alias `POST /api/authorizations/:id/revoke`. Essas rotas são same-origin e usam a mesma autenticação Cloudflare Access da página; a assertion Access não é aceita em `/mcp`. A listagem é paginada, filtra grants expirados pelo timestamp Unix em segundos e redige metadados do cliente. A política permite múltiplos grants (`revokeExistingGrants: false`); revogar um grant exige seu identificador e o usuário autenticado, e a UI confirma a remoção com uma nova leitura do Provider.


A revisão MCP publicada é `2026-07-28`. O `createMcpHandler` é criado por request com `legacy: 'stateless'`, `responseMode: 'json'` e limite de corpo configurável. Clientes sem os headers `Mcp-Method` / `_meta` da revisão 2026 são atendidos no modo stateless. Não adicione `sessionIdGenerator`, `StreamableHTTPServerTransport` stateful, SSE, WebSocket ou `createLegacyMcpHandler` no Worker publicado. O stdio existe somente no entrypoint Node de desenvolvimento descrito abaixo.

O OAuth Provider exige o binding `OAUTH_KV`, um recurso canônico HTTPS em `MCP_PUBLIC_URL` e um `CONSENT_SECRET`. As aplicações de navegador `/authorize`, `/connections` e `/api` usam audiences Access distintas; `/admin` reutiliza a mesma aplicação e audiência de `/connections`. `ACCESS_AUDIENCE` aceita esses valores separados por vírgula. Essas rotas recebem a assertion JWT do Cloudflare Access, protegido por One-time PIN e pela allowlist dos dois e-mails. O token emitido pelo OAuth Provider é o único bearer aceito em `/mcp`.

A identidade do bearer chega ao servidor como `ctx.props.user`. As ferramentas que operam uma conexão chamam `ensureUser` e resolvem `(user_id, connection_id)` no D1 antes de descriptografar o token da instância. `connectionId` pode ser omitido para usar a conexão padrão; o resolvedor falha se não houver exatamente uma, e um UUID explícito sempre tem prioridade. `list_connections` é a exceção: consulta diretamente `GET /instance/all` com a chave administrativa do Evolution Go e redige credenciais da resposta. O webhook nunca confia no token recebido no corpo do Evolution Go: valida o segredo opaco da URL, confere `instanceId`, remove credenciais do envelope e deduplica no D1.

`list_messages` busca diretamente as mensagens persistidas no Evolution Go em `GET /message/search`, e não os eventos de webhook materializados no D1. O filtro opcional `conversationId` aceita número de contato ou JID individual/de grupo dentro da conta escolhida por `connectionId` ou pela conexão padrão. O schema remove espaços nas extremidades e rejeita strings vazias, valores de outros tipos e strings com mais de 200 caracteres após a remoção. O cliente envia o valor como `chat`, combinado com `q` para `text` e `limit` (padrão MCP 25, máximo 50), com codificação segura de query. O provedor restringe a consulta por instância e conversa antes do limite; não filtre localmente uma página geral. Omitir a conversa preserva o uso anterior, a ordenação e a resposta normalizada.

A busca depende da retenção de mensagens no Evolution Go, incluindo `DATABASE_SAVE_MESSAGES=true`; não garante todo o histórico do WhatsApp, e um resultado vazio é inconclusivo. O fork não oferece listagem de chats. Ajustes de contrato devem ficar concentrados em `src/lib/evolution.ts`, com testes mockados das rotas reais. Para o filtro de conversa, `test/mcp-messages.test.ts` exercita o caminho MCP até o cliente Evolution real com D1 e HTTP simulados; testes de schema e rotas complementam validação e serialização. Esses testes verificam o contrato emitido, sem comprovar a versão ou a retenção da instância de produção.

## MCP local por stdio (Node 22+)

`dev:stdio` é um entrypoint Node exclusivo de desenvolvimento. Ele reutiliza as ferramentas e recursos MCP publicados, sem OAuth, Access, túnel ou login Cloudflare. O Worker publicado continua HTTP com OAuth.

Copie `.env.stdio.example` para `.env.stdio` (ignorado pelo Git) e informe `EVOLUTION_BASE_URL`, `LOCAL_INSTANCE_ID` e `LOCAL_INSTANCE_TOKEN` de uma instância existente. O ID deve ser o ID canônico retornado pelo estado live. A chave administrativa e a chave de criptografia de produção não são necessárias. A configuração também pode vir do ambiente do processo, que tem precedência sobre o arquivo. `IMAGE_STORAGE_ORIGINS` é opcional e aceita as mesmas origens HTTPS exatas da galeria publicada.

O setup de worktrees copia `.env.stdio` da worktree principal quando o destino ainda não existe, com permissão `0600`. A cópia é independente; alterações posteriores não são sincronizadas e uma configuração existente nunca é substituída. Somente esse arquivo é copiado: D1, chave de criptografia e estado em `.wrangler/stdio` continuam isolados. Sem Git ou fora de um checkout, a cópia é pulada sem interromper o setup. O helper é `scripts/copy-stdio-env.mjs`; nesta instalação, o hook Git local `post-checkout` também o executa para novas worktrees criadas a partir de branches anteriores ao setup atualizado.

Configure o cliente para iniciar o processo filho com o diretório absoluto desta worktree:

```json
{
  "mcpServers": {
    "wapilot-local": {
      "command": "npm",
      "args": ["--prefix", "/caminho/absoluto/da/worktree", "run", "--silent", "dev:stdio"]
    }
  }
}
```

`--silent` mantém banners npm fora de stdout, reservado exclusivamente ao protocolo; diagnósticos e migrations usam stderr. Também é possível executar `node /caminho/absoluto/da/worktree/scripts/dev-stdio.mjs`. Após editar código, reinicie o servidor pelo cliente: não há recarga automática.

No primeiro uso, o setup valida as credenciais e a correspondência da instância com uma consulta live, aplica as migrations existentes somente ao D1 local, gera uma chave AES de 256 bits e cadastra uma conexão padrão para `dev@example.test`. `list_connections` retorna o **identificador de conexão**, um UUID local diferente do ID da instância; as ferramentas usam esse UUID ou a conexão padrão ao omiti-lo. O setup não provisiona, pareia, reconecta nem configura webhooks remotos.

O cadastro, a auditoria e a chave ficam em `.wrangler/stdio`, isolados por worktree. Migrations usam `bindings` como `--persist-to`; o proxy Node usa `bindings/v3`, que corresponde aos mesmos arquivos. Bindings remotos são explicitamente desativados. Reinícios preservam a chave e o UUID; URL, instância, token ou chave incompatíveis com o cadastro interrompem o setup. Preserve a pasta inteira em conjunto: remover a chave torna os tokens do banco ilegíveis. Para começar do zero, pare o processo e remova a pasta `.wrangler/stdio` inteira; isso apaga os dados locais.

As ferramentas de leitura consultam o provedor real. `send_text`, `reply_to_message`, `forward_message` e `send_media` também estão disponíveis, usando a conexão padrão ou um identificador de conexão explícito. O entrypoint local fornece escopos de leitura e escrita à factory compartilhada como configuração confiável do processo; argumentos e metadados do cliente não concedem permissões. O HTTP mantém OAuth e exige `mcp:write` para envios, recusando contexto de autorização ausente.

Auditoria e registros de envios começam vazios e persistem no D1 local. Mensagens retidas dependem da disponibilidade e retenção do provedor, sem importar o histórico D1 de produção. Mídia conserva o limite de 8 MiB; o buffer stdio comporta seu envelope base64. Escritas nunca são repetidas automaticamente. **Uma instância de produção executa ações reais**: D1 local não simula envios. Só teste um envio real com destinatário e conteúdo definidos. Os testes automatizados usam exclusivamente um provedor HTTP simulado.

### Leitura visual de mensagens

`get_message_image` usa o catálogo compartilhado de produção e stdio. Consulte `list_messages` para obter o `messageId` de uma imagem retida e chame a ferramenta na mesma conexão; omita `connectionId` para usar a conexão padrão. Ela devolve os pixels como bloco MCP `type: "image"`, não como URL dentro de JSON. O cliente precisa encaminhar o bloco a um modelo com visão.

O storage precisa constar em `IMAGE_STORAGE_ORIGINS`, inclusive no arquivo local `.env.stdio`. A ferramenta aceita JPEG, PNG e WebP, usa o limite de `MAX_MEDIA_BYTES` (8 MiB por padrão) e não segue redirects. A galeria continua voltada à exibição ao usuário; sua resposta resumida não serve como evidência visual para o modelo. Consulte [TOOLS.md](docs/TOOLS.md#leitura-visual-de-imagens) para o contrato.
