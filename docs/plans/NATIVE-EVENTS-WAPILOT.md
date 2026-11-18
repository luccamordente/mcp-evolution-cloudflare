# Plano de implementação de eventos nativos no WaPilot

Status: proposta de implementação, em 11 de novembro de 2026. Este plano não implementa, publica nem envia eventos.

## Resultado esperado e dependência

Permitir que `send_message` crie um cartão nativo de evento no WhatsApp, com título, horário, descrição, local opcional e citação. `get_message` e `list_messages` devem ler os detalhes retidos desse evento.

O trabalho exige mudanças no Evolution Go. A implementação atual oferece os tipos protobuf na biblioteca, mas não a rota de criação nem a projeção de leitura. O recebimento de RSVP também é descartado. A [investigação com fontes fixadas](../NATIVE-WHATSAPP-EVENTS.md) demonstra esses limites.

Entregar ao time do backend o [handoff Evolution Go](NATIVE-EVENTS-EVO-GO-HANDOFF.md). Esse documento é a referência do contrato HTTP proposto e das condições para liberar o cliente. Não apresentar a existência dos tipos na biblioteca como evidência de suporte implantado.

| Entrega | Responsável | Dependência e conclusão |
| --- | --- | --- |
| E0: contrato e prova do armazenamento de segredo | Evolution Go, com revisão do WaPilot | Fixtures aprovadas e persistência antes do envio demonstrada. |
| E1: criação e leitura nativas | Evolution Go | Rota, citação, segredo e histórico tipado passam na aceitação conectada. |
| W1: integração do evento | WaPilot | Depende do contrato E1. Pode ser desenvolvida com fixture antes do deploy do backend. |
| R1: publicação controlada | Operadores dos dois serviços | Backend E1 implantado e conferido antes da publicação de W1. |
| E2/W2: recebimento e leitura de RSVP | Ambos, em entrega separada | Depende de E1 e do contrato de respostas da seção de continuidade. Não bloqueia a criação do cartão em W1. |

A refatoração para uma única ferramenta de envio já foi implementada. Não a repetir. As correções de SSE e demais achados da auditoria MCP pertencem a outro escopo. Evento do WhatsApp e MCP Events são conceitos diferentes.

## Uso proposto

O usuário chama a ferramenta existente. Todos os identificadores e valores abaixo são sintéticos.

```json
{
	"connectionId": "11111111-1111-4111-8111-111111111111",
	"idempotencyKey": "native-event-demo-1",
	"message": {
		"kind": "event",
		"to": "12025550123",
		"replyTo": { "messageId": "SYNTHETIC_SOURCE" },
		"event": {
			"name": "Encontro de demonstração",
			"description": "Evento fictício para validar o cartão nativo.",
			"startsAt": "2026-11-20T15:00:00-03:00",
			"endsAt": "2026-11-20T16:00:00-03:00",
			"location": {
				"name": "Local de exemplo",
				"address": "Endereço fictício",
				"latitude": -19.9321,
				"longitude": -43.9378
			}
		}
	}
}
```

Uma conversa de grupo usa `to: "120363000000000000@g.us"` e pode informar `replyTo.participant` com o JID do autor. O backend deve verificar a referência na instância e na conversa de destino.

O resultado conserva o comprovante de envio e o ID da mensagem. Envio aceito não comprova entrega, leitura, renderização do cartão ou disponibilidade de RSVP. A leitura posterior usa `get_message` com esse ID e a mesma conexão.

## Contrato público e normalização

Adicionar somente a variante abaixo à união discriminada existente. Os tipos deste trecho são um esboço, não exports novos obrigatórios.

```ts
type NativeEvent = {
	name: string;
	startsAt: string;
	endsAt?: string;
	description?: string;
	location?: {
		name: string;
		address?: string;
		latitude: number;
		longitude: number;
	};
};
type EventOutgoing = {
	kind: 'event';
	to: string;
	event: NativeEvent;
	replyTo?: { messageId: string; participant?: string };
};
```

Aplicar as mesmas regras nos dois lados da fronteira. Os limites são políticas propostas do produto, não limites universais do WhatsApp.

