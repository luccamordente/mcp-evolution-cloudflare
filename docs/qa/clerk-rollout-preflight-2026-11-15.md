# Preflight do corte Clerk — 15/11/2026 UTC

Este registro complementa os checkpoints históricos de [preparação](clerk-production-2026-11-14.md) e [vínculo](clerk-identity-linking-2026-11-14.md). As leituras externas abaixo foram realizadas e reportadas pelo responsável operacional; a reconciliação local não operou serviços ou credenciais.

## Retorno corrente conferido pelo responsável

O preflight de **2026-11-15T04:28:50Z** encontrou a versão Access **`94ee520f-a4af-4a0c-8be7-8bf7f5cc3f6c` em 100%**, fonte `33eefb3d38c7a4675849903e9545dba2361cd4d2`, tag `api6-cleanup-33eefb3`. Não havia bindings Clerk e `observability.redact_query_string=true` estava habilitado. Esse é o retorno corrente neste checkpoint; `8e9211a5…` e `6af1ec15…` permanecem referências históricas, e a candidata Clerk `353fcb1e…` exige reconciliação com o cleanup antes da promoção.

GPT Terra confirmou no Dashboard `94ee520f…` como Ready em 100%, **Disable builds ligado**, `main` como branch de produção e ausência de deploy hooks. Comandos e filtros do build não foram observados; o Dashboard pediu nova autenticação GitHub. Foram conferidas as mesmas três aplicações Access, com policy Allow para os dois e-mails operacionais, PIN e sessão de 24 horas. O plano autorizado usa deploy controlado e mantém Builds desabilitado; reativação automática não faz parte desse escopo.

## Reconciliação e autorização

A [autorização posterior](clerk-identity-linking-2026-11-14.md#autorização-posterior-para-corte-e-integração) inclui publicação Clerk, PR e merge no `main`, com aceitação de Heitor explicitamente adiada. A conta D1 existente deve permanecer ativa, sem vínculo até a verificação/read-back, sem recriação, desativação ou pendência forjada. Grants legados continuam sujeitos à barreira D1; o navegador Clerk nega acesso até o vínculo verificado. A homologação pessoal de Heitor permanece pendente.

A árvore reconciliada incorpora a integração Clerk, o cleanup `33eefb3…` e o commit local `8fc125d30fbaa4fc5469385fdac0c2b53a4734eb`, preservando as seis ferramentas, budgets absolutos de mídia, mensagens sanitizadas, OAuth/KV, migrations e isolamento das credenciais. O build usa somente o comprovante e o asset de autenticação; não restaura galeria, aliases de teste ou automação de Builds.

A validação local em `3e3a16a0d757ddd02ab8d45014e88302a583613f` concluiu `npm run check` com exit code 0: assets auth/receipt e tipos conferidos, **837 testes aprovados e 15 pulados**, 55 arquivos aprovados e um pulado, em 107,13 segundos. Esses testes usam fixtures e não comprovam login, continuidade de grants ou homologação em produção. O dry-run privado/coerente, o upload, a promoção, os probes e a validação canônica pertencem ao responsável operacional; este registro não os declara executados.
