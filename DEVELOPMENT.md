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

O sender de callbacks usa o binding `CALLBACK_SENDER` no HTTP e uma imagem Node em Container local. `npm run dev:local` precisa de Docker disponível para essa imagem; o perfil stdio exclui Containers e Durable Objects e mantém `remoteBindings: false`. Não há rota pública para chamar o sender. A chave de desenvolvimento já existente deriva sua autenticação interna; não copie segredos de produção para executar testes.

`npm run test:sender-container` executa Worker e Durable Object reais no workerd/Miniflare e inicia a imagem Node pelo engine Docker local. Exige Docker, OpenSSL e a sub-rede de teste `93.184.216.0/24` livre; não rode junto com o teste de rede do pacote `sender`. O harness constrói as imagens locais, baixa o sidecar oficial fixado, gera uma CA temporária e usa o receptor DNS/TLS de `sender/test/receiver.mjs`. Um wrapper exclusivamente de teste conecta o sidecar à rede descartável antes de iniciar seu binário original, permitindo que ele descubra a faixa da fixture; não altera iptables, sysctl ou rotas do host, nem o sender de produção. As fixtures e os Containers são removidos ao terminar. O teste inclui concorrência, rejeições DNS/TLS, redirects, SIGTERM com chamada em andamento, um minuto real de inatividade e retomada. A prova local não substitui a homologação do egress na Cloudflare.

`test/callback-sender.test.ts` valida a entrada HTTP do Worker no workerd, com sender simulado ou configuração indisponível, incluindo falhas sanitizadas, limites e a distinção entre status do serviço e status do callback. Essa suíte regular não precisa de Docker nem usa bindings remotos.

Para abrir o Worker e a UI no navegador, rode:

```sh
npm install
npm run dev:local
```

Esse comando cria `.dev.vars` a partir de `.dev.vars.example` se necessário, aplica as migrations ao D1 local e inicia o Wrangler em `http://localhost:8787`. O D1 e o KV ficam persistidos em `.wrangler/local-dev`, portanto os dados de desenvolvimento sobrevivem à reinicialização. Para recomeçar com uma base vazia, pare o Worker e remova essa pasta.

No perfil `local`, `/connections` usa deliberadamente a identidade sintética `dev@example.test`; essa exceção só existe quando `ENVIRONMENT=local` e não altera a autenticação de produção. O perfil também usa `http://127.0.0.1:8789` como Evolution Go; o provisionamento e as chamadas reais só funcionam quando um mock local ou uma instância de desenvolvimento compatível estiver rodando nesse endereço. Para usar a UI visual sem backend, `npm run prototype:connections` continua disponível em `http://localhost:4173`.

O MCP continua protegido pelo OAuth Provider. Para validar somente a superfície HTTP local, use `/healthz` e espere `401` em `/mcp` sem bearer; um cliente MCP local precisa completar o fluxo OAuth usando o `MCP_PUBLIC_URL` do perfil local.

A UI de conexões também gerencia autorizações OAuth em `GET /api/authorizations`, `DELETE /api/authorizations/:id` e no alias `POST /api/authorizations/:id/revoke`. Essas rotas são same-origin e usam a sessão Clerk da página, com usuário D1 ativo; essa sessão não é aceita em `/mcp`. A listagem é paginada, filtra grants expirados pelo timestamp Unix em segundos e redige metadados do cliente. A política permite múltiplos grants (`revokeExistingGrants: false`); revogar um grant exige seu identificador e o usuário autenticado, e a UI confirma a remoção com uma nova leitura do Provider.


A revisão MCP publicada é `2026-07-28`. O `createMcpHandler` é criado por request com `legacy: 'reject'`, `responseMode: 'json'` e limite de corpo configurável. Clientes 2026 devem enviar os headers e o envelope `_meta` exigidos pela revisão. O adaptador HTTP também aceita envelopes 2025 sem esses campos, usando transporte stateless e respostas JSON; consulte a matriz em `docs/ARCHITECTURE.md`. Não adicione `sessionIdGenerator`, `StreamableHTTPServerTransport` stateful, SSE, WebSocket ou `createLegacyMcpHandler` no Worker publicado. O stdio existe somente no entrypoint Node de desenvolvimento descrito abaixo.

