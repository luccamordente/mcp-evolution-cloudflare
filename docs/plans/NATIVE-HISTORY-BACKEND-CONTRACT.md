# Contrato implementado de histórico nativo e respostas

Referência para atualizar o consumidor, conferida nesta sessão no checkout indicado pelo usuário, `/workspace/evolution-go`, HEAD `58c7b50032fc4cbb203b404e2025f6d809b99599`. Este documento descreve código e fixtures examinados. Não é uma nova certificação de produção.

## Revisões e evidências

O código funcional examinado está em `9c0ce038ab44f45d74833829f6a10104cf52c29e`, árvore `9a25fb8d0f227dde5fae476c01f6327c5f474206`. O diff entre essa revisão e o HEAD indicado contém apenas o relatório de release e seu registro de decisões.

O [relatório local do provedor](/workspace/evolution-go/docs/superpowers/reports/2026-11-11-message-history-storage.md) registra publicação do backend em `68e33df8fa8cb37ce7f9e970e4ea36781ba7c13f`, branch `upgrade/message-history-storage-20261111`, com a mesma árvore funcional. A evidência operacional mais recente está nesse relatório do HEAD `58c7b50`; ela não foi conferida novamente em produção nesta tarefa. O relatório foi acrescentado após a revisão funcional e não deve ser presumido presente no snapshot publicado.

O mesmo relatório registra uma integração WaPilot publicada em `0de70bb504a2a966c8d02e874e4566fe4f2653f5`, branch `upgrade/native-history-20261111`. A cópia `/workspace/wapilot`, commit `9bb1dd8`, tem a árvore registrada `378df699a54a5034364416f0fe54aba70350e382`. Seus fontes foram inspecionados nesta sessão. A worktree deste plano continua em `eedc594`, sem essa integração. Não confundir essas três bases com `main` remoto ou com o serviço ativo agora.

O relatório declara suítes Go, PostgreSQL isolado, teste conectado MCP, traversal de 500 votos e 500 RSVP, build, deploy e probes sintéticos anteriores. Nesta atualização foram inspecionados os fontes, fixtures e o relatório; essas suítes e probes não foram repetidos. O relatório também registra impossibilidade de read-back independente da configuração dos consumidores Queue. Essa limitação não deve desaparecer de uma futura nota de release.