| Campo | Regra de W1 |
| --- | --- |
| Envelope | Preservar `connectionId?`, `idempotencyKey?` e `message`, com validação atual. |
| `message` | Aceitar somente `kind`, `to`, `event`, `replyTo?`. Rejeitar campos desconhecidos em todos os níveis. |
| `event.name`, `location.name` | Remover espaços nas extremidades. Exigir de 1 a 200 unidades UTF-16, conforme a convenção dos labels atuais. Conferir a mesma contagem no Go. |
| `description?` | Preservar conteúdo e espaços. De 1 a 10.000 unidades UTF-16 quando presente. Não converter vazio em ausência. |
| `address?` | Preservar conteúdo. De 1 a 1.000 unidades UTF-16 quando presente. |
| `startsAt`, `endsAt?` | RFC3339 com data válida, segundos inteiros e `Z` ou offset explícito. Rejeitar frações, leap second, datas sem fuso, números e rollover de calendário. Normalizar para UTC `YYYY-MM-DDTHH:mm:ssZ`, entre os anos 1970 e 9999. Término deve ser posterior ao início. |
| `location?` | Se presente, exigir nome e ambas as coordenadas finitas. Latitude entre -90 e 90, longitude entre -180 e 180. Aceitar zero e normalizar `-0` para `0`. |
| `to` | Conversa individual PN/LID ou grupo. Normalizar deterministicamente números para o JID PN antes do hash. Rejeitar Status, broadcast, newsletter e destinos malformados. Não presumir equivalência entre PN e LID sem evidência do provedor. |
| `replyTo?` | Reusar limites dos identificadores atuais. Verificar autor e conversa no backend antes de enviar ao WhatsApp. |

Não aplicar uma regra móvel de horário futuro na validação, pois a passagem do tempo não deve alterar o significado de uma repetição idempotente. A homologação usa eventos futuros. Se o produto ou os clientes exigirem outra política, defini-la explicitamente antes da implementação e preservar a consulta de ações anteriores.

Não incluir em W1 menções, delay, `formatJid`, ID personalizado, cancelamento, RSVP de saída, link de chamada, convidados adicionais, lembretes, capa ou chamada agendada. Não herdar `...chat` integralmente quando isso anunciar opções sem implementação.

`.ics` continua sendo um documento. Solicitações de evento nativo usam `kind: "event"`. Não mudar de formato por extensão, MIME, conteúdo de arquivo ou falha do backend. Importação de calendário exige um parser e uma ação explícita em entrega futura.

## Alterações por módulo

| Local | Trabalho previsto |
| --- | --- |
| `src/lib/send-message.ts` | Acrescentar a variante estrita; validar e normalizar os dados; montar fingerprint determinístico; resumir nome, horário e local no comprovante. Não criar uma segunda ferramenta ou um segundo sender. |
| `src/lib/evolution.ts` | Acrescentar `/send/event` no switch de `sendMessage`; traduzir datas ISO para segundos Unix e a citação para JSON:API; interpretar a projeção tipada de leitura. Manter POST sem retry. |
| `src/types.ts` | Acrescentar `Message.event` com os dados normalizados e `isCanceled` somente de leitura. O ID do evento é o ID da mensagem de criação; não inventar outro identificador. |
| `src/lib/mcp.ts` | Atualizar descrição e a condição de conteúdo disponível em `get_message`: um evento válido não precisa ter texto ou mídia. Preservar `structuredContent`, fallback textual e comprovante consistentes. |
| `src/lib/evolution.ts`, encaminhamento | Rejeitar encaminhamento genérico de evento nativo antes de POST. Não degradar o cartão para texto ou anexo. |
| Testes e fixture existentes | Expandir as suítes e o overlay Go existentes. Não criar outro servidor de teste para reproduzir os mesmos handlers. |
| Documentação | Atualizar `SEND-MESSAGE.md`, `TOOLS.md`, `DEPLOY.md`, a investigação e o glossário. Atualizar `ARCHITECTURE.md` apenas onde o contrato de dados mudar. |

HTTP e stdio devem continuar usando o mesmo schema de envio. Não mudar transporte, revisão MCP, OAuth, Access, isolamento de conexão ou bindings remotos do stdio.

## Sequência de implementação

