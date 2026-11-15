# Plano de implementação da leitura de mensagens e de eventos nativos

Atualizado após a implementação do provedor indicada pelo usuário em `/workspace/evolution-go`. A worktree WaPilot deste documento permanece em `eedc5940a395f0476c1f1cd5c054bf82ce89baf2`. O usuário autorizou posteriormente a implementação e commits na branch atual. Publicação, migrations remotas, mensagens reais e push continuam fora do escopo.

O backend já preserva conteúdo nativo e oferece respostas paginadas. Existe também integração de leitura em outro checkout WaPilot. O próximo trabalho nesta worktree é incorporar essa integração verificada, concluir as perdas locais ainda presentes e, em entrega separada, acrescentar envio de evento à ferramenta existente.

## Estado da execução nesta worktree

P0 foi incorporado da integração existente. P1 preserva vCards textuais e metadados de localização/áudio. P2 acrescenta `event` ao envio unificado com normalização de instantes e idempotência. A leitura paginada valida também o tamanho efetivamente retornado. O [registro de validação](qa/native-history-implementation.md) separa os testes executados das limitações. As seções abaixo preservam a sequência e os critérios do plano, não indicam trabalho ainda ausente quando o registro o marca concluído.

## Use a base implementada e preserve a origem das provas

Leia o [contrato implementado](plans/NATIVE-HISTORY-BACKEND-CONTRACT.md) antes de alterar schemas, rotas ou testes. Ele fixa campos, limites, unidades, tabelas, paginação, diagnósticos e fontes desta atualização. O [plano de eventos do consumidor](plans/NATIVE-EVENTS-WAPILOT.md) mantém os requisitos da escrita ainda pendente.

Foram examinados os fontes de `/workspace/evolution-go`, HEAD `58c7b50`, e `/workspace/wapilot`, commit `9bb1dd8`. O diff do backend desde `9c0ce03` contém apenas documentação de release. O relatório local registra a publicação do backend em `68e33df8fa8cb37ce7f9e970e4ea36781ba7c13f` e do consumidor em `0de70bb504a2a966c8d02e874e4566fe4f2653f5`, nas branches de upgrade indicadas no contrato. Esses registros não foram reconfirmados por read-back remoto nesta tarefa.

A referência local `origin/main` do checkout fornecido está atrasada. Não interpretar isso como prova de que o usuário deixou de publicar. Não executar pull, reset ou sincronização de código para atualizar este documento. A indicação explícita de `/workspace/evolution-go` substitui, nesta inspeção, a preferência anterior pelo clone canônico. Os futuros launchers deste repositório continuam usando `.scratch/evolution-go` conforme `AGENTS.md`, salvo nova indicação do usuário.

O relatório registra testes Go, migrations PostgreSQL, aceitação MCP conectada com cinco famílias, 500 votos e 500 RSVP, além de publicação e probes sintéticos anteriores. Esta atualização conferiu código, fixtures e relatórios. Não repetiu suítes de aplicação ou verificações de produção. O [handoff original](plans/NATIVE-EVENTS-EVOLUTION-HANDOFF.md) permanece uma cópia histórica integral do anexo; a necessidade de criar as rotas já implementadas foi superada pelo contrato atual.

## Atualize o estado das entregas

| Entrega anterior | Estado constatado | Trabalho restante nesta worktree |
| --- | --- | --- |
| L0: diagnóstico reproduzível | O provedor reconstruiu inventário, testes de projeção, round-trip PostgreSQL, HTTP real e exportador de fixtures. Não são os scripts antigos removidos. | Usar os artefatos atuais e repetir a aceitação conectada após integrar o consumidor. |
| L1: contatos e metadados | VCard, precisão, velocidade, direção e waveform continuam com as perdas locais no consumidor examinado, inclusive em `9bb1dd8`. | Corrigir em entrega própria, com projeção segura e testes de preservação. |
| L2: persistência de menus | Implementada para listas, botões, templates hidratados, fluxo nativo e carrosséis nos caminhos suportados. Há diagnósticos e proteção contra ecos esparsos. | Não reimplementar o backend. Respeitar mídia parcial e templates não hidratados sem suporte. |
| L3: consumo de conteúdo nativo | Implementado em `/workspace/wapilot` em `9bb1dd8`, com schemas, disponibilidade e testes. Ausente nesta base `eedc594`. | Integrar o diff temático existente em vez de escrever uma segunda versão. |
| Enquetes e respostas volumosas | `body.poll`, `poll_votes` preservada e GET paginado implementados. | Integrar `list_message_responses`, hashes de opções, diagnósticos e cobertura observada. |
| E0/E1: segredo e evento | Backend implementou `/send/event`, segredo antes do dispatch e leitura retida. | W1 ainda precisa de variante de envio no catálogo WaPilot. Readiness operacional continua etapa de release. |
| E2: RSVP | Backend implementou decifragem, mensagem retida e `event_responses` transacional. | Leitura e paginação já existem no consumidor externo; integrar e validar nesta base. Não anunciar RSVP de saída. |
| Outras famílias L4 | Permanecem adiadas conforme tabela abaixo. | Tratar cada família com contrato e prova próprios. |

