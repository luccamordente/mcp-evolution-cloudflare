# Fundação Access e retorno — #61

## Atualização operacional de 14/11/2026

A reconciliação da candidata Clerk preserva a API publicada de cinco ferramentas descrita em [TOOLS.md](../TOOLS.md). Para a continuidade OAuth, use `search_connections` com `{ "options": {} }`, sem `include`: a resposta fica em `result.structuredContent.data.items` e consulta somente D1. Compare IDs, propriedade, padrão e nome amigável de forma privada; percorra offset/limit caso haja mais de 50 conexões. Teste primeiro o bearer pré-corte, depois o refresh original, preservando issuer/recurso canônico e escopos. Não consulte status live nem mensagens para essa prova.

O retorno Access de 13/11 abaixo é evidência histórica. A publicação corrente informada pelo read-back operacional de 14/11 é `a29ea1f20c443c497be65dca221eb43f1ef97db3`, versão `cce19d4b-683c-4b18-8937-8ec44d13950e`; a versão `6af1ec15…` restaura nomes e envelopes MCP antigos e deixou de ser o retorno preferido. Antes do corte #65, registre novamente o artefato exato e o inventário de configuração, bindings e imagem da versão vigente. O read-back de 14/11 confirmou `observability.redact_query_string=true` ativo; a omissão no fonte dessa publicação não demonstra regressão live. Mantenha `true` explícito na candidata e em qualquer upload de retorno, e confira depois da publicação. Preserve `0011_clerk_identity.sql`, vínculos, KV, dados e revogações; não reative Builds automaticamente.

A janela de produção da #61 foi **explicitamente autorizada e executada em 13/11/2026**. A fundação Access está publicada, com autorização D1, queries redigidas e respostas autenticadas `no-store`. O retorno preferido é a versão **`6af1ec15-cef2-4f01-b4c6-31c0c21e64dc`**, artefato **`16452515cd819d85557894821225937a9f26b660`**. **Os critérios da #61 foram concluídos, com merge local e revisões finais Standards/Spec sem achados.**

## Resultado atual da janela autorizada (23:16–23:37 UTC)

| Etapa | Fonte Access | Versão remota / deployment | Resultado |
| --- | --- | --- | --- |
| Fundação D1 e redaction | `0ffeb7aafc62deb97d684243c61073d7e53da853` | `37efb5c0-d3a7-42eb-a574-9bf7e7ff22d5` / `842580e3-c464-45f5-9afe-b2e1cc688866` | Criado às 23:16:11 UTC; CLI terminou às 23:16:15, `exit 0`, 13,63 s; read-back em 100% |
| Correção de cache autenticado | `16452515cd819d85557894821225937a9f26b660` | **`6af1ec15-cef2-4f01-b4c6-31c0c21e64dc`** / `5f237913-79d4-4341-8020-22952c73bcbd` | Criado às 23:30:04 UTC; CLI terminou às 23:30:10, `exit 0`, 14,77 s; versão 160 em 100%, retorno preferido |

Antes de cada publicação, a worktree Access estava limpa e seu HEAD foi conferido; a versão ativa foi relida imediatamente antes dos uploads, sem concorrência observada. Foram usados conta `e972fc5484db86f0468fa2cf78f61870`, Worker `mcp-evolution-cloudflare`, perfil `wapilot`, ambiente vazio, `--keep-vars`, `--containers-rollout none` e `WRANGLER_WRITE_LOGS=false`, com stdout/stderr somente em memória e resumos sanitizados. Não houve publicação a partir da candidata Clerk, merge/push em `main` ou rollback.

Workers Builds foi pausado pelo Dashboard independente às **22:55:48 UTC** e permaneceu `Disable builds=true`, branch `main`, na conferência final das **23:36 UTC**. As leituras paginadas anteriores aos uploads conferiram seis páginas/80 IDs únicos, todos `stopped`, nenhum `queued`, `running` ou `initializing`; o último recheck anterior ao segundo upload ocorreu às 23:29:16 UTC. A API do perfil CLI recusou também o endpoint exato de histórico (`403/12004`); a leitura autenticada do Dashboard resolveu essa lacuna. **Manter Builds pausado até reconciliar e validar um `main` seguro; a reativação é uma decisão explícita separada.**

### Prova da versão realmente servida e preservação dos recursos

O read-back às **23:32:49–23:32:51 UTC** confirmou a versão 160 em 100%. O bundle servido foi inspecionado somente em memória, com ETag **`9da575b3bbc8c01ff0b658cdbac580b7b4fb3842cd25bc20486362a2fb38aa06`**, igual ao `resources.script.etag` da versão; módulo `worker.js`, 4.054.996 bytes, SHA-256 **`a646d2363ae680adeb83b1ef502190860e8a02974d455af1c9b9a65100743eeb`**. Encontrados no código real: `ensureUser` exige `active` e não contém `INSERT`, `tokenExchangeCallback` exige D1 e o helper Access define `Cache-Control: no-store`. O bundle bruto não foi salvo.

As nove vars coincidem com o artefato, comparadas em memória; todos os bindings/nomes de Secrets, runtime e flags coincidem com o preflight. Cron `* * * * *` e ambos os consumers/limites/DLQ permaneceram iguais. Aplicação Container e namespace DO permaneceram os mesmos; a imagem no runtime mantém o digest `sha256:0c51d43a7c639cd66e60df7579b2551b949cc873f2157c1718c15493a2c0dfd2`. O endpoint de versões da aplicação retornou coleção vazia; isso não foi usado como prova de ausência de imagem. `observability.redact_query_string=true`, com as demais opções de observability preservadas.