1. **Fixar o contrato.** Copiar do handoff fixtures de criação mínima, grupo citado, leitura, rejeição e falha. Conferir nomes, encoding e unidades nos dois repositórios. Validar especificamente strings astral Unicode e coordenadas zero.
2. **Modelar a variante.** Implementar schema, normalização e comprovante. Construir os objetos canônicos em ordem fixa. Preservar ausência de opcionais e não incluir valores aleatórios no fingerprint.
3. **Conectar o adaptador.** Adicionar o POST e a projeção de leitura. Usar o cliente por instância já resolvido a partir de `(user_id, connection_id)`. O backend valida a citação dentro do POST, antes de chamar WhatsApp.
4. **Preservar a fronteira de idempotência.** Normalizar antes da reserva atual. Executar o POST somente no callback de uma ação nova. Não colocar GET de capacidade, leitura da citação ou outro requisito live antes da recuperação de um resultado já concluído.
5. **Adicionar leitura e indisponibilidade.** Ler eventos retidos em `get_message` e `list_messages`. Conteúdo inválido ou ausente deve produzir indisponibilidade explícita; não reconstruir o evento a partir do comprovante, texto, arquivo `.ics` ou D1.
6. **Executar a aceitação.** Rodar os testes da tabela seguinte e a fixture conectada contra o contrato E1. A captura precisa mostrar a mensagem nativa produzida pelo Go, não somente um mock da resposta HTTP.
7. **Preparar a release.** Registrar revisão do backend, fixtures e matriz de dispositivos. Publicar W1 somente depois de E1 estar implantado e conferido no destino.

O fingerprint inclui destino, todos os campos canônicos do evento e a referência citada. Datas com offsets equivalentes produzem o mesmo hash. PN e LID só são equivalentes quando o contrato conseguir provar isso; não adicionar uma consulta de identidade antes de um replay idempotente. Segredo, ID gerado pelo provedor, instante de envio e metadados de implantação ficam fora do hash.

Preservar a janela de 24 horas e a operação `send_message`. Não criar estados D1 nem namespace de idempotência específicos para evento. Uma falha do POST continua conservadoramente como resultado desconhecido quando o fluxo atual não consegue provar ausência de envio. Nenhuma falha autoriza trocar a chave ou usar outro tipo de mensagem.

## Aceitação do WaPilot

| ID | Cenário | Resultado observável |
| --- | --- | --- |
| W-A1 | Catálogos HTTP e stdio | Só `send_message` envia. Ambos anunciam a mesma variante `event`; os quatro nomes legados continuam ausentes. |
| W-A2 | Schema e calendário | Campos desconhecidos, `.ics` como evento, datas inválidas ou sem fuso, milissegundos e opcionais incompatíveis falham antes de POST. |
| W-A3 | Normalização | `2026-11-20T15:00:00-03:00` e `2026-11-20T18:00:00Z` geram o mesmo instante, wire e fingerprint. Término igual/anterior falha. |
| W-A4 | Corpo HTTP | A fixture recebe `/send/event`, `application/vnd.whatsapp.event` e `startTime: 1795197600`; nenhuma chamada usa `/send/media`. |
| W-A5 | Mensagem nativa conectada | O caminho MCP → D1 local → HTTP real Go captura `EventMessage`, contexto correto, segredo de 32 bytes e nenhum `DocumentMessage`. Há round-trip protobuf e leitura tipada por ID. |
| W-A6 | Autorização e citações | Sem `mcp:write`, conexão de outro usuário ou citação de outra conversa/autor/instância: nenhum envio WhatsApp. Testar conversa individual e grupo separadamente. |
| W-A7 | Idempotência | Concorrência e repetição da mesma ação enviam uma vez; alterar nome, horário, local, destino ou citação causa conflito. Resultado concluído continua recuperável com provedor fora do ar ou citação expirada. |
| W-A8 | Falha e recuperação | Timeout após dispatch, falha de persistência e erro de auditoria preservam os resultados previstos pelo mecanismo atual. Nenhum POST automático adicional, fallback ou nova chave. |
| W-A9 | Leitura | Evento sem texto/mídia é legível. Ausência, evento malformado, `isCanceled` de leitura e histórico parcial têm resultados explícitos. Não inventar RSVP ou participantes. |
| W-A10 | Confidencialidade | Respostas, logs, auditoria, fingerprint e notificações não contêm segredo, protobuf bruto, credenciais ou conteúdo de evento desnecessário. D1 não recebe arquivo de eventos ou participantes. |
| W-A11 | Regressões | As 18 variantes anteriores, comprovantes, lookup legado e bloqueio entre namespaces continuam funcionando. Encaminhamento de evento falha sem degradar seu formato. |
| W-A12 | Dispositivos autorizados | Android, iOS e WhatsApp Web mostram cartão, detalhes e horário local corretos; citação e dispositivos vinculados são verificados. Aceite HTTP sozinho não passa este critério. |

