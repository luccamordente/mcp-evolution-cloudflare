# Plano de integração de eventos nativos no WaPilot

Plano atualizado após a inspeção de `/workspace/evolution-go`, HEAD `58c7b50`, e da integração de leitura em `/workspace/wapilot`, commit `9bb1dd8`. Consulte o [contrato implementado](NATIVE-HISTORY-BACKEND-CONTRACT.md) para fontes e limites das provas. A worktree deste plano continua em `eedc594`; a implementação foi autorizada posteriormente e agora inclui a variante de envio. Consulte o [registro de validação](../qa/native-history-implementation.md) para os resultados atuais. Publicação não foi autorizada.

O backend já oferece criação de evento, leitura e RSVP. O consumidor externo já lê eventos e respostas paginadas; ainda não oferece `message.kind: "event"`. O trabalho de escrita W1 continua necessário. O [handoff integral original](NATIVE-EVENTS-EVOLUTION-HANDOFF.md) e a [investigação](../NATIVE-WHATSAPP-EVENTS.md) são referências históricas; não representam mais o estado atual do backend.

| Marco | Estado observado | Próxima ação |
| --- | --- | --- |
| E0/E1 do backend | Implementados, com testes e evidência anterior registrados no relatório do provedor. | Consumir a rota existente e conferir a revisão ativa quando preparar uma release autorizada. |
| W1 de leitura | Integração `9bb1dd8` incorporada nesta worktree e validada. | Preservar o contrato e os testes P0. |
| W1 de envio | Implementado nesta worktree, com aceitação MCP e captura nativa Go. | Homologação visual separada quando autorizada. |
| E2 e leitura W2 | Integrados nesta worktree; travessia conectada de 500 respostas por coleção passou. | Preservar cobertura observada e limites. |
| Aceite visual | Sem nova prova de Android/iOS/Web. | Homologação separada, quando autorizada. |

## W0: use o contrato implementado antes de publicar o consumidor

Use os fontes `pkg/sendMessage/service/event.go`, `event_request.go`, `event_secret.go` e seus testes no provedor. O contrato existente é `POST /send/event`, com token da instância no header `apikey`, JSON:API e marcador privado `application/vnd.whatsapp.event`. O decoder estrito precede a tradução genérica. Não criar outra rota ou atualizar a dependência como substituto da integração.

O código prealoca o ID e grava/reconfere o segredo antes do dispatch. A suíte e a evidência de restart anteriores estão registradas no relatório. Na preparação de release, identifique a versão efetivamente ativa e a cobertura E-A1 a E-A11 que sustenta a candidata. E-A12 de dispositivos continua uma prova distinta, ainda pendente. Esta atualização não repetiu esses testes nem acessou produção.

A conferência ocorre no preparo da release. Não acrescente endpoint de capacidades, feature flag ou preflight live por envio. Se a versão ativa não oferecer o contrato E1 verificado, mantenha o novo envio fora da release. A leitura de evento/RSVP pode ser entregue antes da escrita.

O contrato implementado e suas fixtures são a referência de integração atual. Preserve a cópia histórica do anexo sem alterações. Mudanças futuras de nome, limites, unidades ou envelope devem atualizar o contrato corrente, as fixtures e os planos dos dois lados.

## W1: acrescente criação e leitura pela ferramenta existente

O uso proposto pelo consumidor é:

```json
{
	"idempotencyKey": "synthetic-event-action-1",
	"message": {
		"kind": "event",
		"to": "12025550123@s.whatsapp.net",
		"name": "Encontro de demonstração",
		"description": "Evento fictício para validar o cartão nativo.",
		"startTime": "2026-11-20T18:00:00Z",
		"endTime": "2026-11-20T19:00:00Z",
		"location": {
			"name": "Local de exemplo",
			"address": "Endereço fictício",
			"latitude": -19.9321,
			"longitude": -43.9378
		}
	}
}
```

`connectionId` continua opcional e usa o UUID interno existente. `replyTo` é opcional, com `messageId` e `participant?`; em citação de grupo o backend exige participante. A origem citada precisa ter texto ou evento retido e identidades completas verificáveis. Não inclua `mentions`, `delayMs`, `formatJid` ou `customMessageId` apenas por compartilhar helpers com outros envios. O contrato E1 não os define.

### Valide e normalize os campos na fronteira

Acrescente uma variante estrita `kind: "event"` à união em `src/lib/send-message.ts`, derivando o tipo do schema Zod. Use apenas `to`, `replyTo?`, `name`, `description?`, `startTime`, `endTime?` e `location?`. Campos de leitura ou de outros tipos são rejeitados.

O schema deve aplicar o contrato do handoff:

- Nome do evento e do local com trim, de 1 a 200 unidades UTF-16. JavaScript e Go devem contar da mesma forma, incluindo caracteres fora do BMP.
- Descrição e endereço opcionais, com string não vazia, espaços preservados e limites de 10.000 e 1.000 unidades UTF-16.
- Instantes ISO 8601 válidos com `Z` ou offset explícito. Rejeitar datas impossíveis, datas sem fuso, números e componentes fracionários de segundo. Não arredondar nem truncar frações silenciosamente.
- Converter início e término para segundos Unix inteiros de 0 a 253402300799. Término deve ser posterior ao início. Não usar a hora atual como critério que invalide uma repetição idempotente.
- Local com nome, latitude e longitude obrigatórios, coordenadas finitas nos intervalos geográficos e zero válido. Não reutilizar a restrição atual de zero do envio `location`.
- Destino individual PN/LID ou grupo. O backend exige JID completo no wire e não usa o middleware de `formatJid` das outras rotas. Se o schema consumidor aceitar número cru, normalize-o explicitamente para PN válido pelos mecanismos existentes antes do POST. Rejeitar Status, broadcast e newsletter. A resolução PN/LID e a validação da citação acontecem no backend no escopo da instância autenticada.

Para eliminar ambiguidade de datas com frações, a proposta aceita somente a forma com segundos inteiros, sem componente fracionário. Fixe essa escolha no schema, nas descrições e nas fixtures antes da implementação.

### Preserve a idempotência existente

Normalize texto e instantes antes de construir o fingerprint em `prepareSendMessage`. Offsets que representam o mesmo instante produzem os mesmos segundos. Preserve diferenças semânticas de destino, nome, descrição, término, localização, endereço e citação no hash. A ordem das propriedades JSON não deve criar uma ação nova.

Use a reserva existente de `send_message` no D1, por usuário/conexão/operação/chave e pela janela atual de 24 horas. Não crie uma coleção de eventos, ledger de participantes ou segredo no consumidor. O segredo é gerado pelo provedor e nunca participa do schema ou do fingerprint.

Uma repetição concluída deve retornar o resultado gravado antes de nova leitura live da citação. A validação de citação pertence ao POST do backend. Depois que o dispatch começar, uma falha sem confirmação mantém o resultado desconhecido e bloqueia replay. Não troque a chave, o destino, o tipo ou o ID para contornar a incerteza.

### Serialize o contrato somente no adaptador

Em `src/lib/evolution.ts`, acrescente o caso `event` em `sendMessage` e serialize o envelope exato E1, com `attributes.encodingFormat`, `body.event`, `relationships.recipient` e `quoted?`. Não envie `.ics`, mídia ou protobuf arbitrário. Preserve o resultado normalizado de aceite e a ausência de retry de POST.

Consuma os códigos públicos `invalid_event`, `event_preparation_failed` e `event_outcome_unknown`, sem refletir detalhes internos. O último mantém resultado desconhecido mesmo que venha como resposta HTTP de erro. Não classifique todo 4xx/5xx genérico como falha anterior ao envio. O controle de idempotência continua bloqueando replay da ação incerta.

O backend deve escolher o ID real e provar que o segredo foi persistido antes do primeiro envio. Não tente compensar uma falha do provedor gerando outro evento no WaPilot. Uma resposta de aceite não comprova entrega, leitura ou renderização do cartão.

### Reaproveite a leitura de evento existente

Incorpore `src/lib/native-message.ts` e a tradução existente em `9bb1dd8` pelo plano P0. A leitura já valida `attributes.body.event`, preserva `isCanceled` e `extraGuestsAllowed` e reconhece ausência de escalares de protocolo. Esses campos não entram na criação E1. Os tempos são segundos Unix; não substitua o timestamp da mensagem pelo horário do evento.

Preserve ID, conversa, autor, direção, timestamp e citação. Reaproveite as duas verificações de presença de conteúdo de `9bb1dd8`, em `normalizeMessage` e no handler `get_message`. Um evento válido sem texto ou mídia é legível. Preserve `meta.content`, incluindo conteúdo parcial e indisponibilidade; não fabrique um evento vazio. Os testes existentes em `test/native-history.test.ts` e `test/mcp-messages.test.ts` fazem parte da integração, não precisam ser reconstruídos do zero.

Acrescente a apresentação em `messagePresentation`, os textos de descoberta e o comprovante existente. Use linguagem WaPilot e mostre nome e instante com fuso explícito. O comprovante não faz consultas ou envios adicionais. Não crie ferramenta `send_event`, nova UI ou fluxo de convite.

### Atualize os arquivos que pertencem ao contrato

