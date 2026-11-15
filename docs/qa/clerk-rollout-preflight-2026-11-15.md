# Preflight do corte Clerk — 15/11/2026 UTC

Este registro complementa os checkpoints históricos de [preparação](clerk-production-2026-11-14.md) e [vínculo](clerk-identity-linking-2026-11-14.md). As leituras externas abaixo foram realizadas e reportadas pelo responsável operacional; a reconciliação e esta atualização documental não operaram serviços ou credenciais. O [registro do corte executado](#corte-executado-em-produção) sucede os checkpoints históricos de preparação.

## Checkpoint histórico inicial conferido pelo responsável

O preflight de **2026-11-15T04:28:50Z** encontrou a versão Access **`94ee520f-a4af-4a0c-8be7-8bf7f5cc3f6c` em 100%**, fonte `33eefb3d38c7a4675849903e9545dba2361cd4d2`, tag `api6-cleanup-33eefb3`. Não havia bindings Clerk e `observability.redact_query_string=true` estava habilitado. Esse era o retorno naquele checkpoint; `8e9211a5…` e `6af1ec15…` permanecem referências históricas, e a candidata Clerk `353fcb1e…` exige reconciliação com o cleanup antes da promoção.

GPT Terra confirmou no Dashboard `94ee520f…` como Ready em 100%, **Disable builds ligado**, `main` como branch de produção e ausência de deploy hooks. Comandos e filtros do build não foram observados; o Dashboard pediu nova autenticação GitHub. Foram conferidas as mesmas três aplicações Access, com policy Allow para os dois e-mails operacionais, PIN e sessão de 24 horas. O plano autorizado usa deploy controlado e mantém Builds desabilitado; reativação automática não faz parte desse escopo.

## Reconciliação e autorização

A [autorização posterior](clerk-identity-linking-2026-11-14.md#autorização-posterior-para-corte-e-integração) inclui publicação Clerk, PR e merge no `main`, com aceitação de Heitor explicitamente adiada. A conta D1 existente deve permanecer ativa, sem vínculo até a verificação/read-back, sem recriação, desativação ou pendência forjada. Grants legados continuam sujeitos à barreira D1; o navegador Clerk nega acesso até o vínculo verificado. A homologação pessoal de Heitor permanece pendente.

A árvore reconciliada incorpora a integração Clerk, o cleanup `33eefb3…` e o commit local `8fc125d30fbaa4fc5469385fdac0c2b53a4734eb`, preservando as seis ferramentas, budgets absolutos de mídia, mensagens sanitizadas, OAuth/KV, migrations e isolamento das credenciais. O build usa somente o comprovante e o asset de autenticação; não restaura galeria, aliases de teste ou automação de Builds.

A validação local em `3e3a16a0d757ddd02ab8d45014e88302a583613f` concluiu `npm run check` com exit code 0: assets auth/receipt e tipos conferidos, **837 testes aprovados e 15 pulados**, 55 arquivos aprovados e um pulado, em 107,13 segundos. Esses testes usam fixtures e não comprovam login, continuidade de grants ou homologação em produção. O dry-run privado/coerente, o upload, a promoção, os probes e a validação canônica pertencem ao responsável operacional; este registro não os declara executados.


## Novo preflight após publicação paralela

O responsável operacional reportou em 15/11/2026 que a versão em 100% passou a ser `f5c7ee20-6c31-481b-b24a-fcbfdcda420c`, criada às 14:44 UTC e publicada às 14:45 UTC, fonte `97d255473d6a24eec5f7c10cff16c85c3f21ad37`, tag `agent-contract-97d2554`. O retorno `94ee520f…` acima e a candidata Clerk anterior são checkpoints históricos, sem validade como estado corrente. A nova publicação não alterou os recursos/bindings comparados pelo responsável; isso não equivale a promover Clerk.

A reconciliação local parte de `a8eea67` (PR #69, incluindo #67) e incorpora integralmente `97d2554`: seis ferramentas, descrições e instruções de recuperação, erros acionáveis, resultados parciais, anexos e migration `0012_send_action_conflict.sql`. Preserva sessão Clerk exclusiva no navegador, vínculo ativo D1, chave OAuth por e-mail canônico, CSRF, UI pt-BR, isolamento local e prazos absolutos de mídia. A migration foi apenas incorporada ao código, sem aplicação remota nesta etapa. O responsável ainda fará a conferência final de fonte, recursos, migrations e publicação; nenhum corte de tráfego ou aceite de produção é declarado por esta integração.


A integração do contrato foi congelada em `8051f942a99fd08d65586b9c131e58441f40d2af`, com ajuste documental em `21ce943…`. `npm run check -- -- --maxWorkers=1` passou com exit code 0: assets auth/receipt, tipos e **948 testes aprovados e 15 pulados**, 56 arquivos aprovados e um pulado, em 192,66 segundos de Vitest. As regressões exercitam os prazos compartilhados pelo handler MCP, erros sem MIME privado, recuperação/resultados parciais e recusa de link de anexo após desativação D1 antes de acesso remoto. O teste novo de desativação primeiro reproduziu HTTP 200 indevido e passou após a barreira ativa. Essas provas são locais e sintéticas; não aplicam migrations remotas nem comprovam login, entrega ou homologação em produção.


### Ajustes após revisão do contrato

O código/configuração foi congelado em `093e63e9c2fd74e2cfca03824ffe4f2329423245`. O MIME inválido do provedor é normalizado na projeção pública, preservando o texto disponível em JSON e os erros parciais das opções incompatíveis, sem refletir o valor bruto. A configuração mantém logs sanitizados da aplicação e redação de query, mas desabilita logs automáticos de invocação e traces para não registrar capacidades de anexos no path. Isso é configuração do artefato local, sem afirmação de alteração live.

Os testes dos achados reproduziram cinco falhas antes do ajuste. Após a correção, typecheck e **321 testes focados** passaram. O novo `npm run check -- -- --maxWorkers=1` passou com exit code 0: assets, tipos e **950 testes aprovados e 15 pulados**, 56 arquivos aprovados e um pulado, em 175,70 segundos de Vitest. Não houve mudança de código após esse congelamento, aplicação remota de migrations ou publicação nesta etapa.


## Corte executado em produção

O PR #71 foi integrado ao `main` em **2026-11-15T16:33:44Z**, fonte `47c05b498fc2104854d996b5b85efaef176a1216`, com árvore equivalente à candidata revisada `a145fcd…`. A janela operacional começou às **16:38:24 UTC**, com orçamento de 30 minutos. O comando de publicação terminou com exit code 0 às 16:38:27 UTC, e o read-back confirmou Clerk `1b4fab97-3e69-485c-94c9-5ce4096c0aac` em **100%**. O retorno Access seguro `726e4a6c-7314-4878-af52-748097205deb`, fonte `cdd4a73ca5d4035e47e6a1320e5e30b82a6ecab7`, foi preparado inativo, preservando o contrato `97d2554…`, a barreira D1 ativa e a proteção de logs. A publicação paralela `f5c7ee20…` tornou-se checkpoint histórico.

O responsável moveu os quatro paths `/connections`, `/admin`, `/api` e `/authorize`, nas mesmas três aplicações Access, para `/__access-retorno-20261115/{connections,admin,api,authorize}`. O read-back e a navegação posterior passaram. Os mesmos IDs das aplicações e as políticas Allow para os dois e-mails operacionais, com PIN e sessão de 24 horas, foram relidos. Não houve comparação independente dos valores AUD antes/depois; não se declara essa comparação específica. As aplicações/policies e secrets de retorno não foram excluídos. **Disable builds** permaneceu marcado; reativar Builds não fez parte do corte.

### Provas reais após a publicação

Às **16:42:40 UTC**, probes públicos amostrados passaram sem desafio Access: `/healthz` e metadata OAuth retornaram 200; `/mcp` sem bearer retornou 401 `no-store`; navegação HTML em `/connections` e `/admin` retornou 302 para `/sign-in`; APIs retornaram JSON 401 `no-store`, inclusive com `Accept: text/html`. A sessão de navegador Clerk não autenticou `/mcp` (401).

A navegação feita por GPT Terra confirmou a sessão de Lucca e acesso autorizado antes e depois da mudança do gateway: painel com uma conexão própria e visão administrativa com dois usuários ativos/três conexões. APIs autenticadas retornaram JSON 200 `no-store`. Nova aba, renovação após mais de 60 segundos pelo SDK (`getToken` com `skipCache: true`, registrando somente sucesso booleano), nova leitura de API e recarga passaram. Navegação funcional desktop/móvel e acionamento por Enter passaram. A captura móvel teve possível artefato de cabeçalho duplicado; não foi declarada homologação visual completa.

O refresh final pré-janela, às **16:37:33 UTC**, usou o mesmo grant descartável, sem registrar novo cliente, e confirmou uma conexão e os escopos preservados. Às **16:42:53 UTC**, bearer anterior ao corte, refresh original e leitura MCP continuaram funcionando, com os três escopos `mcp:read`, `mcp:write` e `offline_access`, sem alteração no inventário da conexão. Um novo consentimento PKCE pelo navegador Clerk, no mesmo cliente, criou grant distinto e passou na leitura com os mesmos três escopos. Essas provas autenticadas usaram somente leituras, sem envio de mensagens nem status live.

Às **16:43:59 UTC**, os dois grants próprios de teste foram revogados. Os três bearers observados retornaram 401 e os dois refresh tokens retornaram 400 `invalid_grant`; os outros seis grants permaneceram intactos. Os read-backs D1 às **16:40:00** e **16:42:53 UTC** confirmaram dois usuários ativos, um vinculado e três conexões, com IDs, propriedade, cifras e padrões preservados e zero violações de FK. `0011` e `0012` já estavam aplicadas antes do corte; não houve alteração de usuários/conexões nem aplicação de migrations remotas nesta janela.

O read-back ativo confirmou `observability.enabled=true`, `logs.enabled=true`, `logs.invocation_logs=false`, `traces.enabled=false`, `redact_query_string=true`, `logpush=false` e zero tail consumers. Isso confirma a configuração observada da versão publicada; não é prova contínua sobre todas as requisições ou sistemas de logging externos.

### Pendências e limites do aceite

A saída pela UI passou: `/sign-in` apareceu em pt-BR e uma nova aba em `/connections` redirecionou para `/sign-in`, sem desafio Access. O read-back final de versão, inventário e logs passou. A janela terminou às **2026-11-15T16:46:15.143Z**, após **471 segundos (7 min 51 s)**; a estabilização de 24 horas permanece até pelo menos **2026-11-16T16:46:15.143Z**. Cinco arquivos privados com tokens descartáveis foram removidos após os três bearers retornarem 401 e os dois refresh tokens retornarem 400; somente os metadados públicos do cliente permanecem.

A conta Clerk de Heitor já existia no read-back pré-corte, com criação registrada às **14:58:39 UTC** e e-mail primário verificado na consulta. Sua linha D1 permanece ativa e sem vínculo por adiamento explícito. A #64 continua aberta para vínculo e homologação deliberados; não se trata de convite ainda pendente. O corte não declara homologação pessoal de Heitor.

Com o logout confirmado, a #65 pode ser concluída com esse adiamento explícito. #59, #64 e #66 permanecem abertas. A #66 mantém a janela de retorno de 24 horas: preservar Access/secrets, acompanhar a versão e só decidir sua retirada ao final pelo procedimento autorizado. Nenhuma issue foi fechada por esta atualização documental.

Os **950 testes locais aprovados/15 pulados** descritos acima são evidência sintética separada dos read-backs reais, provas OAuth e navegação relatados nesta seção. Os probes e inventários são amostras nos instantes indicados; não demonstram indisponibilidade zero, medição contínua ou compatibilidade visual universal. As evidências operacionais foram lidas somente nos seis registros sanitizados autorizados (`cut-window`, `public-after-paths`, `oauth-continuity-complete`, `oauth-revocation-result`, `midcut-state` e `final-prewindow-renewal`), sem publicar tokens, cookies, URLs privadas ou identificadores pessoais operacionais.