A entrega atual não cria cache de histórico ou participantes em D1. Conteúdo próprio fica em `messages.body`; respostas volumosas ficam nas tabelas existentes do provedor e são consultadas sob demanda.

## P0: incorpore a integração de leitura existente

1. Comece com `git status --short --branch` e `git diff`. Preserve os documentos locais e qualquer alteração alheia.
2. Compare o commit consumidor `9bb1dd8` e o snapshot publicado indicado pelo relatório com a base que realmente receberá a integração. Se o trabalho já estiver presente nessa base, preserve-o e valide o comportamento. Não duplique a implementação.
3. Incorpore o diff temático dos oito arquivos da integração: `src/lib/native-message.ts`, `src/lib/evolution.ts`, `src/lib/mcp.ts`, `src/types.ts`, `test/native-history.test.ts`, `test/mcp-messages.test.ts`, `DEVELOPMENT.md` e `docs/TOOLS.md`. Concilie alterações posteriores pelo comportamento, sem substituir o checkout inteiro.
4. Preserve as cinco famílias: `interactive`, `interactiveResponse`, `poll`, `event`, `eventResponse`. Leitura tem campos opcionais de protocolo; não aplicar nela o schema estrito de criação.
5. Preserve `meta.content` separado de `meta.update`, incluindo `partial` legível e indisponibilidade explícita. Falta de corpo não vira menu/evento vazio. Atualize ambas as verificações de presença de conteúdo, no adaptador e em `get_message`.
6. Integre a ferramenta de leitura `list_message_responses`, já existente no outro checkout. Mantenha resolução por usuário/conexão, relações autenticadas e validação de links e tipos. Uma página por chamada; `nextCursor` permite continuar. Não carregue coleções inteiras durante a leitura da mensagem.
7. Termine com testes locais focados e a aceitação conectada descrita abaixo. Registre o SHA do consumidor integrado e do provedor usado.

A integração usa o limite MCP padrão 100, máximo 100; o provedor usa 25 por padrão quando o parâmetro não é enviado. Preserve a diferença documentada. Não use o endpoint legado de resultados como substituto da consulta paginada.

Links iniciais e de continuação devem corresponder à rota prevista e ao ID solicitado. Um recurso, cursor ou URL fornecido pelo cliente não concede acesso. Credenciais não seguem URLs externas nem redirects. Preservar `coverage`, ambiguidade e consistência eventual é parte da resposta de produto.

## P1: conclua as perdas locais de contato e metadados

Em `src/lib/evolution.ts`, preserve `accuracyMeters`, `speed`, `degrees` e `waveform` conforme o contrato existente. Valide na fronteira e preserve zero e ausência. Não substitua ausência por zero nem aceite números não finitos.

Em `get_message`, substitua a remoção incondicional de `medias.content` por projeção explícita para vCards textuais comprovados. Inclua contato simples e conjuntos de contatos. Mantenha a omissão de URLs privadas e bytes de anexos; MIME desconhecido não ganha permissão para devolver conteúdo arbitrário. Confira a política compatível de `list_messages`.

Não modifique a projeção nativa do backend para compensar esses quatro casos. Os testes de migração e de paginação não comprovam que L1 foi corrigido. Atualize `docs/TOOLS.md` e `docs/ARCHITECTURE.md` junto com os testes do consumidor.

## P2: entregue o envio de evento separadamente

Siga o [plano W1](plans/NATIVE-EVENTS-WAPILOT.md). `/send/event` já existe; a etapa não inclui criá-la novamente. Falta integrar `message.kind: "event"`, conversão de instantes com fuso para segundos, fingerprint semântico, apresentação e classificação dos erros de envio.

