# Checkpoint Clerk — 16/11/2026 UTC

Continuação das issues #59, #64 e #66, após a confirmação pessoal de Heitor às 16:44 UTC sobre convite, redirect e saída/entrada. Essa confirmação permite retomar a finalização autorizada, mas não comprova acesso ao dashboard/API/admin do Worker. O histórico do grupo é parcial e não é reproduzido neste registro.

## Ambiente e vínculo administrativo

O read-back às 22:02 UTC encontrou o Worker `mcp-evolution-cloudflare` em 100% na versão `a87bc5c9-0fe5-4d27-b13f-7fa7c6cfc50f`, fonte `7694e1367753d98a1491d86491afba5f808251f5` (#73). Isso substitui o checkpoint de versão do corte, sem atribuir a publicação paralela a esta operação.

A aplicação Clerk continua `app_3M1uSBQzCMOfMfnraVHBpldbNhx`, production `ins_3M6CtiWpQ9IezNbz9MyNmpRhk6C`. A leitura administrativa por ID confirmou o e-mail primário verificado de Heitor e ausência de banimento/bloqueio. A linha D1 existente estava ativa, sem vínculo e sem pendência.

Uma atualização SQL privada recebeu revisão independente GPT Sol xhigh. Após nova leitura imediata do inventário, foi executada uma vez às **22:05:31 UTC**: exatamente uma linha alterada, somente `clerk_user_id` e `updated_at`. A leitura posterior confirmou vínculo único, dois usuários ativos vinculados, três conexões e zero violações de FK. Todas as demais colunas dos usuários e todos os campos das conexões, incluindo IDs, propriedade, padrão e hashes das cifras, permaneceram iguais ao snapshot imediatamente anterior. IDs/propriedade/defaults/cifras também coincidiram com o inventário do corte de 15/11.

Não houve convite novo, mudança de estado/e-mail, novo QR, transferência, recriptografia ou revogação de grant nesta operação. SQL preenchido e inventários privados permanecem ignorados pelo Git.

## Provas publicadas e navegador

Às 22:05:50 UTC, os probes amostrados na origem canônica confirmaram `/healthz` e metadata OAuth 200, `/mcp` sem bearer 401 com `resource_metadata` e `no-store`, e APIs sem sessão 401 JSON com `no-store`, inclusive com `Accept: text/html`. O conector MCP autenticado conseguiu ler o histórico retido nesta execução; isso não é prova nova de refresh.

GPT Terra confirmou redirecionamento HTML de `/connections` e `/admin` ao login, negativas das APIs e avanço por Enter até a verificação por e-mail. A captura móvel deslogada em 390 × 844, escala 1, mostrou cabeçalho único; escala 3 reproduziu mosaico de captura. Isso resolve a dúvida sobre aquela captura deslogada, sem homologar o painel móvel autenticado.

Não havia sessão legítima utilizável de Lucca nem de Heitor no navegador de teste. Um código de login de Lucca foi solicitado uma única vez; o Gmail conectado pertence a outro endereço e não permite concluir esse login. A aba permanece disponível para autenticação pelo titular. Não foram criadas sessões por impersonação.

## Estabilização e retorno preservado

O prazo mínimo terminou às **2026-11-16T16:46:15.143Z**, mas a estabilização ainda não está encerrada. O read-back das 22:03 UTC confirmou a versão segura de retorno `726e4a6c-7314-4878-af52-748097205deb` disponível e o mesmo KV OAuth. Os bindings de secrets de cifra/consentimento/Clerk/Access foram conferidos por nome na **versão ativa**; isso não afirma que o retorno Access tenha secret Clerk. A consulta Access no escopo da zona às 22:14 UTC confirmou três aplicações, cada uma com uma policy, mantidas nos paths `/__access-retorno-20261115/`. A consulta no escopo da conta retornara zero e não foi usada como prova de ausência. Não houve nova comparação histórica de AUD. GPT Terra recarregou o Dashboard e confirmou `Disable builds=true`, branch `main`, sem alterar a configuração.

A observabilidade publicada mantém logs habilitados, invocation logs desligados, traces desligados e redaction de query habilitada. A consulta aos registros retidos entre 15/11 16:46 e 16/11 22:07 UTC encontrou 745 registros `mcp_http`: 609 com status 200 e 136 com 202. Esses registros não representam todas as requisições. As 14 exceções de validação de `resourceMetadata.resource` foram reconciliadas pela estrutura aninhada do evento: todas eram `GET` HTTP na raiz pública `/`, sete na versão do corte e sete na versão atual. O construtor OAuth rejeitava o recurso HTTP antes de chegar ao roteamento, ao Clerk ou ao serviço de mensagens. Não foram exceções dessas outras superfícies.

As provas de continuidade/refresh e a revogação dos dois grants descartáveis de 15/11 permanecem evidências históricas, separadas deste checkpoint. Nenhum grant diário foi revogado. Os cinco arquivos de tokens já removidos não foram recriados para esta operação.

## Correção HTTP publicada

A reprodução local demonstrou a mesma exceção para HTTP público. A correção no entrypoint responde `308` para a mesma URL em HTTPS com `no-store`, antes de construir o Provider; preserva método, corpo não consumido, caminho/query e o HTTP de loopback do desenvolvimento. O contrato HTTPS/OAuth/MCP permanece igual.

Implementação delegada com esforço medium e revisão independente GPT Sol xhigh, sem achados bloqueantes. Dez casos novos de fronteira e quatro testes de consentimento passaram; a suíte completa aprovou **1006 testes, 23 pulados**, com assets e typecheck aprovados. O dry-run do pacote passou sem warnings usando configuração privada exclusiva de produção, vars atuais, mesmos D1/KV e imagem sender conferida na versão ativa.

O [PR #74](https://github.com/luccamordente/mcp-evolution-cloudflare/pull/74) foi integrado no commit `e66c582f5e846178a30b98bb10d83fcdc60badf1`. A candidata foi relida inativa, com bindings/secrets, compatibilidade e imagem idênticos aos anteriores, e promovida a 100% às **22:23:59 UTC**, versão **`0f73662e-bc2d-4700-abf3-49abceba2bc4`**. A atribuição ao fonte usa a árvore Git idêntica ao `main`, recibo do upload e tag `http-e66c582`; a API desta versão não retornou annotation `workers/commit_sha`. Nenhum `secret put/delete` foi usado.

Às **22:24:44 UTC**, o read-back confirmou essa versão em 100%, bindings/secrets e observabilidade preservados, mesma imagem sender, dois usuários ativos vinculados, três conexões idênticas e FK zero. As 23 chaves `grant:` preexistentes não expiradas permaneciam presentes; esse número é o inventário de chaves desta operação, não uma recontagem histórica dos seis grants diários de 15/11. O retorno Access seguro continuava disponível.

Os probes reais confirmaram GET HTTP `/` e POST HTTP `/mcp` com 308 e `no-store`; health/discovery HTTPS 200; MCP HTTPS sem bearer 401 com metadata OAuth; APIs sem sessão 401 JSON `no-store` e HTML de dashboard/admin redirecionado ao login. Uma leitura autenticada de conexões pelo conector passou depois do deploy, sem status live nem mensagens. Não houve teste novo de refresh nem homologação das sessões pessoais, nem medição contínua de disponibilidade.

## Gates restantes

- Sessões reais das duas pessoas: dashboard, somente suas conexões, APIs e painel administrativo; renovação e painel móvel autenticado.
- Verificação final OAuth/MCP/refresh e inventário, sem revogar autorizações diárias.
- Concluir as verificações de estabilidade com sessões reais e refresh final, sem alegar observação contínua ou indisponibilidade zero.
- Após os gates, encerrar o legado Access pela operação autorizada e documentar o efeito sobre o retorno; até lá, preservar aplicações, policies, secrets e artefato seguro. Builds não foi reativado.

As issues #59, #64 e #66 permanecem abertas. O estado privado conserva a confirmação e o vínculo concluído, para retomar as verificações sem exigir confirmação idêntica nem consultar o grupo fora do intervalo de quatro horas. Nenhuma conclusão de homologação é inferida dos testes locais históricos ou dos mocks.