O OAuth Provider exige o binding `OAUTH_KV`, um recurso canônico HTTPS em `MCP_PUBLIC_URL` e um `CONSENT_SECRET`. As rotas de navegador `/authorize`, `/connections`, `/api` e `/admin` compartilham o verificador Request do Backend SDK Clerk. A configuração exige `CLERK_PUBLISHABLE_KEY` da instância correta, `CLERK_SECRET_KEY` em Secret e `MCP_PUBLIC_URL` confiável; `CLERK_JWT_KEY` é opcional para validação local da assinatura. O issuer deriva da publishable key e a origem autorizada deriva da configuração, nunca do Host recebido. Apenas cookie de sessão Clerk autentica o navegador; assertion e bearer Access e bearer OAuth MCP são recusados nessas APIs. O token emitido pelo OAuth Provider é o único bearer aceito em `/mcp`.

O login incorporado fica em `/sign-in`; `/accept-invitation` monta o cadastro pelo ticket Clerk, sem reproduzi-lo no HTML ou no retorno do login. `npm run build:auth` gera `public/auth.js` com `ptBR`; `npm run check` confere esse asset. Clerk JS `6.43.0` e UI `1.42.5` carregam pelo Frontend API da instância, em versões exatas. Dashboard, painel administrativo e consentimento carregam o SDK para renovar a sessão; sair do navegador não revoga grants OAuth. A localização é experimental e ainda requer homologação visual do fluxo completo, inclusive e-mails e mensagens do provedor.

HTML GET sem sessão volta ao login com retorno limitado a `/connections`, `/admin` ou uma requisição `/authorize` da mesma origem; parâmetros de ticket/credenciais são removidos. APIs retornam JSON `401`, conta sem vínculo/disabled retorna `403`, e falha de verificação retorna `503` sanitizado. Não há replay de POST de consentimento após login. Handshake propaga redirect `307` e todos os cookies; respostas autenticadas não são cacheáveis.

Mutações no dashboard e aliases exigem `Origin` canônico, cookie `__Host-wapilot_csrf` e header `X-WaPilot-CSRF` correspondente. O cookie CSRF é legível pelo JavaScript e não é uma sessão de autenticação. O consentimento preserva sua transação vinculada ao navegador e também exige a origem correta. O perfil sintético `ENVIRONMENT=local` mantém bootstrap e dispensa a sessão/CSRF de produção; os testes Clerk usam ambiente diferente e o SDK real. GET `run`/`renew` não cria números nem renova QR; o provisionamento administrativo usa POST protegido e a renovação existente fica no dashboard.

A identidade do bearer chega ao servidor como `ctx.props.user`. As ferramentas que operam uma conexão chamam `ensureUser` e resolvem `(user_id, connection_id)` no D1 antes de descriptografar o token da instância. `connectionId` pode ser omitido para usar a conexão padrão; o resolvedor falha se não houver exatamente uma, e um UUID explícito sempre tem prioridade. `list_connections` lista somente os registros de conexão do usuário no D1. O webhook nunca confia no token recebido no corpo do Evolution Go: valida o segredo opaco da URL, confere `instanceId`, seleciona notificações autorizadas antes de persistir conteúdo e deduplica IDs no D1; o envelope bruto não é arquivado.

`list_messages` busca diretamente as mensagens persistidas no Evolution Go em `GET /message/search`, e não os eventos de webhook materializados no D1. O filtro opcional `conversationId` aceita número de contato ou JID individual/de grupo dentro da conta escolhida por `connectionId` ou pela conexão padrão. O schema remove espaços nas extremidades e rejeita strings vazias, valores de outros tipos e strings com mais de 200 caracteres após a remoção. O cliente envia o valor como `identifier`, combinado com `q` para `text` e `limit` (padrão MCP 25, máximo 50), com codificação segura de query. O provedor restringe a consulta por instância e conversa antes do limite; não filtre localmente uma página geral. Omitir a conversa preserva o uso anterior, a ordenação e a resposta normalizada.

A busca depende da retenção de mensagens no Evolution Go, incluindo `DATABASE_SAVE_MESSAGES=true`; não garante todo o histórico do WhatsApp, e um resultado vazio é inconclusivo. O fork não oferece listagem de chats. Ajustes de contrato devem ficar concentrados em `src/lib/evolution.ts`, com testes mockados das rotas reais. Para o filtro de conversa, `test/mcp-messages.test.ts` exercita o caminho MCP até o cliente Evolution real com D1 e HTTP simulados; testes de schema e rotas complementam validação e serialização. Esses testes verificam o contrato emitido, sem comprovar a versão ou a retenção da instância de produção.

## MCP local por stdio (Node 22+)

`dev:stdio` é um entrypoint Node exclusivo de desenvolvimento. Ele reutiliza as ferramentas e recursos MCP publicados, sem OAuth, Access, túnel ou login Cloudflare. O Worker publicado continua HTTP com OAuth.