O SELECT mínimo do administrador antes do login (**22:54:47 UTC**) retornou uma linha `active`; após a primeira publicação continuava `active` (**23:19:10 UTC**). Nenhum usuário ou conexão foi recriado/desativado; credenciais de conexão foram preservadas e nenhuma migration foi aplicada: `0011_clerk_identity.sql` continuou a única pendente. Access apps/policies, seus campos não capturados e os Secrets existentes foram preservados. Clerk production e fases #63–66 não foram executados.

### Duas transições com um único grant descartável

Um único cliente foi registrado após a pausa. Lucca concluiu Access e o consentimento normal; código/PKCE/tokens ficaram somente no processo ou em arquivos `0600`, dentro de diretório `0700` fora do repositório. O harness local foi testado contra um servidor sintético: estado inválido/replay recusados, retomada sem novo DCR e ordem bearer anterior → refresh. A execução real teve allowlist explícita: `server/discover`, `tools/list` e `tools/call:list_connections`; nenhuma chamada MCP de envio ou upstream.

**Limitação preexistente de escopos:** o pedido foi `mcp:read offline_access`, mas o consentimento Access mostra uma lista estática de todas as permissões e concede `mcp:read mcp:write offline_access`. Não havia seleção individual na UI. A prova prosseguiu com os três escopos efetivamente consentidos e comparados exatamente; **o grant não era read-only**, embora todas as operações do teste fossem de leitura. O fluxo de consentimento não foi alterado neste escopo.

| Transição | Antes da publicação | Mesmo bearer depois | Refresh anterior e nova leitura |
| --- | --- | --- | --- |
| `c8936c3f…` → `37efb5c0…` | Grant emitido às 23:10:10; baseline às 23:14:35 | `200` às 23:18:20 | `200` às 23:19:10 |
| `37efb5c0…` → `6af1ec15…` | Checkpoint dos tokens renovados às 23:19, sem novo DCR/consentimento; baseline às 23:28:42 | `200` às 23:32:50 | `200` às 23:34:27 |

Em ambas: MCP `2026-07-28`, JSON sem sessão de transporte, 16 ferramentas, uma mesma conexão por comparação de IDs em memória, e os três mesmos escopos antes/depois. O refresh já consumido da primeira transição não foi reutilizado na segunda. As negativas de contas ausentes/desativadas e indisponibilidade D1 continuam demonstradas por fixtures locais e pelo código publicado, sem desativar administradores reais.

### Correção `no-store`, validação e encerramento do teste

A primeira versão endurecida ainda devolvia `/connections/data` e `/connections/authorizations` sem `Cache-Control`. A causa era o retorno JSON sem header compartilhado. O commit `1645251` adiciona **uma linha** no helper `requireAccessUiAuth`, cobrindo `requireUiAuth`, admin, aliases e erros. O teste HTTP existente foi ampliado: seis caminhos reais de sucesso, alias/admin, erro 404 e negativas 403; falhou antes da correção e passou depois. Typecheck passou, **12 testes** de autenticação/consentimento passaram (3,26 s), dry-run 9.134,02 KiB bruto / 3.323,88 KiB gzip; duas revisões independentes **GPT Sol xhigh, zero achados**, antes do segundo upload. A suíte anterior de 768 não foi repetida sem necessidade.

Na sessão Access do navegador, novos GETs após a segunda publicação confirmaram `/connections` `200 text/html`, `/connections/data` e `/connections/authorizations` `200 application/json`, todos com **`Cache-Control: no-store`**. Às **23:35:11 UTC**, probes anônimos devolveram `/healthz` e protected-resource metadata `200`; `POST /mcp` sem bearer, `401`/`no-store` com `resource_metadata`, sem challenge Access. Esses são resultados amostrados: **não houve falha nos probes, mas não existiu monitoramento contínuo de disponibilidade; a duração dos comandos não é uma medição de downtime.**

O grant descartável foi localizado por nome e hash do `client_id`, com correspondência única entre todas as páginas. O fluxo próprio do WaPilot o revogou: sete grants antes, seis depois, alvo ausente e hashes dos outros seis IDs idênticos. O bearer mais recente retornou **`401` às 23:37:07 UTC**. Callback encerrado; os dois arquivos reais de estado/PKCE/tokens foram apagados. A resposta DCR não oferece API de gerenciamento/deleção: permaneceu apenas a metadata pública do cliente, **sem grant ativo**; não houve edição direta do KV. Código e teste sintético privados permaneceram sem credenciais.

## Preflight histórico (antes da autorização de produção)

O levantamento abaixo começou em **13/11/2026, 16:29–16:34 UTC**, com nova investigação às **22:06 UTC**. Naquela fase só foram feitas leitura e preparação local, sem publicação, alteração Access/Builds ou migration. As pendências daquela etapa foram tratadas na janela autorizada registrada acima; o histórico não descreve o estado remoto final.

## Primeiro levantamento e limites (16:29–16:34 UTC)