| Arquivo | Alteração planejada |
| --- | --- |
| `src/lib/send-message.ts` | Schema estrito, normalização, fingerprint semântico e apresentação. |
| `src/lib/native-message.ts`, `src/types.ts` | Integrar schemas/tipos de leitura existentes. Manter o contrato de criação separado. |
| `src/lib/evolution.ts` | POST tipado, normalização de status e busca e disponibilidade de conteúdo. |
| `src/lib/mcp.ts` | Descoberta, leitura de conteúdo estruturado e registro da variante na ferramenta existente. |
| `test/send-message.test.ts`, `test/send-idempotency.test.ts` | Aceite MCP, rejeições, concorrência, resultado desconhecido e isolamento. |
| `test/native-history.test.ts`, `test/evolution-routes.test.ts`, `test/mcp-messages.test.ts`, `test/stdio.test.ts` | Reaproveitar leitura existente e acrescentar wire de envio e catálogo compartilhado. |
| `scripts/send-acceptance-backend.mjs`, `scripts/send-acceptance-backend.go`, `test/send-message-backend.test.ts` | Estender a aceitação conectada com captura nativa e fixtures do backend E1. Não simular o construtor de evento para fazê-la passar. |
| `docs/SEND-MESSAGE.md`, `docs/TOOLS.md`, `DEVELOPMENT.md` | Campos, unidades, limites, comandos e garantias de leitura/envio. |
| `docs/ARCHITECTURE.md`, `docs/DEPLOY.md` | Dependências de release, retenção no provedor e ordem de rollback. |

## Exija a aceitação W1 pelo handler real

Os critérios continuam como rastreabilidade. A leitura e as provas E0/E1 do backend têm implementação/evidência anteriores; a futura integração W1 de envio deve acrescentar suas provas de ponta a ponta sem atribuir a esta tarefa testes não executados. A fronteira WhatsApp permanece substituída nos testes locais.

| ID | Cenário | Resultado exigido |
| --- | --- | --- |
| W-A1 | Evento mínimo e completo pelo MCP, D1 local e HTTP real da fixture Go. | Um `POST /send/event` chega ao roteador, autenticação, JSON:API, handler e serviço reais. A captura contém `EventMessage`, os campos esperados e nenhum `DocumentMessage`. |
| W-A2 | Obrigatórios ausentes, `null`, campos desconhecidos, campos exclusivos de mídia ou leitura. | Erro anterior ao dispatch e zero envios. O backend também rejeita chaves JSON duplicadas e conteúdo após o documento. |
| W-A3 | Datas inválidas, sem fuso, com fração, fora do intervalo, término igual/anterior e milissegundos no wire. | Rejeição explícita sem truncamento. Offsets equivalentes, virada do dia e transição de horário de verão preservam o mesmo instante. |
| W-A4 | Limites UTF-16, emoji, opcionais ausentes, latitude/longitude zero e limites geográficos. | Igualdade entre schema JS, validação Go e conteúdo nativo. Espaços da descrição/endereço não são removidos. |
| W-A5 | PN, LID e grupo, sem citação e com citação válida. | O wire contém JID completo. Em grupo, citação exige participante. Destino/contexto/ID correspondem. Outra conversa/instância e identidade inconclusiva falham antes do envio. |
| W-A6 | Falha de armazenamento do segredo antes do dispatch, dois eventos e restart. | Zero envios na falha; segredos de 32 bytes distintos nas criações; o segredo retido resolve o ID enviado após restart. O relatório nunca imprime segredos. |
| W-A7 | Mesma chave/argumentos, offsets equivalentes, ordem de propriedades e chamadas concorrentes. | Uma escrita externa. Resultado concluído é reutilizado sem buscar novamente a citação. Mudança de qualquer campo semântico gera conflito. |
| W-A8 | Timeout depois do dispatch, falha da persistência do resultado e falha de auditoria. | Nenhum retry externo, nenhuma mudança de chave e nenhum segredo apagado. `get_send_status` consulta o estado existente sem enviar. |
| W-A9 | Evento enviado e recebido, sem texto/mídia, em status, busca e MCP. | Mesmo ID e conteúdo retido, identidade preservada e nenhum `contentUnavailable` indevido. Não há segredo, URL privada, chave de mídia ou protobuf no resultado. |
| W-A10 | Conteúdo expirado, malformado ou `isCanceled` retido. | Diagnóstico explícito para indisponibilidade. `isCanceled` não anuncia aplicação de edição/cancelamento nem permite esses campos na criação. |
| W-A11 | Sem `mcp:write`, contexto HTTP ausente, conexão alheia e token de outra instância. | Recusa antes de WhatsApp. O stdio usa o contexto local existente, mantendo D1 por worktree e `remoteBindings: false`. |
| W-A12 | Documento `.ics`, envio de localização existente e demais variantes. | Continuam com seus contratos. `.ics` permanece documento; evento não usa `/send/media` nem fallback textual. |
| W-A13 | Descoberta, comprovante e auditoria depois do envio. | Uma única ferramenta `send_message`, linguagem WaPilot, resumo correto e nenhum segredo/conteúdo desnecessário no estado operacional. |
| W-A14 | Homologação autorizada em Android, iOS e Web, individual e grupo. | Registrar versão, cartão nativo, detalhes, horário local, citação e cópia em dispositivo vinculado. Resultado HTTP isolado não passa neste teste. |