O backend exige JID completo no wire e participante nas citações de grupo. Esses detalhes precisam ser tratados explicitamente pelo adaptador. `isCanceled` e `extraGuestsAllowed` são campos possíveis da leitura, não campos autorizados na criação E1. O segredo continua exclusivamente no provedor.

Não condicione P0/P1 ao envio de evento. A leitura de RSVP e sua coleção pode funcionar antes de o WaPilot oferecer criação de evento.

## Preserve os testes de aceitação da leitura

Os IDs originais continuam válidos como rastreabilidade. “Implementado fora desta worktree” não equivale a teste executado aqui. Reutilize as suítes atuais, acrescente somente lacunas comportamentais e mantenha limites de cobertura claros.

| ID | Resultado exigido e fonte de verificação |
| --- | --- |
| L-A1 | Contato simples e múltiplo preservam vCards, Unicode e telefones sintéticos em listagem e leitura integral. Pendente de L1 no consumidor examinado. |
| L-A2 | A correção de contato não expõe URLs privadas, bytes de mídia ou conteúdo de MIME desconhecido, nem inicia download. |
| L-A3 | Precisão, velocidade, direção e waveform válidos são preservados, inclusive zero; ausência continua ausência. Pendente de L1. |
| L-A4 | Tipo errado, número não finito e vCard não textual não produzem dados falsos nem conteúdo arbitrário. Fixar a política de diagnóstico nas fixtures. |
| L-A5 | Listas e botões preservam ordem, rótulos, IDs e ações após persistência, restart, status/busca e MCP. Usar as provas existentes do provedor e repetir a ponta MCP integrada. |
| L-A6 | Respostas interativas mantêm seleção/origem. Templates hidratados e carrosséis mantêm semântica ordenada; mídia parcial e template não hidratado conservam seus diagnósticos. |
| L-A7 | As cinco famílias estruturadas sem texto ou mídia são legíveis. `partial` preserva o corpo disponível. |
| L-A8 | Fixtures históricas sem corpo continuam indisponíveis. Não inferir recuperação de mensagens antigas a partir do upgrade. Texto vazio, alvo ausente e conteúdo indisponível permanecem distintos. |
| L-A9 | Usuário/conexão/instância corretos em mensagem, relações e páginas. IDs iguais de outra instância e colisão de conversa não misturam conteúdo ou respondentes. |
| L-A10 | Campos privados e parâmetros nativos brutos são excluídos. Limites de conteúdo e diagnósticos do backend não são apresentados como conteúdo integral. |
| L-A11 | Texto, citações, legendas, localização simples e anexos existentes continuam compatíveis. GET mantém retry limitado; POST não é repetido. |
| L-A12 | `meta.update` e os diagnósticos de conteúdo coexistem. Preserve edições existentes e os motivos de indisponibilidade sem generalizar suporte. |
| L-A13 | Catálogos HTTP/stdio compartilham o contrato de leitura e as permissões existentes. Não há arquivo de mensagens/participantes em D1 ou conteúdo sensível na auditoria. |
| L-A14 | Cada família anunciada tem prova correspondente. O inventário de 36 casos do backend inclui casos adiados e não significa 36 formatos integralmente suportados. |

A consulta separada exige ainda estes testes:

| ID | Resultado exigido |
| --- | --- |
| R-A1 | `list_message_responses` percorre 500 votos e 500 RSVP sintéticos, com limite por página e sem duplicar IDs em conjunto fixo. `get_message` e `list_messages` não embutem participantes. |
| R-A2 | Relação inicial, `links.next`, tipo do recurso e alvo são validados. URL externa, outra rota, ausência de cursor e linhas de outro alvo falham sem encaminhar credenciais. |
| R-A3 | Cursor inválido ou de outro escopo e limites fora de 1..100 conservam erros seguros. Cursor é opaco ao WaPilot. |
| R-A4 | Estado ambíguo de voto ou RSVP omite escolha autoritativa. Hash sem correspondência, retirada de voto e convidados extras zero mantêm o significado do provedor. |
| R-A5 | Alvo retido sem observações, conteúdo indisponível, alvo ausente e falha de consulta permanecem distintos. Cobertura desconhecida não vira contagem zero completa. |
| R-A6 | O consumidor preserva consistência eventual e cobertura observada, sem inventar snapshot ou totais. Atualizações durante travessia seguem o contrato; não prometer cobertura completa de inserções concorrentes. |
| R-A7 | Não há consulta automática de todas as páginas, novo armazenamento D1 ou write WhatsApp durante leitura. A ferramenta é somente leitura nos catálogos aplicáveis. |