| Alvo | Evidência desta execução |
| --- | --- |
| Worker/conta | `mcp-evolution-cloudflare`, conta `e972fc5484db86f0468fa2cf78f61870`; leitura pelo perfil Wrangler existente `wapilot`, versão 4.150.0, Node 24.13.0 |
| Tráfego | Deployment `619efe0e-288a-463b-9904-8410b8ee182a`, criado em 12/11 às 02:29:41 UTC, versão `c8936c3f-59d0-46ed-8485-88c40c46ad2e` em 100% |
| Origem declarada da versão | Metadata `workers/commit_sha=e6630a73bcdafccdcd45067f3728cdb24d43a515`, tag `native-event-7cf401a`; o commit remoto descreve o snapshot publicado de `7cf401a8e0d100ed646d9102d013063b10889b18` |
| D1 | `mcp-evolution`, ID `d25ad771-5b81-4e41-88ed-6f980a32dbf9`; `d1 migrations list DB --remote` encontrou somente `0011_clerk_identity.sql` pendente. Nenhuma migration foi aplicada; não foram lidos usuários ou conexões reais |
| KV | Binding `OAUTH_KV`, namespace `3a5b420e14594ee4ae821b720a9bf74a`; nenhum conteúdo foi lido |
| Outros bindings | `AI`, produtor `EVENT_DELIVERIES` para `wapilot-events`, namespace DO `CALLBACK_SENDER`/classe `CallbackSender` e Container `wapilot-callback-sender`; runtime `2026-10-13`, flags `nodejs_compat` e `global_fetch_strictly_public` |
| Credenciais | Metadata mantém os nomes dos três bindings Access, `CONSENT_SECRET`, `TOKEN_ENCRYPTION_KEY` e chave administrativa do serviço de mensagens. Valores desses bindings não foram solicitados ou copiados |
| GitHub | `origin/main=084d530e8357307c2118954898c97eda642aa765`; sem workflows Actions ou webhooks de repositório retornados pela API. Há check **Workers Builds: mcp-evolution-cloudflare** concluído com sucesso, build `208f72d7-ce7f-4635-919f-33bd83624e65` |
| Automação com leitura recusada | O check comprova integração Workers Builds; a API autenticada pelo perfil correto `wapilot` recusou configuração e triggers (`403`, código `10000`). Branch, comando, filtros e promoção automática continuam sem conferência. Nenhum push/merge em `main` deve ser tratado como inofensivo |
| Access com leitura incompleta | Probes anônimos de `/connections` e `/authorize` receberam `302` para o gateway Access, com cache bloqueado. Pelo perfil correto, a listagem de apps da conta respondeu `200` com coleção vazia; as leituras de apps da zona e organização foram recusadas (`403`, código `10000`). Não há app/política conferidos nem prova de ausência de proteção |
| Caminho administrativo | O perfil Wrangler conseguiu ler deployment, versão e migrations sem login WaPilot. O conector Cloudflare recusou a conta proprietária (`403`, conta fora do escopo da conexão); acesso independente ao painel/políticas Access e responsável por corte/retorno ainda precisam de confirmação |

Também foram conferidos `/healthz` e `/.well-known/oauth-protected-resource/mcp` (`200`) e `POST /mcp` sem bearer (`401`, `no-store` e desafio com `resource_metadata`). Esses probes não demonstram a barreira D1, continuidade autenticada ou funcionamento do provedor de mensagens. Não houve indisponibilidade planejada nem mudança de tráfego nesta preparação.

## Leituras suplementares pelo perfil correto

Em **13/11/2026, 16:44–16:46 UTC**, as lacunas foram efetivamente investigadas com a credencial já existente do perfil Wrangler `wapilot`, usada somente em memória, sem imprimir ou persistir portadores. Não houve reconexão, criação de credenciais, consulta de valores de bindings/Secrets, leitura de usuários/grants ou alteração de infraestrutura. O `403` anterior do conector não foi usado como substituto dessas tentativas.

A conta alvo abaixo é `e972fc5484db86f0468fa2cf78f61870`. A listagem de Workers confirmou o tag de sistema `d8437e2f8de346179af30daf82a50885` do Worker correto; a busca de zona por nome confirmou `wapilot.com.br`, zona `725a4f686e54e4322a6da21b18176e3d`, ativa e pertencente à mesma conta.

| GET autenticado pelo perfil `wapilot` | Resultado sanitizado |
| --- | --- |
| `/accounts/CONTA/workers/scripts` | `200`; Worker e tag conferidos |
| `/accounts/CONTA/builds/workers/d8437e2f8de346179af30daf82a50885` | `403`, erro Cloudflare `10000` |
| `/accounts/CONTA/builds/workers/d8437e2f8de346179af30daf82a50885/triggers` | `403`, erro Cloudflare `10000` |
| `/accounts/CONTA/access/apps?per_page=1000` | `200`, `count=0`, `total_count=0`; nenhum app utilizável para ler políticas foi retornado |
| `/zones?name=wapilot.com.br&per_page=50` | `200`, uma zona encontrada, conta conferida |
| `/zones/725a4f686e54e4322a6da21b18176e3d/access/apps?per_page=1000` | `403`, erro Cloudflare `10000` |
| `/accounts/CONTA/access/organizations` | `403`, erro Cloudflare `10000` |

A organização da outra conta já disponível no perfil, `2ebbaee1e810ab3429524fa89dd8dac1`, também recusou leitura (`403`, `10000`); não houve expansão para dados de outra aplicação. Não foi feita uma chamada fictícia de `/access/apps/:appId/policies`: a sessão não forneceu um ID confiável do app que protege o domínio. Portanto o estado de políticas e os comandos/gatilhos de publicação continuam pendentes de acesso administrativo adequado, com recusas documentadas, e não por falta de tentativa pelo perfil correto.

## Reconciliação da referência

