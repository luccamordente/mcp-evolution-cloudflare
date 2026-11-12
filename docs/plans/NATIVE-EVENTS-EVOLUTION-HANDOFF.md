# Handoff para implementar eventos nativos no Evolution Go

Status: contrato proposto e plano de implementação, em 11 de novembro de 2026. Destino: `https://github.com/neurau/evolution-go`. Não há implementação, deploy ou envio autorizado por este documento.

## Pedido e situação atual

Implementar criação de cartão nativo de evento e leitura dos seus detalhes pela API. O consumidor WaPilot tem uma única ferramenta `send_message`; enviará uma variante `event` para uma rota tipada. Um arquivo `.ics` enviado como documento deve continuar sendo documento.

A referência consultada é `main` em `0d361bd7abb6562aaf305a1e185559acea88daf0`, árvore `26ccc3fb4316c675e814db116f28dc1d2198ba30`, com whatsmeow `v0.0.0-20261105212532-307a2edf117d`. A revisão foi reconferida pela API do GitHub em 11 de novembro. O `git pull --ff-only` do checkout canônico falhou por ausência de autenticação Git; os arquivos já conferidos correspondem à árvore indicada. Isso não identifica a revisão implantada em produção.

Na referência há `waE2E.EventMessage`, mas não `/send/event` ou `/send/raw`. O classificador descarta `EncEventResponseMessage`, e o encoder não oferece detalhes tipados de evento. Fontes e análise estão em [NATIVE-WHATSAPP-EVENTS.md](../NATIVE-WHATSAPP-EVENTS.md). Este handoff contém o contrato necessário sem exigir leitura do código WaPilot.

