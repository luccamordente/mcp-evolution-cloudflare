# Preflight do corte Clerk — 15/11/2026 UTC

Este registro complementa os checkpoints históricos de [preparação](clerk-production-2026-11-14.md) e [vínculo](clerk-identity-linking-2026-11-14.md). As leituras externas abaixo foram realizadas e reportadas pelo responsável operacional; a reconciliação local não operou serviços ou credenciais.

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