A referência anterior `9d5983853257c1e678e87aa5a217a89139a62ca4`, baseada no `main` `084d530`, **não preserva todo o código declarado pela versão ativa**: remove histórico nativo, leitura paginada de respostas e envio de eventos. O `main` e a candidata Clerk desta integração também não contêm essas diferenças publicadas. Reconciliar a candidata antes de um futuro corte é um gate separado; este ticket não incorpora funcionalidades de mensagens na candidata.

O primeiro artefato reconciliado é **`e70a4e57515fba350f3d9564a7ff4b80144ad966`**, branch `rollback/59-access-published`, diretamente sobre `e6630a73`. Ele reaplica somente o endurecimento de autorização e seus testes de `9d598385`, preservando os arquivos de histórico/eventos, correção de mídia e lockfile da revisão declarada como publicada. A primeira revisão de retorno com redaction foi **`0ffeb7aafc62deb97d684243c61073d7e53da853`**, branch `luccamordente/issue61-access-redaction`, filha de `e70a4e5`: acrescenta somente `observability.redact_query_string=true`. A comparação inicial por metadata foi complementada pela inspeção do bundle remoto ativo descrita abaixo; não se afirma que a compilação local reproduz seus bytes.

A inspeção dessa base publicada encontrou `ensureUser` com criação automática e sem filtro `active`, além da ausência do callback de autorização D1 na troca de código/refresh. Portanto, **naquele preflight a fundação segura ainda não estava publicada**. Os probes públicos não mudavam essa conclusão; a janela posterior acima registra a publicação e a validação remotas.

O artefato exige conta D1 existente e ativa nas páginas/APIs, consentimento, cada request MCP e callback de código/refresh. Ausente/desativada retorna acesso negado/`invalid_grant`; indisponibilidade do D1 responde `503 temporarily_unavailable`, preservando o grant para nova tentativa. Preserva `encodeURIComponent(emailCanonico)`, props legados, escopos anteriores e `revokeExistingGrants: false`. A migration `0011` é aditiva; o retorno não a desfaz, nem reativa contas ou restaura grants revogados.

## Validação local

A revisão do artefato reaproveita os testes existentes de `test/identity-authorization.test.ts` e `test/oauth-consent.test.ts`: navegador Access com JWT/JWKS sintéticos, conta ausente/desativada, consentimento, bearer antigo, código/refresh, falha D1 recuperável, identidade incompatível e preservação de conexões/cifras/defaults após a migration aditiva. Nenhum administrador real foi desativado, banido ou recriado. Nenhuma credencial de usuário real foi usada nesses testes.

- `npm run check`: aprovado em `e70a4e5`; build da galeria e typecheck passaram, 50 arquivos/768 testes aprovados, 1 arquivo/15 testes pulados, duração de 107,49 segundos.
- Conferência focada adicional enquanto a suíte completa ainda executava: `npx vitest run test/identity-authorization.test.ts test/oauth-consent.test.ts --reporter=verbose --maxWorkers=1`, 12 testes aprovados. A execução inicial da referência antiga foi interrompida após identificar a divergência; não é usada como evidência deste artefato.
- `npx wrangler deploy --dry-run --env '' --containers-rollout none`: aprovado, 9.136,58 KiB bruto / 3.324,02 KiB gzip; compila sem publicar nem reconstruir o Container.
- Testes conectados, WhatsApp, sender e dispositivos: não executados; não há alteração desses contratos neste artefato.

## Nova conferência de código e configuração (22:06–22:26 UTC)

As APIs oficiais foram novamente consultadas pelo perfil Wrangler `wapilot`, com portador capturado apenas em memória e passado ao cliente HTTP por stdin. A conexão Cloudflare do plugin continua fora do escopo da conta alvo; nenhuma conta/aplicação alternativa foi investigada. O perfil CLI acessa a conta proprietária e sua associação retornou `accepted`, papel `Super Administrator - All Privileges`; isso não transforma os `403` de Access/Builds em leituras bem-sucedidas. O Dashboard autenticado pelo operador complementa essas APIs conforme a seção seguinte.

Deployment, versão, commit declarado e `origin/main` permaneceram iguais aos do primeiro levantamento. O GET autenticado do bundle publicado retornou `ETag=67794087ab49d64deac2458c420e8cb9e42f275d3fb55a2a90a5e76a2f8e17db`, igual ao `resources.script.etag` da versão ativa `c8936c3f…`. O módulo `worker.js` tem 4.055.022 bytes, SHA-256 `afc49287d687d6efc2748fe03c45379600c9c8cd1b62404b2d1d84f18f09bba6`. A inspeção em memória desse bundle encontrou `ensureUser` com `INSERT INTO users`, sem requisito de `active`, e `oauthOptions` sem `tokenExchangeCallback` D1. **A ausência do endurecimento está comprovada no código realmente servido, além da metadata de origem.** Não foi salvo ou reproduzido o bundle bruto.

