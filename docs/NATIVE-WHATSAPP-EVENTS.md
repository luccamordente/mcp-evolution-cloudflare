# Eventos nativos do WhatsApp

Investigação em 11 de novembro de 2026. Este documento explica por que o exemplo `.ics` é um anexo e registra o trabalho necessário para criar um evento com RSVP no WaPilot. Não implementa envio nem comprova suporte em produção.

## Por que o exemplo aparece como arquivo

O exemplo relatado nesta sessão usou `message.kind: "document"`, `mimeType: "application/octet-stream"` e `fileName: "wapilot-evento-exemplo.ics"`, com conteúdo `VCALENDAR`. O recebimento como `text/calendar` também foi relatado. Esses resultados operacionais não foram reproduzidos nesta investigação.

O caminho no código é verificável:

1. O schema de [`send_message`](../src/lib/send-message.ts) aceita documentos `application/*` e não declara uma variante `event`. Enviar `text/calendar` diretamente nesse campo falha na validação atual.
2. O [adaptador de envio](../src/lib/evolution.ts) converte `document` em `POST /send/media`, com bytes Base64 e nome de arquivo.
3. O backend constrói `waE2E.DocumentMessage`. Se houver legenda, envolve o documento em `DocumentWithCaptionMessage`. Não interpreta `VCALENDAR` para construir `EventMessage`. A detecção de MIME do arquivo não muda essa escolha de mensagem. Fonte: [construção do documento no backend](https://github.com/neurau/evolution-go/blob/0d361bd7abb6562aaf305a1e185559acea88daf0/pkg/sendMessage/service/send_service.go#L980-L1222).

A conclusão é que o envio percorreu o contrato de anexo. Alterar extensão, legenda ou MIME não fornece o contrato nativo ausente. Aceite HTTP de um documento também não comprova criação de evento. Uma futura conversão de `.ics` para evento precisa ser uma ação explícita do usuário. Não deve ocorrer automaticamente por MIME ou extensão, pois muda o significado e os efeitos do envio.

## Fontes e versões conferidas

O checkout canônico usado foi `.scratch/evolution-go`. Antes da leitura, `git pull --ff-only` foi executado e falhou por ausência de autenticação Git. A API autenticada do GitHub confirmou `main` em `0d361bd7abb6562aaf305a1e185559acea88daf0`, com árvore `26ccc3fb4316c675e814db116f28dc1d2198ba30`. Essa árvore coincide com a árvore do checkout local, cujo HEAD é `40d7e022add1d4537b62d5f90d95fc9d2a608616`. Isso verifica os arquivos consultados, não a versão implantada. Fonte: [commit de `main`](https://github.com/neurau/evolution-go/commit/0d361bd7abb6562aaf305a1e185559acea88daf0).

O [go.mod do backend](https://github.com/neurau/evolution-go/blob/0d361bd7abb6562aaf305a1e185559acea88daf0/go.mod#L3-L33) fixa Go `1.26.0` e `go.mau.fi/whatsmeow v0.0.0-20261105212532-307a2edf117d`. A revisão completa do whatsmeow é `307a2edf117da3cb1e5e672332c06969c75a54e9`. O cache de módulos local permitiu ler exatamente essa dependência.

Como confirmação independente de construção, foi consultado o repositório principal WhiskeySockets/Baileys, commit `81345beb67ca3fb0eb79a2c20cd4ac24da517929`, de 26 de outubro de 2026. Ele não é dependência do WaPilot e não será introduzido por esta pesquisa. Seu código mostra uma implementação de evento, enquanto o whatsmeow fornece os tipos e o transporte usados pelo backend.

## O WhatsApp oferece eventos em conversas individuais e grupos

A [ajuda oficial de criação](https://faq.whatsapp.com/3313983622238973/?cms_platform=web) descreve eventos em conversas individuais e grupos, com nome, horário, descrição, término, localização, link de chamada e convidados adicionais. A [ajuda de respostas](https://faq.whatsapp.com/3855462068110340/?cms_platform=web) descreve as opções de comparecimento, incluindo possibilidade de convidado, e notificações de alterações ou cancelamento. Portanto, restringir a pesquisa a grupos excluiria um caso atualmente documentado.

Há uma diferença entre versões do produto. A ajuda consultada limita o encaminhamento de eventos de conversa. O [anúncio oficial de 5 de novembro de 2026](https://blog.whatsapp.com/whatsapp-events-brings-people-together-beyond-the-group-chat) anuncia convites compartilháveis, capa e uma área de eventos, com distribuição gradual nas semanas seguintes. Não há base para transformar uma dessas descrições em garantia universal por conta ou dispositivo. Convites compartilháveis e capa exigem uma investigação própria antes de fazer parte do contrato do WaPilot.

## A mensagem necessária tem estrutura própria

Na dependência fixada, `waE2E.Message` tem `eventMessage`, `encEventResponseMessage` e `secretEncryptedMessage`. `EventMessage` inclui os seguintes campos:

| Campo | Representação |
| --- | --- |
| `contextInfo` | Contexto de conversa, separado do segredo da mensagem. |
| `name`, `description` | Nome e descrição. |
| `startTime`, `endTime` | Inteiros de tempo. |
| `location` | `LocationMessage`. |
| `joinLink` | Link associado ao evento. |
| `isCanceled` | Estado de cancelamento. |
| `extraGuestsAllowed` | Permissão de convidados adicionais. |
| `isScheduleCall` | Indicador de chamada agendada. |
| `hasReminder`, `reminderOffsetSec` | Configuração de lembrete. |

O RSVP é outro tipo: `EventResponseMessage` possui `UNKNOWN`, `GOING`, `NOT_GOING`, `MAYBE`, `timestampMS` e `extraGuestCount`. O envelope `EncEventResponseMessage` referencia a chave da mensagem de criação e contém payload e IV cifrados. Fonte: [schema da dependência](https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/proto/waE2E/WAWebProtobufsE2E.proto#L2029-L2050), [schema do RSVP](https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/proto/waE2E/WAWebProtobufsE2E.proto#L208-L221).

### Criação, contexto e serialização

A [implementação principal do Baileys](https://github.com/WhiskeySockets/Baileys/blob/81345beb67ca3fb0eb79a2c20cd4ac24da517929/src/Utils/messages.ts#L530-L551) constrói um `eventMessage` diretamente e acrescenta `messageContextInfo.messageSecret` de 32 bytes aleatórios no nível de `Message`. Converte início e término de `Date` para segundos Unix. Isso resolve a unidade de tempo com evidência de implementação, pois o nome `startTime` no protobuf sozinho não a especifica.

Um contrato futuro deve aceitar um instante com fuso explícito, normalizar para UTC e emitir segundos inteiros em `startTime` e `endTime`. O RSVP usa milissegundos em `timestampMS`. Misturar essas unidades altera a data. Regras como término posterior ao início são validações propostas para o WaPilot, não garantias dadas pelo protobuf.

No whatsmeow, `SendMessage` gera `MessageSecret` automaticamente apenas quando o modo bot ou a configuração de reporting exige o segredo. A construção do evento deve fornecê-lo explicitamente. O transporte registra o segredo em `MsgSecrets`, associado a conversa, remetente e ID. Uma falha nesse registro pode resultar apenas em aviso, portanto a aceitação precisa verificar a persistência necessária ao RSVP. Fontes: [geração condicional](https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/send.go#L239-L250), [registro do segredo](https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/send.go#L402-L411), [condição de reporting](https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/reportingtoken.go#L39-L47).

O transporte serializa `waE2E.Message` por protobuf. Para dispositivos próprios em conversas individuais, também constrói `DeviceSentMessage`; grupos usam o caminho de distribuição e criptografia de grupo. A classificação externa pode ser `text`, mesmo com `EventMessage`, pois o classificador tem esse fallback. Isso não converte o conteúdo em texto. Fontes: [serialização e cópia para dispositivos](https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/send.go#L1257-L1279), [envio a grupo](https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/send.go#L754-L838), [classificação](https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/send.go#L932-L961).

Não foi encontrada uma exigência de envolver a criação em `ViewOnceMessage`, `DocumentWithCaptionMessage` ou `SecretEncryptedMessage`. O construtor Baileys usa o evento direto; seu [envolvimento em view-once](https://github.com/WhiskeySockets/Baileys/blob/81345beb67ca3fb0eb79a2c20cd4ac24da517929/src/Utils/messages.ts#L614-L616) é opcional. `SecretEncryptedMessage` tem outro papel na edição. Um exemplo de terceiros que acrescente wrappers não basta para tratá-los como obrigatórios. A forma final deve ser comparada com uma criação genuína no cliente WhatsApp durante homologação autorizada.

A citação usa `EventMessage.ContextInfo`; o segredo permanece em `Message.MessageContextInfo`. O backend atual aplica citações por um switch que não inclui evento. Acrescentar uma rota sem acrescentar esse caso perde a referência citada. Fonte: [switch de contexto do remetente](https://github.com/neurau/evolution-go/blob/0d361bd7abb6562aaf305a1e185559acea88daf0/pkg/sendMessage/service/send_service.go#L2226-L2299).

### RSVP e edição têm criptografia adicional

O código whatsmeow define o domínio `Event Response`. Deriva a chave com HKDF-SHA256, usando o segredo original, ID da criação, autor, respondente e domínio. Cifra com AES-GCM e IV de 12 bytes; o dado autenticado inclui o ID e o respondente. Logo, enviar um enum de RSVP em JSON ou texto não equivale a responder ao evento. Fonte: [derivação e criptografia](https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/msgsecret.go#L107-L228).

Na revisão fixada não há helpers tipados equivalentes a `BuildEventCreation` ou `DecryptEventResponse`. Há operações genéricas de segredo em [DangerousInternalClient](https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/internals.go#L426-L432). Uma implementação requer adaptação localizada e testes de compatibilidade, ou um helper upstream revisado. Identidades PN e LID precisam ser resolvidas conforme o autor real e o armazenamento, sem trocar JIDs por concatenação arbitrária.

Para edição, existe `DecryptSecretEncryptedMessage` com `EVENT_EDIT` e domínio `Event Edit`. Isso demonstra suporte a decodificação de edição cifrada, não uma operação pronta de editar ou cancelar eventos. A autorização de autoria e o alvo original ainda precisam de contrato. Fonte: [decodificação da edição](https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/msgsecret.go#L322-L355).

## O backend ainda interrompe o caminho do evento

O [registro de rotas](https://github.com/neurau/evolution-go/blob/0d361bd7abb6562aaf305a1e185559acea88daf0/pkg/routes/routes.go#L117-L136) não contém `/send/event` nem `/send/raw`. A [interface SendService](https://github.com/neurau/evolution-go/blob/0d361bd7abb6562aaf305a1e185559acea88daf0/pkg/sendMessage/service/send_service.go#L41-L57) também não oferece criação de evento. A presença dos tipos protobuf não altera esse contrato HTTP.

Há ainda dois limites de leitura:

- O classificador reconhece `EventMessage`, mas devolve `ignore` para `EncEventResponseMessage`. O handler retorna antes da continuação do processamento. Portanto, o RSVP é descartado nesse caminho de recebimento. Fontes: [classificador](https://github.com/neurau/evolution-go/blob/0d361bd7abb6562aaf305a1e185559acea88daf0/pkg/utils/utils.go#L540-L546), [retorno antecipado](https://github.com/neurau/evolution-go/blob/0d361bd7abb6562aaf305a1e185559acea88daf0/pkg/whatsmeow/service/whatsmeow.go#L1769-L1773).
- O [encoder JSON:API](https://github.com/neurau/evolution-go/blob/0d361bd7abb6562aaf305a1e185559acea88daf0/pkg/jsonapi/encode.go#L528-L650) não normaliza campos de evento ou RSVP. Mensagens não reconhecidas podem virar metadados de protocolo e `application/octet-stream`, sem corpo estruturado de evento. Reconhecer o tipo no utilitário não fornece leitura semântica ao MCP.

Criar o cartão, receber RSVP, consultar participantes, editar, cancelar e compartilhar convite são capacidades distintas. Implementar somente a primeira não autoriza anunciar as demais.

## Plano de implementação e aceitação

O menor contrato útil proposto é criação de evento em conversa individual ou grupo, sem edição, capa ou convite compartilhável. O nome `event` abaixo é uma proposta, não uma variante disponível. Recebimento e consulta de RSVP devem ser uma entrega explícita, caso façam parte da promessa de produto.

1. Implementar no backend uma rota específica, schema JSON:API, handler e serviço de criação. Preservar token por instância, normalização de destinatário e rejeição de campos desconhecidos. Não expor um endpoint arbitrário de protobuf como substituto do contrato.
2. Construir `EventMessage` com os instantes normalizados, contexto citado e segredo aleatório. Reusar serialização e criptografia do cliente WhatsApp. Garantir que resposta HTTP, webhook, histórico público e logs não devolvam o segredo, chaves de mídia ou envelopes internos.
3. Se houver suporte a RSVP, processar o envelope hoje ignorado, decifrar com o segredo retido e publicar evento normalizado. Persistir o estado no provedor com política definida, incluindo atualização por autor, deduplicação e indisponibilidade quando faltar o segredo. Não criar arquivo geral de mensagens ou segredos em D1.
4. Acrescentar `event` ao schema MCP e ao adaptador somente após a rota estar verificada. Manter `mcp:write`, posse da conexão, resumo de produto e idempotência com todos os campos semânticos. Conservar resultado desconhecido sem replay automático de escrita.
5. Atualizar `docs/SEND-MESSAGE.md`, `docs/TOOLS.md` e os documentos de arquitetura ou publicação afetados. Uma alteração de dependência exige revisão separada. O tipo de evento já existe na versão fixada; atualizar a biblioteca não é, por si só, a correção demonstrada.

Os critérios de aceitação propostos são observáveis:

| Verificação | Evidência exigida |
| --- | --- |
| Schema | Campo obrigatório ausente, data sem fuso, data inválida, término anterior e campos incompatíveis falham antes do dispatch. Datas equivalentes com offsets diferentes produzem o mesmo instante. |
| Construção conectada | HTTP real da fixture passa por JSON:API, handler e serviço. Captura mostra `EventMessage`, segredo de 32 bytes e ausência de `DocumentMessage`. `proto.Marshal` seguido de `proto.Unmarshal` preserva campos e contexto. |
| Destinatário | Exercitar conversa individual e grupo separadamente, com PN e LID quando disponíveis. O transporte usa o destinatário e autor esperados. Não publicar Status nem canal como efeito do evento. |
| Citação | Sem citação, com citação individual e com citação de participante de grupo. ID, autor e conversa devem corresponder à mensagem citada. Referências fora da conversa e da conexão devem falhar. |
| Horários | Conferir o mesmo instante UTC em fusos distintos, virada do dia e transição de horário de verão. Início e término em segundos; timestamp do RSVP em milissegundos. |
| Segredo e RSVP | Reabrir o armazenamento do provedor e decifrar RSVP de fixture com segredo retido. Segredo ausente, conversa errada e payload alterado produzem indisponibilidade ou rejeição sanitizada. Nenhuma chave aparece nas respostas. |
| Estado de participantes | Se anunciado, conferir `GOING`, `NOT_GOING`, `MAYBE`, mudança de resposta, convidado extra, duplicação e ordem de chegada. Definir a política para respostas antigas antes de calcular contagens. |
| Idempotência e isolamento | Repetir a chave devolve a ação existente. Alterar horário, destino, local ou citação causa conflito. Timeout após dispatch não dispara segundo envio. Outra conta não consulta evento ou RSVP dessa conexão. |
| Dispositivos | Com autorização própria para destinatário e conteúdo, registrar versão de Android, iOS e WhatsApp Web. Observar cartão nativo, abertura dos detalhes, horário local correto, presença na área de eventos e resposta pelo cliente. O remetente também deve manter a mensagem nos dispositivos vinculados. |

Esta investigação leu o código e as fontes primárias. Não fez envio real, deploy, alteração de configuração nem teste visual. O limite restante é a comprovação do caminho completo em backend implementado e clientes reais. Até lá, o WaPilot oferece o anexo `.ics` pelo contrato de documento, sem promessa de cartão ou RSVP nativos.