R-A1 e parte de R-A2/R-A4 têm implementação e evidência anteriores nos fontes examinados. Complete as lacunas e repita no consumidor integrado, sem reescrever a persistência ou as migrations do provedor.

## Reproduza a integração com o backend real de teste

O comando de exportação já existe. Em um checkout autorizado para o harness, use `scripts/export-message-content-fixtures.sh` com `MESSAGE_HISTORY_TEST_DSN` de PostgreSQL isolado. Quatro fixtures exportadas ficam em `pkg/message/acceptance/testdata`. Não inventar um arquivo exportado de RSVP; esse quinto tipo é exercitado na aceitação conectada.

O teste Go `TestNativeContentHTTPRoundTrip` pode manter o servidor de fixture local aberto com `MESSAGE_CONTENT_FIXTURE_SERVER_ADDR`, gravar credenciais sintéticas temporárias em `MESSAGE_CONTENT_FIXTURE_SERVER_INFO` e terminar pelo arquivo `MESSAGE_CONTENT_FIXTURE_SERVER_STOP`. Use arquivo temporário privado, descarte-o ao encerrar e nunca copie credenciais de produção.

O launcher deve aplicar o procedimento ao checkout canônico definido por este repositório ou ao caminho explicitamente autorizado na tarefa. Esta atualização apenas leu `/workspace/evolution-go`; não criou clone nem alterou seu estado. Confira hooks/overlays contra o SHA antes de executar harnesses antigos.

No consumidor já integrado, execute o teste regular:

```sh
npx vitest run test/native-history.test.ts test/mcp-messages.test.ts test/evolution-routes.test.ts
```

Para executar H-A8 de verdade, configure `WAPILOT_HISTORY_ACCEPTANCE_URL` e `WAPILOT_HISTORY_ACCEPTANCE_TOKEN` com a fixture local sintética. Sem URL, a parte conectada é pulada. Registre essa diferença no resultado. Testes PostgreSQL também podem pular sem DSN; um skip não prova migrations nem round-trip.

P1 acrescenta `test/stdio.test.ts` e suas regressões de contato/metadados. P2 estende `npm run test:acceptance:send` depois de conferir o launcher contra a nova revisão Go. Ao concluir uma mudança de código, execute `npm run check` e `npx wrangler deploy --dry-run`. Não é necessário executar essas suítes para uma atualização somente documental.

## Mantenha o escopo adiado e as condições de release

| Família ou capacidade | Limite atual |
| --- | --- |
| Templates e carrosséis | Template não hidratado sem suporte; cabeçalhos/cards com mídia parcial. Não converter diagnóstico em sucesso integral. |
| Reações, convites de grupo, produtos/pedidos, chamadas agendadas | Contratos e preservação completos ainda exigem entregas próprias. |
| `ptvMessage` e prévias de links | Metadados ou texto não comprovam bytes, reprodução ou prévia completa. |
| Edição/cancelamento de evento e RSVP de saída | Não implementados por esta entrega. `isCanceled` retido e RSVP lido não concedem essas operações. |
| Totais de participantes | Não oferecidos. A coleção contém observações retidas do estado atual, não presença completa. |
| Renderização Android/iOS/Web | Permanece pendente de homologação autorizada. Aceite HTTP e teste sintético não a substituem. |

O relatório registra que uma integração de leitura já foi publicada. Antes de qualquer nova release autorizada, compare a candidata com o código realmente ativo, para preservar esse trabalho e outras funcionalidades existentes. Não publique novamente a base `eedc594` sem reconciliação. Readiness E1 não exige endpoint de capacidades, feature flag ou preflight live por envio.

Mantenha migrations, tabelas, mensagens e segredos no provedor. `poll_votes` usa agora unicidade por instância; o writer antigo não é rollback seguro depois de IDs sobrepostos entre instâncias. Reversão planejada precisa de writer compatível e deve retirar novos envios de evento do consumidor antes de reverter a capacidade correspondente no backend.

Esta tarefa atualizou documentação a partir de fontes locais, fixtures e registros existentes. Não alterou código dos dois serviços, executou suítes de aplicação, acessou dados pessoais ou reconfirmou o deployment.