| Recurso efetivo | Conferência |
| --- | --- |
| D1/migrations | Somente `0011_clerk_identity.sql` pendente, novamente confirmado; comando de leitura com conta explícita. Nenhuma linha de usuário, conexão ou grant lida |
| Vars | As nove vars do artefato Access coincidem com os bindings publicados, comparadas em memória; nenhum valor do provedor foi registrado. Sem var plaintext publicada adicional |
| Domínio | `app.wapilot.com.br`, custom domain habilitado no Worker alvo, mesma zona/conta; nenhuma Workers Route adicional desse Worker na zona |
| Cron | `* * * * *`, igual ao artefato |
| Queues | `wapilot-events`, um consumer do Worker alvo: lote `10`, espera `1000 ms`, `max_retries=3`, `retry_delay=0`, DLQ `wapilot-events-failed`. A DLQ também tem consumer do mesmo Worker, lote `10`, espera `1000 ms`, `max_retries=0`, `retry_delay=0`; ambos coincidem com o artefato |
| Container | Aplicação `wapilot-callback-sender`, namespace DO `cd856f47b7f34c689db190033e71a412`. A versão ativa fixa a imagem pelo digest `sha256:0c51d43a7c639cd66e60df7579b2551b949cc873f2157c1718c15493a2c0dfd2`; o GET da aplicação omite `configuration`, portanto não comprova limites de instâncias. O procedimento preserva a imagem com `--containers-rollout none` |
| Observability | Settings publicados: habilitada, amostragem `1`, logs persistidos/invocações habilitados, traces desabilitados e **`redact_query_string=false`**. É gate de correção/read-back antes de convites Clerk em produção |

A revisão `0ffeb7a…` corrige somente a última configuração no retorno preparado. `git diff --check` e o dry-run com Wrangler fixado `4.150.0`, `--env '' --containers-rollout none`, passaram: 9.136,58 KiB bruto / 3.324,02 KiB gzip. Não foram repetidos os 768 testes e 12 focados de `e70a4e5`, pois nenhum código/dependência/teste mudou. A resolução efetiva da configuração pelo próprio Wrangler (`env` vazio, sem redirecionamento) confirmou Worker/entrypoint, runtime/flags, IDs D1/KV, Cron, consumers e `observability={enabled:true,redact_query_string:true}`. Essa revisão mantém as nove vars e o restante da configuração de `e70a4e5`; a redaction é a diferença intencional de observability em relação à publicação. Nenhum deploy, upload de versão, rebuild de imagem ou reconciliação remota foi executado.

## Preparação final com dependências próprias (após revisão, 13/11/2026)

Após a revisão independente, `npm ci` foi executado na worktree `issue61-access-redaction`, sem alteração de `package.json` ou lockfile. As 142 dependências instaladas coincidem com suas versões no lock; os pacotes opcionais de outras plataformas não foram instalados. Wrangler local confirmou `4.150.0`. `npm run typecheck` passou em 2,62 segundos; os dois arquivos de autenticação/consentimento passaram novamente com essas dependências próprias, **12 testes**, em 3,69 segundos. A suíte de 768 não foi repetida, pois código e dependências fixadas não mudaram.

O dry-run da worktree preparada passou com `--env '' --containers-rollout none`: **9.133,98 KiB bruto / 3.323,88 KiB gzip**. Esse é o tamanho atual a usar na janela; a métrica anterior utilizava `node_modules` por symlink. A comparação isolada reproduziu os dois tamanhos e confirmou que não há diferença de versões frente ao lock: normalizando somente os prefixos relativos dos caminhos de dependências no `worker.js`, os bundles ficaram idênticos, sem nenhuma linha restante. A diferença é de rótulos/caminhos do empacotamento, não de dependência fixada. As dependências próprias permanecem disponíveis; nenhum symlink de dependências foi deixado no artefato.

Na primeira captura desta preparação, o Wrangler imprimiu vars na saída padrão. Os logs automáticos gerados por esta tarefa foram removidos, sem reproduzir o conteúdo. As chamadas subsequentes usaram captura em memória e, na comparação final, `WRANGLER_WRITE_LOGS=false`; os artefatos brutos temporários foram eliminados. Só resumos sanitizados foram preservados. Essa correção local não modifica logs ou settings de produção.

## Dashboard administrativo (nova leitura)

O operador entrou diretamente no Dashboard Cloudflare; o helper Terra conferiu o ID `e972fc5484db86f0468fa2cf78f61870` antes de ler o Worker. O nome exibido da conta é um e-mail, não o nome do produto. Esse caminho é independente da sessão Access/Clerk do WaPilot.

Workers Builds está conectado ao repositório correto, branch `main`, root `/`, **Disable builds=false**. Comandos efetivos:

```sh
npm ci && if test -f apps/gateway/wrangler.jsonc; then npm run build; else npm run build:gallery; fi
if test -f apps/gateway/wrangler.jsonc; then npx wrangler deploy --config apps/gateway/wrangler.jsonc --keep-vars; else npx wrangler deploy --keep-vars; fi
```

Filtros efetivos:

- Include: `apps/gateway/*`, `apps/dashboard/*`, `apps/mcp-gallery/*`, `packages/contracts/*`, `packages/evolution-client/*`, `public/*`, `third_party/*`, `migrations/*`, `scripts/*`, `package.json`, `package-lock.json`, `tsconfig*.json`, `.node-version`, `.nvmrc`, `src/*`, `ui/*`, `wrangler.jsonc`.
- Exclude: `*.md`, `docs/*`, `prototype/*`. Nenhum deploy hook definido na tela.

O histórico mostra builds de `main`; as linhas recentes estavam `Ready`, sem execução pendente visível. Isso não prova uma fila vazia nem impede corrida posterior. Portanto um merge/push elegível pode publicar e promover tráfego. A preparação manual só é segura com a pausa e o controle de concorrência do passo 2; `--keep-vars` não preserva o código endurecido contra outro build.