Fontes principais: [conteúdo nativo](https://github.com/neurau/evolution-go/blob/68e33df8fa8cb37ce7f9e970e4ea36781ba7c13f/docs/message-content.md), [coleções de respostas](https://github.com/neurau/evolution-go/blob/68e33df8fa8cb37ce7f9e970e4ea36781ba7c13f/docs/message-responses.md) e [tipos Go](https://github.com/neurau/evolution-go/blob/68e33df8fa8cb37ce7f9e970e4ea36781ba7c13f/pkg/message/model/native_content.go). Os links fixam a revisão publicada indicada pelo relatório, não uma leitura de `main` feita nesta tarefa.

## Corpo, metadados e presença

`messages.body` e `attributes.body` carregam as mesmas famílias semânticas limitadas. O projetor compartilhado `pkg/message/content.Project` é usado no recebimento, persistência de enviados e sincronização de histórico elegível. O modelo e `Message.Payload` reconhecem conteúdo sem texto ou mídia.

| Campo do corpo | `encodingFormat` | Campos principais |
| --- | --- | --- |
| `interactive` | `application/vnd.whatsapp.interactive` | `kind`, `title?`, `text?`, `footer?`, `buttonText?`, `templateId?`, `sections?`, `actions?`, `cards?` ordenados. |
| `interactiveResponse` | `application/vnd.whatsapp.interactive-response` | `kind`, `id?`, `text?`, `originMessageId?`. |
| `poll` | `application/vnd.whatsapp.poll` | `question`, `options: [{id, name}]`, `selectableOptionsCount?`, `ambiguous?`. |
| `event` | `application/vnd.whatsapp.event` | `name`, `description?`, `startTime?`, `endTime?`, `isCanceled?`, `location?`, `extraGuestsAllowed?`. |
| `eventResponse` | `application/vnd.whatsapp.event-response` | `eventMessageId`, `response`, `timestampMS`, `extraGuestCount?`. |

Seções têm `title?` e `rows` ordenados com `id`, `title`, `description?`. Ações usam `kind` e os campos semânticos correspondentes: resposta com `id`/`label`, URL com `url`/`label`, chamada com `phoneNumber`/`label`, cópia com `copyCode`/`label` e seleção com `sections`. Não renomear `id` para `rowId`, `name` para `label` ou `copyCode` para `code` no wire de leitura por analogia com o schema de envio existente.

IDs de opções de enquete são SHA-256 hex minúsculo calculado pelo SDK sobre o nome exato. As três versões de criação compartilham o formato. Nomes duplicados preservam a ambiguidade; o consumidor não inventa IDs posicionais. Seleções sem correspondência não viram uma opção adivinhada.

Preservar ausência, zero e falso. Início/término de evento usam segundos Unix em `0..253402300799`; RSVP usa milissegundos em `timestampMS`; `attributes.at` continua em milissegundos. O schema de leitura não exige todos os campos obrigatórios do schema de criação. `isCanceled` e `extraGuestsAllowed` recebidos não concedem operações de escrita equivalentes.

Diagnóstico público fica em `meta.content`, separado de `meta.update`, com `version: 1`, `state` em `partial`, `invalid`, `unsupported`, `unavailable` e motivo sanitizado quando disponível. Alguns diagnósticos de resposta incluem `targetId` permitido pelo encoder. No WaPilot integrado são `contentDiagnostic` e, para `partial`, `contentPartial`. Conteúdo parcial legível não deve ser confundido com conteúdo integralmente indisponível. Mensagem sem corpo permanece um diagnóstico, não um objeto nativo vazio.

## Limites e retenção do backend

O conteúdo nativo normalizado tem limite de 64 KiB. Parâmetros JSON nativos têm limite de 16 KiB, no máximo 100 ações e linhas no conjunto, 100 opções de enquete, 20 cards e oito níveis de travessia. Exceder limite não pode parecer truncamento completo. Esses são limites de leitura; os limites de cada variante de envio continuam próprios.

Mídia de cabeçalhos e cards permanece parcial com diagnóstico. Templates não hidratados permanecem sem suporte. Reações, convites de grupo, produtos/pedidos, chamadas agendadas, vídeo circular e prévias de links não foram concluídos por esta entrega. Edições existentes foram preservadas; não presumir suporte novo a todas as variantes.

Conteúdo nativo exige retenção de mensagens e `SaveMessageBodies`; o caminho de enviados preserva a política anterior de texto/mídia. Não foi criado TTL novo. Upserts comuns preservam conteúdo nativo já retido contra ecos esparsos; edição explícita mantém seu caminho próprio. Colisão do mesmo ID em outra conversa é rejeitada. O upgrade não recupera conteúdo antigo descartado.

## Respostas em tabelas separadas

| Coleção | Armazenamento implementado | Estado |
| --- | --- | --- |
| Votos | `poll_votes` no PostgreSQL AUTH existente. | Chave `(instance_id, poll_message_id, voter_jid)`. Novos campos `protocol_timestamp_ms`, `ordering_state`, `identity_provenance`. IDs existentes são preservados. |
| RSVP | `event_responses` no PostgreSQL USERS, junto de `messages`. | Chave `(instance_id, event_message_id, respondent_jid)`. Mensagem individual retida e projeção atual gravadas na mesma transação. |

A escolha de tabela separada foi implementada. Não planejar agora generalizar ou substituir `poll_votes`. `event_responses` guarda ID estável, alvo, conversa, chat/autor verificados, respondente, mensagem de resposta, timestamp de protocolo, resposta, convidados opcionais, proveniência da identidade, ambiguidade e instantes de recebimento/atualização. É uma projeção do estado atual, não um segundo log completo.

Respostas mais antigas e replay não substituem o estado novo. Conflito no mesmo timestamp produz ambiguidade e omite a escolha atual autoritativa; uma resposta estritamente mais nova pode resolver. Votos com ordenação legada preservam sua proveniência. Diagnósticos de RSVP com vínculo retido podem recuperar após replay validado; identidades PN/LID sem prova não são mescladas por suposição nem coalescidas retroativamente.

## Relações e paginação

| Mensagem-alvo | Relação JSON:API | GET autenticado | Recurso |
| --- | --- | --- | --- |
| Enquete | `relationships.votes.links.related` | `/polls/{messageId}/votes` | `poll-vote` |
| Evento | `relationships.eventResponses.links.related` | `/messages/{messageId}/event-responses` | `event-response` |

Cada página exige token da instância no header `apikey`, usa `page[limit]` entre 1 e 100, padrão 25 no provedor, e `page[cursor]` opaco. O documento tem `data`, `links.self`/`links.next` e `meta`. IDs são ordenados pela chave textual imutável com collation C. Cursores são assinados e vinculados a instância, alvo e coleção; rotação da chave invalida os cursores. O consumidor não os decodifica nem os assina.

É leitura eventualmente consistente do estado atual, sem snapshot. Atualização não move uma linha; novas linhas antes do cursor podem exigir nova travessia. `coverage: "observed"` não significa presença completa. Não há totais agregados. A coleção de votos inclui `state`, `hasMore` e `snapshot: false`; a de eventos explicita `consistency`. Preserve os metadados recebidos, sem exigir envelopes idênticos por suposição.

Alvo retido legível sem respostas retorna 200 e coleção vazia. Original indisponível ou retenção desabilitada retorna 200 com diagnóstico e cobertura desconhecida. Alvo ausente/estrangeiro retorna 404. Limite ou cursor inválido retorna 400. Falha de consulta continua 5xx. O endpoint legado `/polls/{id}/results` conserva seu comportamento anterior e não é a fonte de paginação do novo consumidor.

A integração WaPilot existente usa `list_message_responses` com `connectionId?`, `messageId`, `relationship: "votes" | "eventResponses"`, `limit` padrão 100 e máximo 100, `cursor?`. Valida a relação exata anunciada pela mensagem e o `links.next`, mantém credenciais apenas no provedor e devolve `items`, `meta`, `hasMore`, `nextCursor?`. A leitura de mensagem não carrega participantes automaticamente.

## Envio de evento e limites de escrita

`POST /send/event` está implementado. O decoder estrito roda antes da tradução JSON genérica. O destinatário do wire deve ser JID completo PN, LID ou grupo; número cru não passa no decoder dessa rota. Nome e local têm trim e limites UTF-16 do handoff original. O contrato de criação não aceita `extraGuestsAllowed` nem `isCanceled` fornecidos pelo consumidor.

O backend prealoca o ID real, gera segredo aleatório de 32 bytes e faz `PutMessageSecret` seguido de leitura de confirmação antes do dispatch. Citação exige texto ou evento retido com identidades completas verificáveis; em grupo exige participante. Casos legados sem identidade verificável falham antes do envio. Erros públicos incluem `invalid_event`, `event_preparation_failed`, `event_outcome_unknown`. Resultado desconhecido preserva o segredo e não autoriza retry.

O catálogo WaPilot inspecionado ainda não oferece `message.kind: "event"`. Backend pronto não encerra essa integração de escrita. RSVP de saída, edição/cancelamento de evento, importação `.ics`, encaminhamento nativo e homologação visual continuam fora da entrega.

## Fixtures e reprodução

O exportador existente é `/workspace/evolution-go/scripts/export-message-content-fixtures.sh`. Exige `MESSAGE_HISTORY_TEST_DSN` de PostgreSQL isolado e regenera `pkg/message/acceptance/testdata/{interactive,interactiveResponse,poll,event}.json`. Há quatro fixtures exportadas; `eventResponse` é exercitada no teste conectado, não deve ser presumida como um quinto arquivo já exportado.

O teste `pkg/message/acceptance/reading_test.go` pode servir a fixture local usando `MESSAGE_CONTENT_FIXTURE_SERVER_ADDR`, `MESSAGE_CONTENT_FIXTURE_SERVER_INFO` e `MESSAGE_CONTENT_FIXTURE_SERVER_STOP`. O arquivo de info fornece URL e token sintéticos temporários. O consumidor usa `WAPILOT_HISTORY_ACCEPTANCE_URL` e `WAPILOT_HISTORY_ACCEPTANCE_TOKEN` em `test/native-history.test.ts`. A parte conectada é pulada sem URL; teste regular verde não equivale a H-A8 executado.

As migrations e os testes de PostgreSQL exigem ambiente de teste explícito. Preserve `poll_votes`, dados, mensagens e segredos. O writer antigo usa um conflito incompatível com a unicidade migrada; um rollback apenas do binário antigo não é seguro após IDs sobrepostos entre instâncias. O estado operacional de produção deve ser relido somente quando a tarefa autorizar essa verificação.