Se este arquivo for copiado para outro repositório, a [investigação publicada](https://github.com/luccamordente/mcp-evolution-cloudflare/blob/eedc594/docs/NATIVE-WHATSAPP-EVENTS.md) conserva o contexto e as fontes. As referências principais são o [registro de rotas](https://github.com/neurau/evolution-go/blob/0d361bd7abb6562aaf305a1e185559acea88daf0/pkg/routes/routes.go#L117-L136), o [schema nativo](https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/proto/waE2E/WAWebProtobufsE2E.proto#L2029-L2050), o [armazenamento do segredo no envio](https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/send.go#L402-L411) e o [descarte atual de RSVP](https://github.com/neurau/evolution-go/blob/0d361bd7abb6562aaf305a1e185559acea88daf0/pkg/utils/utils.go#L540-L546).

Entregar em marcos separados:

- **E0:** provar o contrato, a serialização e o armazenamento do segredo antes do dispatch.
- **E1:** criar eventos e expor detalhes retidos em mensagens. Esta é a dependência obrigatória para o WaPilot exibir a variante.
- **E2:** receber e normalizar RSVP, sem prometer edição, envio de RSVP ou contagens completas de participantes.

## Contrato HTTP E1

Adicionar `POST /send/event`. Autenticar com o token da instância no header `apikey`, usando os mesmos limites e isolamento das demais rotas de instância. A chave administrativa não substitui esse token.

Request e response usam `application/vnd.api+json`. O corpo abaixo é uma proposta, com dados sintéticos.

```json
{
	"data": {
		"type": "message",
		"attributes": {
			"encodingFormat": "application/vnd.whatsapp.event",
			"body": {
				"event": {
					"name": "Encontro de demonstração",
					"description": "Evento fictício para validar o cartão nativo.",
					"startTime": 1795197600,
					"endTime": 1795201200,
					"location": {
						"name": "Local de exemplo",
						"address": "Endereço fictício",
						"latitude": -19.9321,
						"longitude": -43.9378
					}
				}
			}
		},
		"relationships": {
			"recipient": {
				"data": { "type": "chat", "id": "12025550123@s.whatsapp.net" }
			},
			"quoted": {
				"data": { "type": "message", "id": "SYNTHETIC_SOURCE" }
			}
		}
	}
}
```

`application/vnd.whatsapp.event` é um marcador privado proposto para este contrato, não um MIME oficial do WhatsApp. Início e término do exemplo são `2026-11-20T18:00:00Z` e `2026-11-20T19:00:00Z`. O WaPilot aceita instantes com fuso e os converte para segundos inteiros no wire.

Uma citação de grupo pode acrescentar `relationships.quoted.data.meta.participant` com o JID do autor. Não aceitar outro metadata de escrita, `included`, lote de recursos, `data.id`, campos legados paralelos ou envelope protobuf arbitrário.

### Validação obrigatória

| Parte | Campos e regra |
| --- | --- |
| Documento | Exatamente um `data` objeto. Rejeitar JSON duplicado, conteúdo após o documento, `null`, arrays e campos desconhecidos. Usar o limite HTTP existente. |
| Recurso | `type: "message"`, `attributes` e `relationships`. |
| Atributos | Exatamente `encodingFormat` com o marcador acima e `body`. |
| Corpo | Exatamente `event`. |
| Evento de criação | Obrigatórios `name`, `startTime`. Opcionais `description`, `endTime`, `location`. Nenhum outro campo. |
| Nome do evento/local | Trim, de 1 a 200 unidades UTF-16. Definir a contagem no Go para coincidir com o consumidor JavaScript. |
| Descrição/endereço | Se presentes, exigir string não vazia e preservar espaços. Limites de 10.000 e 1.000 unidades UTF-16, respectivamente. |
| Tempo | `startTime` e `endTime` são inteiros Unix em segundos, de 0 a 253402300799. Rejeitar forma decimal, expoente, strings e milissegundos. Término deve ser posterior ao início. |
| Local | Obrigatórios `name`, `latitude`, `longitude`; `address?`. Números finitos nos intervalos geográficos. Zero é válido; presença não pode ser inferida pelo valor numérico. |
| Relações | Exatamente `recipient` obrigatório e `quoted?`. Linkage único, tipos `chat` e `message` respectivamente. Somente `meta.participant?` é permitido na mensagem citada. |
| Destino | Individual PN/LID ou grupo. Resolver identidade pelos mecanismos existentes. Rejeitar Status, broadcast, newsletter e JIDs inválidos. |

São limites de contrato propostos. Se o backend ou a homologação exigirem outros limites, alterar as fixtures e os dois planos antes da implementação do cliente.

Não aplicar uma validação que mude apenas pela passagem do tempo entre duas chamadas idempotentes do consumidor. Usar datas futuras na homologação. Não truncar silenciosamente tempos ou textos.

### Response e erros

Reusar o envelope de mensagem enviada já consumido pelas demais rotas: `data.type: "message"`, ID real retornado pelo envio, identidade da conversa e instante de aceite. Não criar outro `eventId`. Aceite significa aceite do envio, não confirmação de entrega, leitura, cartão renderizado ou armazenamento completo de participantes.

Erros de validação, autenticação, identidade, citação e armazenamento anterior ao dispatch devem terminar sem chamar WhatsApp. Usar os status e o envelope JSON:API do projeto, com código estável e mensagem sanitizada.

Se o envio externo já puder ter ocorrido, devolver um resultado que não afirme ausência de envio nem recomende retry. Não repetir automaticamente o write. Os testes devem distinguir falha anterior ao dispatch de timeout/falha posterior. Não prometer exatamente uma vez para clientes que repetem POSTs independentes.

Não devolver segredo, chave de mídia, credencial, raw protobuf ou conteúdo sensível em erros, resposta, webhook, histórico público ou logs. Não refletir cegamente o request original na resposta.

## E0: resolver identidade e persistência do segredo

1. Conferir a versão fixada do whatsmeow e criar um teste local de construção/round-trip de `EventMessage`. Não atualizar a dependência como tentativa genérica de correção.
2. Conferir a API de `MsgSecrets`, a identidade usada por PN/LID e o ponto de geração do ID da mensagem no caminho real de envio. Definir como prealocar esse ID e fornecer o mesmo ID ao `SendMessage`.
3. Provar a gravação durável de um segredo de 32 bytes antes da primeira chamada externa. A gravação posterior do SDK pode registrar apenas um aviso em caso de erro; isso não satisfaz este requisito.
4. Se a API atual não permitir a ordem necessária, implementar um helper localizado/revisado ou ajustar o caminho de envio. Não liberar E1 supondo que o segredo será salvo. Não criar um armazenamento de segredos no consumidor WaPilot.
5. Testar falha da gravação, restart e releitura pelo par conversa/autor/ID correto. Conferir a política atual de retenção e documentar por quanto tempo evento e segredo podem ser recuperados. Não anunciar RSVP quando faltar qualquer um deles.

Uma falha comprovada antes do envio pode limpar a preparação conforme a política do provedor. Resultado desconhecido precisa conservar o segredo necessário à eventual mensagem enviada. Não apagar o segredo para fazer rollback ou repetir uma ação desconhecida com outro ID.

## E1: construir, enviar e ler o evento

### Mapa de alterações

| Local | Alteração esperada |
| --- | --- |
| `pkg/routes/routes.go` | Registrar a rota de instância com o middleware de autenticação existente. |
| `pkg/jsonapi/middleware.go`, `request.go` | Validar estritamente o documento original da rota antes de qualquer tradução genérica que descarte campos. Preservar compatibilidade das demais rotas. |
| `pkg/sendMessage/handler/send_handler.go` | Decodificar um request tipado e validado, sem aceitar campos protobuf ou legado paralelo. |
| `pkg/sendMessage/service/send_service.go` e helper local, se necessário | Acrescentar `SendEvent` à interface e implementar o construtor nativo; reusar o sender existente. |
| Switch de contexto no serviço de envio | Aplicar citação em `EventMessage.ContextInfo`, após validar a mensagem de origem. |
| Persistência/encoder de mensagem e `pkg/jsonapi/encode.go` | Expor evento tipado nas respostas, status e busca; não serializar o segredo no corpo público. |
| Testes e documentação do backend | Fixture HTTP real, captura nativa, persistência, normalização, OpenAPI e exemplos. |

### Construção nativa

O construtor recebe somente evento validado, destino resolvido, citação verificada e segredo gerado no serviço. A saída interna é:

```text
Message
  EventMessage
    name, description?, startTime, endTime?, location?
    ContextInfo: citação verificada, quando presente
    isCanceled: false
  MessageContextInfo
    messageSecret: 32 bytes de crypto/rand
```

Gerar o segredo apenas para um novo envio efetivo, nunca no schema do consumidor ou no cálculo de idempotência. Não aceitar segredo do cliente. Não usar gerador pseudoaleatório ou segredo fixo.

Reusar a serialização protobuf, criptografia Signal, envio individual/grupo e cópia para dispositivos vinculados do whatsmeow. Não introduzir wrappers de documento, view-once ou edição secreta por analogia. Se um wrapper se provar necessário na homologação, registrar a evidência e atualizar as fixtures antes de anunciá-lo.

A citação deve ser carregada no escopo da instância autenticada. Conferir a conversa de destino e o autor, usando identidade PN/LID verificável. Falta de retenção ou identidade inconclusiva deve impedir o envio citado; não remover silenciosamente a citação nem citar outra mensagem. Essa validação ocorre dentro do POST antes de WhatsApp, permitindo que o consumidor recupere um resultado idempotente sem outra leitura live.

### Leitura retida

Projetar eventos enviados e recebidos como mensagens existentes em `/message/status` e `/message/search`, sem nova coleção `/events`.

Usar `attributes.encodingFormat: "application/vnd.whatsapp.event"` e `attributes.body.event` com os campos da criação, mais `isCanceled` somente de leitura. Preservar ID, conversa, autor, `fromMe`, horário e citação pelos campos atuais. Os tempos do evento permanecem em segundos Unix.

Não exigir texto ou mídia para considerar um evento como conteúdo disponível. Não afirmar aplicação de cancelamento/edição se o processamento dessas atualizações não estiver implementado. `isCanceled` representa apenas o valor disponível no envelope retido.

Se o conteúdo não estiver retido ou não for decodificável, preservar os metadados disponíveis e o diagnóstico explícito de indisponibilidade. Não fabricar um evento vazio, substituir por resumo textual ou devolver raw protobuf no fallback. A existência do envio não garante retenção posterior.

### Critérios de aceitação E0/E1

| ID | Prova exigida |
| --- | --- |
| E-A1 | Request mínimo e completo passam por roteador, autenticação, JSON:API, handler e serviço reais, com somente a fronteira WhatsApp substituída. |
| E-A2 | Dados desconhecidos, chaves duplicadas, body misto, tipos errados, `null`, frações, milissegundos, overflow e texto excedente produzem erro sem envio. |
| E-A3 | Captura nativa contém `EventMessage`, os segundos esperados e segredo aleatório de 32 bytes no local correto. `proto.Marshal` e `proto.Unmarshal` preservam os dados. Não há `DocumentMessage`. |
| E-A4 | Segredos de duas criações diferem. Falha da persistência anterior ao dispatch envia zero mensagens. Restart conserva o segredo e seu vínculo ao ID realmente enviado. |
| E-A5 | Individual PN, LID e grupo são exercitados separadamente. Citações sem participante, com participante correto, de outra conversa/instância e com alias não comprovado têm resultados previstos. Rejeições enviam zero mensagens. |
| E-A6 | Latitude/longitude zero, valores extremos, presença de opcionais e limites UTF-16 são preservados. Nome vazio e coordenada ausente não passam. |
| E-A7 | Resposta de aceite, mensagem retida enviada/recebida, status e busca oferecem o mesmo ID e evento sem expor segredo ou envelope interno. Evento sem texto/mídia é legível. |
| E-A8 | Timeout depois do dispatch, gravação posterior e auditoria falha não geram segundo envio nem apagam segredo de uma mensagem possivelmente enviada. |
| E-A9 | Token de outra instância ou credencial administrativa inadequada não acessa o envio ou a leitura. Logs e erros permanecem sanitizados. |
| E-A10 | `.ics` na rota de documento continua documento. Evento não passa pela rota de mídia e não é encaminhado implicitamente como texto/documento. |
| E-A11 | As demais rotas mantêm comportamento, autenticação, resposta e tradução JSON:API. A validação nova não altera permissivamente o contrato delas. |
| E-A12 | Em homologação autorizada, Android/iOS/Web exibem cartão, detalhes, horário local, citação e cópia vinculada. Registrar versões e resultados por classe de destinatário. |

Executar as suítes dos pacotes alterados e a suíte de regressão do repositório com o toolchain de `go.mod`. Fixtures não usam conta real. A homologação de dispositivos precisa de autorização separada para conexão, conteúdo e destinatário.

## E2: receber e normalizar RSVP

Este marco é adicional. E1 pode entregar o cartão antes de oferecer coleta de respostas ao WaPilot. Para E2:

1. Identificar `EncEventResponseMessage` antes do descarte atual em `pkg/utils/utils.go` e do retorno antecipado em `pkg/whatsmeow/service/whatsmeow.go`.
2. Resolver a mensagem de criação, autor e respondente reais na mesma instância/conversa. Buscar o segredo em `MsgSecrets`. Não derivar identidade por concatenação arbitrária ou remover sufixos PN/LID.
3. Decifrar e validar com os mecanismos de segredo da versão fixada. O domínio `Event Response`, a derivação HKDF, o IV e o dado autenticado precisam seguir a biblioteca, sem criptografia independente no WaPilot.
4. Normalizar a resposta em uma mensagem retida tipada. Propor `application/vnd.whatsapp.event-response`, com `body.eventResponse` contendo `eventMessageId`, `response`, `timestampMS` e `extraGuestCount` quando presente. Preservar conversa e autor na identidade normal da mensagem. Fixar esse contrato com o consumidor antes da implementação W2.
5. Expor `GOING`, `NOT_GOING` e `MAYBE` como valores explícitos. `UNKNOWN`, segredo ausente, mensagem original expirada ou payload inválido produzem diagnóstico próprio, sem adivinhar a intenção.
6. Definir deduplicação por identidade de mensagem e ordenação por timestamp do protocolo. Para empates entre respostas distintas, preservar a ambiguidade e não inventar uma resposta mais recente. Agregação completa/paginação exige contrato adicional.
7. Não emitir respostas de controle como um webhook genérico de nova mensagem para consumidores antigos. Manter notificações de RSVP fora de E2 até existir um tipo/contrato de webhook revisado pelos consumidores. Leituras tipadas do provedor são suficientes para este marco.

Testar fixture cifrada válida, os três valores de resposta, convidados extras, mensagem duplicada, ordem invertida, empate, PN/LID, restart, chave ausente, conversa/autor errados, IV/payload alterados e isolamento entre instâncias. Falhas não podem se transformar em resposta positiva nem expor segredo ou bytes cifrados no JSON público.

O estado e a retenção de respostas pertencem ao provedor. Este handoff não transfere histórico, segredos ou ledger de participantes para D1 do WaPilot. Não afirmar número completo de participantes quando só há mensagens parcialmente retidas.

## Entrega ao consumidor e ordem de publicação

Fornecer ao time WaPilot os seguintes artefatos:

1. SHA da revisão e versão realmente implantada, com o toolchain e versão whatsmeow usados.
2. Fixtures JSON de request mínimo, grupo citado, response de aceite, leitura e rejeição, incluindo unidades e limites. Compartilhar também exemplos E2 somente quando esse marco passar.
3. Resultado da aceitação nativa e prova de persistência/restart do segredo, sem o segredo no relatório.
4. Documentação/OpenAPI da rota e dos erros. Descrever ausência de retry de escrita e os casos de resultado desconhecido.
5. Evidência redigida por dispositivo e destinatário quando a homologação estiver autorizada. Separar teste de protocolo de renderização real.

Implantar E1 antes de o WaPilot publicar `kind: "event"`. A conferência de readiness é uma etapa de release com revisão real; este plano não exige endpoint de capacidades, feature flag ou preflight live por envio. A falta de E1 mantém a variante fora da release do consumidor.

Em rollback planejado, desabilitar primeiro novos envios de evento no consumidor, preservando leituras e consultas de resultado, e só depois voltar o backend. Não apagar mensagens ou segredos para reverter código. Falha inesperada do endpoint não autoriza o consumidor a reenviar, mudar a chave ou usar documento como fallback.

## Fora de E1/E2

Não implementar neste pedido RSVP de saída, edição, cancelamento, convites compartilháveis, capa, lembretes, convidados adicionais, link de chamada, chamada agendada, importação `.ics` ou encaminhamento nativo. Esses campos ou tipos podem existir no protocolo, mas cada operação precisa de contrato, autoria, serialização e testes próprios. Também não criar uma rota de protobuf arbitrário.

O [plano WaPilot](NATIVE-EVENTS-WAPILOT.md) define a integração do consumidor e os testes de ponta a ponta. Mudanças de nomes, limites ou envelope neste handoff devem atualizar as fixtures e esse plano no mesmo ciclo de revisão.