| Aplicação Access legada | ID | Destinos | Política Allow |
| --- | --- | --- | --- |
| connections | `8fd35c64-0121-4377-8c70-1951ef36f54f` | `app.wapilot.com.br/connections` e `/admin` | `2cffeb27-2080-4bf0-9607-4f107c5eabf6` |
| authorization | `29820208-9610-4706-aa44-58cce5760329` | `app.wapilot.com.br/authorize` | `3a7f9873-1b1b-466d-bd7e-7979208c6ff6` |
| api | `52e1e934-946c-49df-944a-86e244c9c493` | `app.wapilot.com.br/api` | `155cdd8e-f7e7-44fc-a901-c3d79d212917` |

Cada app tem uma política Allow visível, duração de 24 horas, incluindo os dois e-mails operacionais e exigindo one-time PIN. Não apareceu policy adicional ou bypass nessas tabelas. As audiences foram conferidas e guardadas somente no snapshot privado; não foram lidos os valores dos Secrets do Worker nem demonstrada sua igualdade com os apps. A tela não oferece export visível. Isso não comprova ausência de outros mecanismos ou escopos Access.

Com esses IDs confiáveis, foram tentados os GETs oficiais de cada app e policy: seis leituras pelo escopo conta retornaram `403/1010`; as seis equivalentes pelo escopo zona, `403/10000`. Nenhum JSON oficial pôde ser exportado. A lista `200` vazia era incompleta e não demonstrava ausência de proteção.

O helper Terra salvou um registro de leitura fora do repositório, copiado depois para diretório local privado durável (`0700`, arquivos `0600`): `access-readback.md` (SHA-256 `84e629e646837fcec54f5399df76fdef9641d43d6db650704b11debae6e44d9c`), três arquivos de audience e `build-readback.md` (`c6fcee57acc37824f10f620b092699f7cbb747bdb301db8dbed45a5d6cec9df5`). O destino foi resolvido por `git-common-dir` na worktree principal: `.scratch/validation/issue61-return-private-20261113T222633Z-27e88ce3/`, cinco arquivos, `git check-ignore` confirmado pela regra `.scratch/validation/`. Nenhum arquivo existente foi sobrescrito. O registro contém os campos necessários para devolver os destinos observados mantendo os objetos existentes: IDs, paths, policies/regras, duração e audiences. Não é export completo e não inclui opções extras, IdPs/issuer/JWKS, escopo do token ou vars/secrets de build; esses campos devem permanecer intocados. A publicação da fundação não altera Access e não depende de recriar IDs/audiences ou obter um export integral. Um corte futuro só pode alterar campos cujo antes/depois esteja registrado e seja reversível no mesmo objeto; se exigir outro campo, completar o registro antes dessa alteração. Não excluir/recriar apps/policies. Nenhuma policy ou configuração foi alterada.

Probes externos repetidos às **22:22:48 UTC**, sem cookies/bearer: `/healthz` e `/.well-known/oauth-protected-resource/mcp` retornaram `200`; `POST /mcp`, `401` com `no-store` e `resource_metadata`, sem challenge Access. `/connections`, `/authorize`, `/admin` e `/api/connections` retornaram `302`/`no-store` para o gateway Access. Isso comprova o comportamento desses requests e a independência da descoberta/MCP, sem comprovar a autorização D1 ou continuidade de um grant real.

## Sequência de restauração preparada

A janela acima executou a fundação e sua correção, preservando esta ordem de preflight/grant anterior/publicação/read-back. Os comandos de restauração continuam reservados a uma operação **futura e explicitamente autorizada**; nenhum rollback foi executado. O artefato e ID de retorno abaixo estão atualizados para a versão final. Para toda chamada Wrangler com bindings reais, usar `WRANGLER_WRITE_LOGS=false` (suportado pela versão fixada), capturar stdout/stderr somente em memória no subprocesso e emitir apenas resumo sanitizado de status/versão/checks. A saída padrão do CLI contém valores de vars; não encaminhá-la ao terminal, chat ou arquivo bruto. `WRANGLER_LOG=error` sozinho não impede o arquivo debug automático.