Usar `test/send-message.test.ts`, `test/send-message-backend.test.ts`, `test/evolution-routes.test.ts`, `test/send-idempotency.test.ts`, `test/mcp-messages.test.ts`, `test/mcp-schema.test.ts`, `test/stdio.test.ts` e os testes de comprovante pertinentes. Expandir `scripts/send-acceptance-backend.go` e seu launcher para o contrato novo, sem modificar permanentemente o checkout canônico.

Executar `npm run check`, `npm run test:acceptance:send` e `npx wrangler deploy --dry-run` com Node 22+. Quando Docker não estiver disponível, registrar o uso de `--containers-rollout none` e a ausência de verificação da imagem. Não acrescentar testes que apenas espelhem uma função ou dispensem a fronteira nativa.

## Publicação e rollback

1. O time Evolution Go entrega a revisão E1, o contrato e os resultados dos testes descritos no handoff. A presença da rota em `main` não basta.
2. Conferir a versão realmente implantada, autenticação por instância, armazenamento de segredos e projeção de leitura. Não sondar suporte com um envio sem autorização.
3. Até esse ponto, manter a release atual do WaPilot, cujo catálogo não inclui `event`. W1 pode ficar pronto em branch com a fixture. Não acrescentar flags nem consultas de capacidade por request somente para substituir essa ordem de deploy.
4. Publicar W1 com autorização de publicação e conferir saúde, desafio OAuth, catálogo e bindings preservados. Atualizar os catálogos dos clientes e confirmar que a variante aparece.
5. Executar a homologação com conteúdo, conexão e destinatários autorizados. Guardar evidência redigida das versões dos clientes e da renderização. Se uma classe de destino não passar, corrigir ou restringir o contrato explicitamente antes da liberação.
6. Em rollback planejado, remover primeiro a criação de eventos do WaPilot, conservando o parser de leitura e `get_send_status`; só depois voltar o backend. Não apagar segredos ou histórico retido como parte do rollback. Falha inesperada de versão continua sem replay automático.

Não há migration D1, segredo novo, allowlist de mídia ou mudança de infraestrutura prevista para W1. Se a implementação descobrir necessidade real, revisar o plano antes de ampliar o armazenamento. A homologação futura exige autorização própria; este documento não autoriza novos envios.

## Continuidade de RSVP e capacidades adiadas

E2 deve decifrar e normalizar respostas recebidas no provedor. W2 poderá acrescentar `message.eventResponse` às leituras existentes, com referência ao evento, resposta e timestamp, sem afirmar uma lista completa de participantes a partir de histórico parcial.

Estado agregado de participantes, paginação de respostas e notificações de RSVP exigem contratos próprios antes de anúncio. Não reutilizar automaticamente `message.received` para respostas de controle. Uma nova notificação precisa respeitar o ADR 0002, as assinaturas autorizadas e a retenção temporária existente.

RSVP de saída, edição, cancelamento, convites compartilháveis, capa, lembretes, chamada agendada, convidados adicionais, link de chamada, importação `.ics` e encaminhamento nativo ficam fora de W1. Cada capacidade precisa de construção real, serialização, política de autoria e aceitação próprias.

## Decisão de desenho

O desenho escolhido usa uma rota tipada e identifica o evento pela mensagem de criação. As alternativas eram um agregado de evento com identidade própria ou um novo dispatcher genérico no provedor. Ambos acrescentam contratos sem resolver melhor a primeira entrega.

Concentrar a construção e os segredos no backend preserva um único dono do histórico. Manter criação/leitura e RSVP como entregas distintas permite verificar o cartão antes de prometer coleta de respostas. A aceitação usa o artefato nativo para aplicar Prove It Works; as repetições usam o mecanismo existente, conforme Make Operations Idempotent.