`get_message` está disponível nos dois catálogos e consulta uma mensagem retida por ID na conexão escolhida, retornando texto integral e metadados sem baixar anexos nem criar cache. Omitir a conexão usa a padrão; uma conexão explícita sempre tem prioridade. Mensagem ausente, conteúdo indisponível e texto vazio são resultados distintos. Os testes em `test/mcp-messages.test.ts` usam o provedor HTTP simulado e dados sintéticos para verificar Unicode, identidade, isolamento, sanitização e ausência de downloads; não comprovam retenção ou disponibilidade em produção. Consulte [TOOLS.md](docs/TOOLS.md#mensagem-completa-por-identificador).

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

Os quatro envios aceitam `idempotencyKey` opcional para a mesma ação. A migration `0006_send_operations.sql` mantém a reserva e o resultado mínimo no D1 por 24 horas, sem texto ou arquivos. Repetições concluídas reutilizam o ID; conflitos e resultados desconhecidos não iniciam novo envio. Não mude a chave para contornar um envio incerto. No stdio, a exclusão física de metadados vencidos ocorre no startup e a cada minuto enquanto o processo permanece aberto, sem consultar mensagens ou usar Cron remoto. Se estiver parado, a limpeza retoma na próxima abertura; a validade continua sendo conferida no uso. EOF e sinais cancelam o timer e aguardam a limpeza em andamento antes de liberar o D1. A proteção é limitada ao usuário/conexão/operação e à janela de 24 horas; chamadas sem chave preservam o comportamento anterior. `test/send-idempotency.test.ts` exercita MCP com D1 local real e provedor simulado, sem credenciais reais, incluindo concorrência, falhas de persistência e expiração no uso. O helper `test/helpers/local-d1.ts` aplica as migrations em uma instância Miniflare isolada.

A auditoria começa vazia no D1 local. Não há cache local de mensagens enviadas; seus IDs continuam nas respostas, mas listagem e encaminhamento dependem do conteúdo retido no provedor. Mensagens retidas dependem da disponibilidade e retenção do provedor, sem importar o histórico D1 de produção. Mídia conserva o limite de 8 MiB; o buffer stdio comporta seu envelope base64. Escritas nunca são repetidas automaticamente. **Uma instância de produção executa ações reais**: D1 local não simula envios. Só teste um envio real com destinatário e conteúdo definidos. Os testes automatizados usam exclusivamente um provedor HTTP simulado.

### Leitura visual de mensagens

`get_message_image` usa o catálogo compartilhado de produção e stdio. Consulte `list_messages` para obter o `messageId` de uma imagem retida e chame a ferramenta na mesma conexão; omita `connectionId` para usar a conexão padrão. Ela devolve os pixels como bloco MCP `type: "image"`, não como URL dentro de JSON. O cliente precisa encaminhar o bloco a um modelo com visão.

O storage precisa constar em `IMAGE_STORAGE_ORIGINS`, inclusive no arquivo local `.env.stdio`. A ferramenta aceita JPEG, PNG e WebP, usa o limite de `MAX_MEDIA_BYTES` (8 MiB por padrão) e não segue redirects. A galeria continua voltada à exibição ao usuário; sua resposta resumida não serve como evidência visual para o modelo. Consulte [TOOLS.md](docs/TOOLS.md#leitura-visual-de-imagens) para o contrato.

### Transcrição de áudio no MCP HTTP

`transcribe_message_audio` é exclusiva do catálogo HTTP nesta entrega; não é anunciada pelo stdio, e `remoteBindings: false` permanece obrigatório. Ela recebe `messageId` e `connectionId` opcional, consulta o áudio retido da mensagem e devolve somente a transcrição no idioma original. O Worker usa o binding `AI` e a allowlist independente `AUDIO_STORAGE_ORIGINS`. O limite de arquivo é o menor entre 8 MiB e `MAX_MEDIA_BYTES`, e a chamada completa tem prazo de 300 segundos, com cancelamento e sem retry de inferência. Configure o cliente MCP para esperar pelo menos 360 segundos.

Os testes de `test/message-audio.test.ts` simulam o provedor e o binding de inferência, incluindo download, validação de origem/tamanho, sanitização, cancelamento e prazos com relógio simulado; `test/mcp-messages.test.ts` valida o contrato MCP, a seleção de conexão e a auditoria. Eles não chamam Workers AI nem validam qualidade ou codecs reais. Consulte [TOOLS.md](docs/TOOLS.md#transcrição-de-áudio) e [DEPLOY.md](docs/DEPLOY.md#configuração-da-transcrição-de-áudio) antes de validar uma inferência remota.

`npx vitest run test/media-worker.test.ts` verifica o download de áudio e imagem no runtime workerd, reutilizando Miniflare do Wrangler e esbuild já instalados. Provedor, storage e inferência são simulados; o teste não acessa bindings remotos nem usa credenciais reais. Ele reproduz o erro `audio_unavailable`/502 causado por `redirect: 'error'`, opção aceita pelo Node mas não pelo Workers, e verifica o sucesso com `manual` e a rejeição de redirects sem seguir a URL de destino.


### Leitura de PDFs no MCP HTTP

`read_message_document` segue o padrão HTTP da transcrição de áudio e usa o binding existente `AI.toMarkdown`. Configure `DOCUMENT_STORAGE_ORIGINS` com origens HTTPS exatas do storage aprovado. A ferramenta aceita um `messageId` retido e `connectionId` opcional, devolvendo texto/Markdown, sem arquivo, URL privada, OCR ou interpretação visual das páginas. As instruções MCP orientam seu uso proativo quando o conteúdo do PDF for necessário ao pedido, inclusive em referências a anexos.

Entrada: até 8 MiB ou `MAX_MEDIA_BYTES` menor. Saída: até 200.000 caracteres, com falha explícita acima disso. Prazo: 60 segundos no WaPilot e pelo menos 90 segundos no cliente. O binding não oferece cancelamento remoto; o prazo limita a espera local. A ferramenta não integra o stdio e não habilita bindings remotos locais. Consulte [TOOLS.md](docs/TOOLS.md#leitura-de-pdfs) para os limites de cobertura de PDFs escaneados e mistos, e [DEPLOY.md](docs/DEPLOY.md#configuração-da-leitura-de-pdfs) antes de validar conversão remota.

`test/mcp-messages.test.ts` verifica download/conversão via MCP, escopo de conexão, validação de entrada, limites, erros seguros, cancelamento e instruções proativas. `test/media-worker.test.ts` também executa o fluxo PDF no workerd, com conversão simulada, para validar `Blob`, download sem credenciais e bloqueio de redirects. Esses testes não fazem inferência nem comprovam extração ou fidelidade reais.

O teste `npx vitest run test/mcp-events.test.ts` usa Provider, KV e D1 reais no workerd local e um sender HTTP simulado, sem callback público nem credenciais pessoais. Ele cobre o ciclo de assinaturas HTTP; stdio conserva o catálogo sem MCP Events e bindings remotos desativados. Consulte [TOOLS.md](docs/TOOLS.md#assinaturas-mcp-events) para prazo, identidade dos argumentos e cancelamento.


### Entregas MCP Events locais

`npx vitest run test/event-deliveries.test.ts test/event-recovery.test.ts test/mcp-events.test.ts` percorre MCP OAuth, webhook, handlers nativos de fila principal/DLQ e agendamento do Worker publicado, com Provider/KV/D1 reais locais. O broker e o sender usam limites externos simulados; não há mensagens WhatsApp ou callbacks públicos. O teste usa `getWorker().queue()` e `.scheduled()` do Miniflare, relógio controlado e reinício real do workerd. Verifica corpo/`eventId` estáveis, assinaturas novas, rotação, backoff e orçamento persistidos, falhas de publicação/armazenamento, leases, autorização, retenção exata e métricas sem conteúdo. Aceite HTTP seguido de falha local pode repetir uma notificação.

A configuração `local` contém D1/KV sintéticos e filas próprias com `remote: false`. O stdio mantém filas, Cron, Container e KV excluídos. O webhook deixa de alimentar o arquivo geral; somente notificações selecionadas pendentes guardam conteúdo, por até uma hora, e os identificadores operacionais duram até 24 horas. A migration `0009_drop_legacy_message_storage.sql` remove as tabelas legadas sem copiar payloads, preservando cadastros, ciphertext, auditoria e estado operacional válido. Consulte [ARCHITECTURE.md](docs/ARCHITECTURE.md#ingresso-e-primeira-entrega-mcp-events) e [DEPLOY.md](docs/DEPLOY.md#filas-e-retenção-de-mcp-events).

`test/message-storage-upgrade.test.ts` aplica o SQL real da migração final sobre D1 local com conteúdo legado sintético, preserva Provider/KV e entidades operacionais, e percorre assinatura, webhook, publicação de ID, callback, leitura integral e envio repetido com uma única escrita. `test/stdio.test.ts` aplica `0009` a um cadastro stdio existente com conteúdo legado sintético e a mesma chave, verifica reinício e um minuto real ocioso para a limpeza local, sem polling. A matriz de cancelamento/revogação e prazos de uma hora/24 horas continua nas suítes de entregas/recuperação, sobre o schema final. Nenhum teste utiliza mensagens pessoais ou bindings remotos.

### Validação em ambientes com `/tmp` sem execução

As fixtures de hooks Git e CLI precisam executar arquivos temporários. Se `/tmp` estiver montado com `noexec`, defina `TMPDIR` para um diretório privado e executável fora do checkout (por exemplo, um diretório de cache do usuário). Ele também deve ficar fora de um pacote com `type: module`, pois algumas fixtures são scripts CommonJS sem extensão. Execute `npm run check` normalmente com esse ambiente; não é necessário alterar ou pular os testes.


### Renderização de páginas de PDF

`read_message_document_pages` entrega uma página como imagem nativa no MCP HTTP, sem alterar `read_message_document` ou o stdio. `test/pdf-pages.test.ts` executa PDFium WASM real no workerd sobre `test/fixtures/document-pages.pdf`, conferindo dimensões e regiões coloridas conhecidas. `test/mcp-messages.test.ts` verifica a mesma capacidade pelo handler HTTP real, incluindo autorização, schema, identidade e imagem PNG. A fixture é sintética e não sensível. Esses testes comprovam renderização e transporte locais, não suporte universal de hosts ou compreensão de qualquer documento.
### Obtenção temporária do PDF original

`get_message_document` devolve o PDF como recurso binário incorporado MCP, somente no catálogo HTTP. Não depende de `AI.toMarkdown`, não habilita bindings stdio nem persiste mídia. O teste em `test/mcp-messages.test.ts` atravessa o handler HTTP real, decodifica o recurso, confere igualdade com `test/fixtures/document-original.pdf`, grava um arquivo temporário e remove-o. A fixture é sintética, produzida com ReportLab 4.4.10, sem dados privados.

Prova local em 2026-11-06: cliente de teste Node 24.13.0/Vitest 5.0.4, handler MCP JSON, PDF sintético de uma página, recurso incorporado recebido e gravado temporariamente; Poppler `pdftotext` leu `Temporary reader fixture: 7294` do arquivo recebido. A verificação com Poppler foi executada como complemento local, sem acrescentar dependência de sistema à suíte. Isso comprova os bytes no cliente de teste; não comprova que ChatGPT ou outro host encaminhe recursos PDF ao filesystem do agente. Esse aceite de compatibilidade real permanece aberto, sem deploy, mensagens privadas ou inferência paga.

### Inspeção de PDF por página

`inspect_message_document` devolve mapa/texto limitado e continuação, usando o PDFium real sem `AI.toMarkdown`. `test/mcp-messages.test.ts` atravessa o handler HTTP e comprova conexão, schema, texto por página, continuação de texto e sumário, rótulos e ausência de alegação de cobertura visual. `test/pdf-inspection.test.ts` repete a extração real de texto/rótulos/bookmarks no workerd, incluindo scan e página mista. As fixtures `document-inspection.pdf` e `document-outline.pdf` são sintéticas e regeneráveis com `python3 test/fixtures/generate-document-inspection.py` (ReportLab), sem serviços externos. O sumário da segunda contém 105 entradas para exercitar continuação. Os testes localizam trechos em páginas reais e preservam a diferença entre texto disponível e conteúdo visual; não avaliam a compreensão do modelo.

`test/pdf-detail-worker.test.ts` verifica o recorte real diretamente no workerd com bitmap de 2400 × 2400 pixels, conferindo marcadores coloridos. `test/pdf-detail.test.ts` complementa o processamento nativo e a suíte MCP verifica contrato e rejeição de coordenadas inválidas antes de acesso remoto. Esses testes não garantem fidelidade universal de PDFs ou comportamento de redução de imagem em hosts externos.
As prévias/lotes PDF (#31) são verificados pelo handler MCP real em `test/mcp-messages.test.ts`: ordem, continuação explícita, validação antes do acesso remoto e entrega parcial entre páginas válidas. A fixture `document-limits.pdf` contém uma página de dimensões excessivas entre duas válidas. `generate-document-matrix.py` regenera as fixtures sintéticas com ReportLab/Pillow, sem dependências Python em produção.


O fluxo de escolha e cobertura (#33) é anunciado por `server/discover` e pelo catálogo HTTP, com regressão em `test/mcp-messages.test.ts`. Consulte [a matriz de validação](docs/PDF-VALIDATION.md) antes de atribuir compatibilidade a um host. As provas não usam PDFs privados, envio de mensagens ou inferência remota paga.