1. Lucca é o solicitante/dono responsável desta rodada. Preservar a cópia privada de leitura de Access e Workers Builds, com IDs, policies, paths, audiences, duração, login e filtros/comandos. O Dashboard Cloudflare autenticado é o caminho administrativo independente do login WaPilot. Reler versão, bindings, Queue consumers, Cron, imagem Container e redaction na janela autorizada. A fundação não exige alterar Access; preservar os objetos, seus Secrets e todos os campos não capturados.
2. Preparar a revisão Access `16452515cd819d85557894821225937a9f26b660` numa worktree separada e limpa, `issue61-access-redaction`, recriando a worktree a partir desse SHA retido e instalando dependências com `npm ci`, usando Wrangler `4.150.0`; não executar a publicação a partir da candidata Clerk. Preservar essa worktree e seu `node_modules` até a janela. Confirmar que nenhuma publicação posterior exige nova reconciliação; repetir checks/dry-run se o alvo ou código mudou. O artefato está preservado por merge `ours` no histórico da integração, sem substituir sua árvore Clerk. **Com autorização específica**, pausar Workers Builds para `main`, conferir ausência de builds em execução/fila e de publicação manual concorrente, e registrar o estado anterior. A pausa deve anteceder o deploy: `main=084d530` não contém a fundação segura, e um push elegível pode sobrescrevê-la. Manter a pausa até reconciliar um `main` seguro e validar separadamente sua publicação automática; reativar Builds exige decisão explícita. A pausa foi executada na janela acima; não houve merge/push em `main` ou alteração dos demais triggers/comandos.
3. Ainda **antes de publicar**, criar um cliente e grant **descartáveis** sob login Access autorizado, conforme o procedimento abaixo. Código, bearer e refresh devem ser emitidos pela versão antiga, e sua linha de base deve passar. Guardar os tokens anteriores sem renová-los até a prova posterior; não usar grant cotidiano. Se a emissão/linha de base falhar ou o bearer não cobrir a janela, interromper antes do deploy. Na janela autorizada acima, um único grant real descartável foi criado e depois revogado.
4. Com autorização explícita para a fundação segura, publicar **essa revisão Access** na conta/Worker conferidos, preservando vars, segredos e Container. Não executar `secret put/delete`, migrations remotas ou alterações de políticas como efeito implícito. Formato validado na ajuda do Wrangler instalado:

   ```sh
   WRANGLER_WRITE_LOGS=false CLOUDFLARE_ACCOUNT_ID=e972fc5484db86f0468fa2cf78f61870 npx wrangler deploy --env '' --profile wapilot --keep-vars --containers-rollout none --message 'Access com autorização D1 e query redigida; retorno preparado #61'
   ```

   O deploy também pode tentar reconciliar Queue consumers. Uma falha depois do upload pode deixar a nova versão ativa; reler deployment/versão e consumidores antes de qualquer repetição. Conferir se os recursos e a configuração exigem um caminho operacional diferente antes de autorizar esse comando.
5. Ler `deployments list`, `versions view` e settings novamente e registrar o ID real da **versão Access endurecida validada**, em 100%, com seus bindings, políticas e `observability.redact_query_string=true`. Validar login Access autorizado e repetir as leituras com o **mesmo bearer anterior**; depois trocar o **refresh emitido antes do deploy** e repetir a leitura. Comparar escopos e resultados com a linha de base, sem novo consentimento OAuth; negativas de ausência/desativação continuam em fixtures locais, sem desativar administradores reais. O ID seguro final conferido é `6af1ec15-cef2-4f01-b4c6-31c0c21e64dc`. Não usar `c8936c3f…` ou outra versão antiga não endurecida como atalho. A flag publicada final é `true`, conferida por read-back; convites Clerk de produção ainda dependem dos demais gates próprios.
6. Somente após os demais gates da #59, um corte Clerk separado pode ocorrer. Antes dele, manter os três secrets Access e o registro privado das políticas/configuração de retorno disponíveis. Preservar os mesmos apps/policies; mudar apenas campos com estado anterior e posterior registrados, reversíveis nesses objetos. Conferir e completar qualquer campo adicional que o corte realmente precise alterar. Para esse corte posterior, repetir a emissão/linha de base de um cliente/grant descartável enquanto o Access endurecido ainda está ativo. É outra fronteira de versão, independente da prova anterior à fundação; não revogar grants cotidianos para testar.
7. Se o corte precisar voltar, restaurar primeiro os campos de cobertura/políticas efetivamente alterados nos mesmos objetos Access, nas rotas de navegador aprovadas, sem proteger `/mcp` ou a descoberta OAuth com challenge Access. Confirmar o gateway ativo antes de servir novamente um backend que confia em sua assertion. Restaurar a versão endurecida final por seu ID conferido:

   ```sh
   WRANGLER_WRITE_LOGS=false CLOUDFLARE_ACCOUNT_ID=e972fc5484db86f0468fa2cf78f61870 npx wrangler rollback 6af1ec15-cef2-4f01-b4c6-31c0c21e64dc --name mcp-evolution-cloudflare --env '' --profile wapilot --message 'Retorno autorizado do login WaPilot'
   ```

   Usar o painel independente e o registro privado dos campos alterados; não excluir/recriar apps ou policies nem modificar os campos preservados. O registro de leitura não autoriza a mutação. Se o rollback não for permitido pelas regras de lifecycle/recursos da Cloudflare, interromper e preparar uma publicação da revisão compatível com a configuração atual, sem restaurar banco antigo.
8. Reler a versão em 100%; validar os três probes públicos, login Access autorizado, conexões corretas, consentimento, leitura e refresh do grant descartável anterior, escopos, `no-store` e negativas. Preservar D1/KV, migration `0011`, vínculos Clerk, contas `disabled`, revogações e invalidações. Registrar horários, falhas por superfície e decisão do responsável; só encerrar a janela após read-back e aceite.

## Cliente descartável: prova anterior e posterior à fundação

Procedimento reservado à janela de produção **explicitamente autorizada**, após pausar Builds e antes do passo 4 da sequência de restauração. Usa Node e o SDK MCP já instalados na worktree Access; não exige pacote, infraestrutura, endpoint de fixture ou bypass novo. Não reutilizar o cliente/estado do perfil development nem executar `src/dev/stdio.ts`. O fluxo existente de testes locais continua cobrindo contas ausentes/desativadas e falha transitória D1.