E-A1 a E-A12 do handoff continuam obrigatórios para o backend. W-A1 a W-A13 acrescentam a prova do consumidor. W-A14 e E-A12 exigem autorização separada para envios reais e não são substituídos por fixtures.

## W2: integre a leitura RSVP e sua coleção já implementadas

O contrato E2 implementado é `application/vnd.whatsapp.event-response` e `body.eventResponse`. Preserve `eventMessageId`, `response`, `timestampMS` e `extraGuestCount?`, com conversa e autor nos campos normais da mensagem. `timestampMS` permanece em milissegundos e zero convidados extras não significa ausência. Reaproveite o schema e a leitura existentes no consumidor externo.

O backend mantém `event_responses` no PostgreSQL USERS, junto de `messages`, como projeção transacional do estado atual por instância/evento/respondente. `poll_votes` continua separada no AUTH PostgreSQL. Essa escolha já foi implementada; não planejar uma tabela genérica nova ou levar participantes ao D1.

A mensagem de evento anuncia `relationships.eventResponses.links.related` para `GET /messages/{eventMessageId}/event-responses`. A de enquete anuncia `votes` para `GET /polls/{messageId}/votes`. A integração existente fornece a ferramenta somente leitura `list_message_responses`, com páginas de até 100 registros, relações e continuações validadas. Incorporar e testar pelo plano P0, preservando cobertura observada e consistência eventual.

O provedor resolve a identidade e decifra com o segredo retido. O WaPilot apenas valida e lê o resultado tipado. Não implemente criptografia própria, envio de RSVP, webhook novo ou totalização de participantes neste marco.

Cubra `GOING`, `NOT_GOING`, `MAYBE`, `UNKNOWN`, segredo ausente, original expirado, fixture cifrada adulterada, autor/conversa errados, PN/LID, restart e isolamento. O backend deve provar decifragem real da fixture; o teste MCP verifica que somente o resultado seguro chega ao consumidor.

Preserve os resultados do backend para duplicação, ordem invertida e empate. Uma linha ambígua da coleção não tem resposta autoritativa; o consumidor não a escolhe pela ordem da página. Segredo/original ausente e falha de decifragem são diagnósticos, não RSVP positivo. O backend permite recuperação de diagnóstico com vínculo retido por replay validado; isso não autoriza retry de envio pelo consumidor.

O contrato de paginação existe, mas não oferece snapshot ou totais completos. Coleção legível vazia, original indisponível, alvo ausente e falha de consulta permanecem distintos. Execute os testes R-A do plano da sessão e a aceitação conectada; sem URL/DSN, um teste pulado não é evidência dessa integração.

## Prepare release e rollback sem mudar os limites

Na futura mudança de código, execute os testes focados, `npm run test:acceptance:send`, `npm run check` e `npx wrangler deploy --dry-run`. Registre o SHA dos dois repositórios e o toolchain usado. Confira o launcher contra os novos fontes antes de executar; ele deve falhar com dependência ausente ou overlay divergente. A atualização atual é documental e não executou essas suítes.

O relatório registra uma integração de leitura já publicada. Após autorização para nova release, confira a versão ativa e preserve esse trabalho antes de acrescentar W1 de envio. Confirme E1 ativo. No rollback planejado, retire novos envios de evento do consumidor antes de reverter a capacidade no backend. Preserve leituras, consulta de resultado, mensagens e segredos. Um writer antigo de votos não é compatível com o novo conflito por instância; rollback exige writer compatível, sem restaurar unicidade global. Falha inesperada não autoriza reenviar como documento ou texto.

RSVP de saída, edição, cancelamento, convites compartilháveis, capa, lembretes, convidados adicionais, link de chamada, chamada agendada, importação `.ics` e encaminhamento nativo permanecem fora de E1/W1 e E2/W2. A prova local valida contrato e protocolo; renderização em clientes e suporte de produção permanecem pendentes até homologação própria.
