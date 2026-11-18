# Consolidação local — 18 de novembro de 2026

## Inventário e decisão

A consulta ao GitHub encontrou zero PRs abertas. O checkout principal tinha um parágrafo de referências pendente e dois planos de eventos não rastreados. Havia 13 branches locais e duas worktrees auxiliares registradas, ambas sem alterações rastreadas ou arquivos não rastreados pendentes; uma delas continha apenas um link ignorado para `node_modules`.

A referência de integração é `origin/main` em `9fa0eaab94f80eb3118e205d73594e924fb18ffa`. Não foi feita publicação nem alteração de infraestrutura nesta consolidação.

## Conteúdo preservado

- O parágrafo pendente foi reconciliado com os nomes atuais dos documentos, sem repetir a afirmação histórica de que o backend ainda não cria eventos.
- O handoff local era idêntico a `docs/plans/NATIVE-EVENTS-EVOLUTION-HANDOFF.md` no main; foi mantida a cópia canônica.
- O plano local de integração era um rascunho mais antigo. Ele foi preservado em `docs/plans/NATIVE-EVENTS-WAPILOT-2026-11-11-DRAFT.md`, sem substituir o plano mais recente.
- O registro da publicação original do contrato MCP, ausente no main, foi preservado em `docs/qa/mcp-agent-contract-production-2026-11-15.md`, com uma nota sobre a conclusão posterior do envio ao grupo e integração pela PR #71.
- O commit local `d05bb59` preserva os três arquivos pendentes em sua forma original antes da reconciliação.

## Históricos reconciliados

| Grupo | Verificação e tratamento |
| --- | --- |
| `archive/local-commits-*` | Envio unificado, auditorias e relato de publicação já incorporados ao main. A referência de deployment `d26781ee…` também está no documento atual. |
| `evolution-history-read-contract` e histórico nativo em `release/api5-local-history` | O main contém os schemas nativos, relações paginadas e testes de histórico, com alterações posteriores de diagnóstico. |
| `feat/animated-gif-media` | GIF, PDF e comprovantes já estão no main. O script de aceitação GIF foi substituído explicitamente pelo commit `9fa0eaa`; a galeria foi removida pelo cleanup. Não foram restaurados os scripts aposentados. |
| `fix/secret-encrypted-update` e `release/mcp-agent-contract` | As pontas já eram ancestrais do main. |
| `release/cleanup-local-history` e `release/contacts-local-history` | `git cherry` não encontrou patches pendentes; as implementações equivalentes já estão no main. |
| `main` local e branches `release/mcp-api-*` | Funcionalidades e descrições integradas pela PR #71; o main inclui também Clerk, budgets totais de leitura e estados de observação posteriores. O relato de QA exclusivo foi preservado separadamente. |

As pontas locais são incorporadas ao histórico do main com uma merge de reconciliação que mantém a implementação corrente. Isso preserva os commits originais sem ressuscitar APIs removidas, autenticação anterior ou snapshots antigos. A revisão não introduz alterações de runtime em relação ao main inicial.

### Pontas locais encontradas

| Branch | Commit inicial |
| --- | --- |
| `archive/local-commits-20261111-175205` | `589253dc2bbc` |
| `evolution-history-read-contract` | `2f4d4e83d285` |
| `feat/animated-gif-media` | `70ac5a44cd1a` |
| `fix/secret-encrypted-update` | `b9ff711da8eb` |
| `main` | `7c2ad1d8f70a` |
| `release/api5-local-history` | `d9a3ffcae8eb` |
| `release/cleanup-local-history` | `bd9d9b4bb66b` |
| `release/contacts-local-history` | `a3acc344850d` |
| `release/mcp-agent-contract` | `eec3ed69d3aa` |
| `release/mcp-api-descriptions` | `0ed68f764a0e` |
| `release/mcp-api-descriptions-local` | `f74859e06b91` |
| `release/mcp-api-qa-local` | `e2d6af104953` |
| `release/mcp-api-verified` | `0ed68f764a0e` |

## Validação e limpeza

`npm run check` passou sobre a árvore reconciliada: 1.006 testes aprovados e 23 ignorados, em 59 arquivos aprovados e dois ignorados. O typecheck e as verificações de assets também passaram. Oito links locais dos documentos reconciliados foram conferidos. A comparação com o main inicial mostrou alterações somente nos quatro documentos listados, sem mudança de runtime.

As 14 pontas locais existentes durante a integração (as 13 originais mais a branch temporária de consolidação) foram conferidas como ancestrais da árvore consolidada. O procedimento de conclusão publica o main com avanço normal, verifica o SHA remoto e remove as duas worktrees auxiliares e as branches locais diferentes de main.

Um bundle Git com os refs iniciais, o patch do checkout e cópias dos arquivos não rastreados foi preservado em diretório privado fora do repositório. O arquivo é recuperação histórica, não uma branch pendente. Nenhum segredo, binding remoto ou estado local ignorado do checkout principal foi removido.