1. Criar estado exclusivo em novo diretório ignorado `.scratch/validation/issue61-oauth-DATA-UNICA/` da worktree principal, `0700`, sem sobrescrever. Manter código, PKCE verifier, bearer e refresh somente na memória do cliente ou arquivo `0600`; logs e evidências recebem apenas horários, status, escopos e comparações sanitizadas. Não imprimir respostas de token, callbacks com código, cookies ou URLs portadoras. Usar callback temporário em `127.0.0.1` com porta livre, sem ocupar as portas de development nem publicar receptor externo.
2. Descobrir a metadata OAuth da origem canônica e registrar **um cliente público descartável** em `/oauth/register`, identificável como `WaPilot #61 descartável DATA`, com `token_endpoint_auth_method=none`, callback loopback e grants `authorization_code`/`refresh_token`. Seguir o desafio de escopos da operação e incluir `offline_access` para a prova de refresh. Não modificar cliente existente, KV ou grants cotidianos diretamente.
3. Iniciar PKCE S256 para o recurso canônico `https://app.wapilot.com.br/mcp`, validar `state` e issuer conforme a metadata, abrir `/authorize` no navegador e concluir o login Access/consentimento como usuário existente autorizado, após confirmar seu vínculo D1 `active` na janela aprovada. Se o vínculo estiver ausente/desativado, interromper; não criar ou reativar uma conta para a fixture. Trocar o código em `/oauth/token` com `client_id`, `redirect_uri`, `code_verifier` e `resource`. Exigir bearer **e refresh** válidos, guardar escopos/expiração e confirmar que o bearer atravessa a janela prevista; expiração natural não comprova regressão. Não copiar assertion Access/cookie para o cliente MCP.
4. Antes do deploy, usar esse bearer para `server/discover`, `tools/list` e `tools/call` de `list_connections`, sem enviar mensagens. Usar MCP `2026-07-28`, headers `MCP-Protocol-Version` e `Mcp-Method`; em `tools/call`, também `Mcp-Name: list_connections`. Toda request carrega `params._meta` com `io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientInfo` e `io.modelcontextprotocol/clientCapabilities`, como o padrão já testado em `test/mcp-messages.test.ts`. Exigir JSON válido/sem erro, sem sessão de transporte, e guardar apenas a comparação privada necessária de identidade/escopos/conexões, não os dados completos.
5. Registrar que essa linha de base ocorreu sob o deployment antigo e então executar o passo 4 da sequência de restauração (publicação). Após o read-back da versão segura, repetir as mesmas leituras com o bearer guardado. Só depois enviar `grant_type=refresh_token`, o refresh **pré-deploy**, `client_id` e `resource` a `/oauth/token`; exigir sucesso, mesmos escopos e nova leitura equivalente com o bearer renovado, sem novo consentimento. Em erro, registrar somente status/código sanitizado e interromper o aceite; não recriar usuário/conexão nem revogar outros grants para fazer passar.
6. Ao terminar a prova autorizada, revogar somente a autorização descartável pelo fluxo existente do WaPilot, conferir a revogação desse grant e encerrar callback/cliente. Remover seu estado privado quando não for mais necessário; preservar usuários, conexões e todas as demais autorizações.

A ordem de emissão anterior ao deploy é essencial: um grant criado só depois valida a nova versão, mas não demonstra continuidade. O procedimento segue a [autorização MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) e o contrato [`server/discover`](https://modelcontextprotocol.io/specification/2026-07-28/server/discover), consultados em 13/11/2026. Nenhum fluxo legado `initialize` ou sessão de transporte foi introduzido.

Rollback de código não restaura os recursos ou dados associados e pode ser impedido por mudanças no lifecycle de Durable Objects ou recursos removidos. A sequência segue as [limitações oficiais de rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) e a [distinção de builds, uploads e promoção de tráfego](https://developers.cloudflare.com/workers/ci-cd/builds/), consultadas em 13/11/2026.

## Critérios concluídos de #61

| Critério | Evidência final |
| --- | --- |
| 1 — alvos, proteção, recursos e administração | Conta/Worker/domínio/versão reais, SQL mínimo do dono, recursos/vars preservados, Access conferido, painel independente e snapshot privado durável |
| 2 — automação | Branch/comandos/filtros conferidos; Builds pausado e histórico paginado sem execução pendente antes dos uploads; manter a pausa até `main` seguro |
| 3 — fundação publicada | Bundle servido da versão 160 com D1 `active`, sem autocadastro, callback D1 para código/refresh e identidade legada preservada |
| 4 — revisão endurecida | `1645251`, typecheck, 12 testes, dry-run e duas revisões Sol xhigh sem achados; `no-store` real confirmado |
| 5 — grants anteriores | Duas transições com o mesmo grant, bearer/refresh anteriores e escopos/conexão preservados; grant próprio revogado, bearer 401, outros seis intactos |
| 6 — retorno compatível | Artefato `1645251` e versão final `6af1ec15…`, preservando histórico/eventos nativos e os recursos conferidos; objeto retido por merge `ours`, sem sobrepor Clerk |
| 7 — restauração executável | ID final e comandos acima, Access nos mesmos objetos, sem rollback de dados/identidades/revogações e com Builds sob controle; rollback não foi executado |
| 8 — evidência e limites | Horários, versões, hashes, mocks separados das provas conectadas, limitação dos escopos e disponibilidade por amostragem registrados |

O merge documental foi integrado em `42caafb0eaf30421fc77f7edf2e31673d5d5dca0`; as revisões finais Standards e Spec terminaram sem achados. As duas worktrees temporárias da #61 e suas dependências foram removidas após a validação; o artefato Access e o histórico documental permanecem alcançáveis pelo Git da integração. Para uma operação futura, recrie uma worktree limpa no SHA Access acima e execute `npm ci`; não dependa dos diretórios desta rodada.

O corte Clerk, produção Clerk e #63–66 permanecem fora desta execução. Builds continua pausado até reconciliação segura e decisão explícita de reativação.
