# Contrato de `send_message`

`send_message` é a única ferramenta MCP de envio. O catálogo HTTP e o catálogo stdio compartilham os schemas de `src/lib/send-message.ts`. O adaptador em `src/lib/evolution.ts` converte cada variante para a rota correspondente do provedor. Campos desconhecidos ou incompatíveis com a variante são rejeitados.

## Envelope

| Campo | Contrato |
| --- | --- |
| `connectionId` | UUID interno opcional. A ausência seleciona a conexão padrão do usuário. |
| `idempotencyKey` | Chave opaca opcional, de 1 a 200 caracteres após remover espaços nas extremidades. Não contém conteúdo da mensagem. |
| `message` | Objeto obrigatório, discriminado por `kind`. |

O HTTP exige OAuth com `mcp:write`. O stdio recebe permissões do processo local confiável. Ambos resolvem o usuário e a conexão antes de usar a credencial da instância. A chave administrativa não autentica envios.

## Variantes disponíveis

Os campos desta tabela são próprios da variante. Campos opcionais usam `?`. As opções de conversa aparecem na próxima seção.

| `message.kind` | Campos próprios | Destino |
| --- | --- | --- |
| `text` | `text`, `forwardingScore?` | `to` |
| `link` | `text` com pelo menos uma URL HTTPS aprovada | `to` |
| `image` | `mimeType`, `source`, `caption?` | `to` |
| `video` | `mimeType`, `source`, `fileName?`, `caption?`, `gifPlayback?` | `to` |
| `voice_note` | `mimeType`, `source` | `to` |
| `document` | `mimeType`, `source`, `fileName?`, `caption?` | `to` |
| `gif` | `mimeType`, `source`, `fileName?`, `caption?` | `to` |
| `poll` | `question`, `options`, `maxAnswers` com padrão `1` | `to` |
| `list` | `title`, `description`, `buttonText`, `footerText`, `sections` | `to` |
| `location` | `name`, `latitude`, `longitude`, `address` | `to` |
| `contact` | `fullName`, `organization?`, `phone` | `to` |
| `sticker` | `url` | `to` |
| `buttons` | `title`, `description`, `footer`, `buttons`, `header?` | `to` |
| `carousel` | `cards`, `footer?`, `delayMs?` | `to` |
| `forward` | `source: { conversationId, messageId }` | `to` |
| `status_text` | `text` | Status, sem `to` |
| `status_image` | `mimeType`, `source`, `caption?` | Status, sem `to` |
| `status_video` | `mimeType`, `source`, `caption?` | Status, sem `to` |

`voice_note` rejeita legenda e nome de arquivo, pois o formato nativo não preserva esses campos. `image` também não aceita nome de arquivo. Em `video`, `fileName` exige `gifPlayback: true` e identifica metadados de armazenamento, sem prometer nome visível no cliente. `voice_note` envia uma mensagem de voz com a marca nativa `PTT=true`. Não representa um anexo de áudio comum. `forward` resolve a mensagem retida na conversa de origem e recusa conteúdo ausente ou pertencente a outra conversa. O encaminhamento disponível conserva texto e mídia retidos, incluindo reprodução de GIF; não promete reconstruir todos os formatos interativos.

### Opções de conversa

`text`, `link`, `image`, `video`, `voice_note`, `document`, `gif`, `poll`, `list`, `location`, `contact`, `sticker` e `buttons` aceitam estas opções:

| Campo | Contrato |
| --- | --- |
| `to` | Número ou JID individual/de grupo, de 3 a 200 caracteres após remover espaços nas extremidades. |
| `replyTo` | `{ messageId, participant? }`. Usa o ID da mensagem citada na mesma conversa; `participant` identifica o autor quando necessário em grupos. |
| `delayMs` | Inteiro opcional entre `0` e `5000`, em milissegundos. |
| `formatJid` | Booleano opcional que preserva a opção de formatação do destinatário oferecida pelo provedor. |
| `mentions` | Somente destinos de grupo nas variantes que preservam menções. `{ kind: "all" }` ou `{ kind: "users", jids: [...] }`, com 1 a 100 JIDs. |

`list` e `buttons` não aceitam `mentions`, pois o backend não as aplica nesses formatos. `carousel` também não aceita esse campo.

`customMessageId` é opcional em `text`, `link`, `image`, `video`, `voice_note`, `document`, `gif`, `poll`, `location`, `contact`, `sticker` e nas três variantes de Status. Ele define o ID solicitado ao WhatsApp. Não substitui `idempotencyKey` nem garante deduplicação.

`carousel` aceita somente `to` e `delayMs` como opções de conversa. Não anuncia citação, menções, `formatJid` ou ID personalizado. `forward` aceita somente destino e origem. As variantes de Status não aceitam destinatário, citação, menções ou atraso.

### Mídia e URLs

A fonte de anexos é `{ kind: "base64", dataBase64: "..." }`, sem prefixo de URL de dados. O limite de bytes é `MAX_MEDIA_BYTES`, com padrão de 8 MiB. O Worker normaliza espaços e padding do Base64 e normaliza MIME antes do envio e do cálculo de idempotência. O registro operacional guarda o hash dos bytes, sem guardar o arquivo.

| Variante | MIME aceito |
| --- | --- |
| `image`, `status_image` | `image/jpeg`, `image/png`, `image/webp` |
| `video`, `status_video` | `video/mp4` |
| `voice_note` | `audio/*` |
| `document` | `application/*` |
| `gif` | `image/gif` ou `video/mp4` |

`gif` solicita reprodução em loop. Um GIF de entrada é convertido pelo backend para MP4 silencioso. `video` conserva vídeo comum, exceto quando `gifPlayback: true` solicita loop. Os limites de conversão estão em [TOOLS.md](TOOLS.md#envio-de-gifs).

`sticker.url`, URLs presentes em `link.text`, cabeçalhos de botões e imagens/vídeos dos cartões são downloads remotos executados pelo provedor. Eles exigem uma origem HTTPS exata em `SEND_MEDIA_ORIGINS`, separada das allowlists de leitura. A configuração vazia bloqueia esses downloads. URLs não aceitam credenciais ou fragmentos, e a origem da API é excluída da allowlist.

A verificação de origem no Worker não controla DNS, redirecionamentos ou rede do processo do provedor. O operador aprova somente origens confiáveis, inclusive seus redirecionamentos e assets referenciados nos metadados de prévia. Todas as URLs identificadas em `link.text` precisam ser HTTPS e aprovadas. URLs de prévia aceitam somente a sintaxe ASCII preservada pelo extrator do backend; outros caracteres exigem percent-encoding. Isso impede aprovar um host normalizado diferente daquele que o backend extrai do texto. O backend obtém título, descrição e imagem dos metadados da página. URLs de botões são destinos apresentados ao usuário, não fontes de download validadas por essa allowlist.

### Enquetes, listas e botões

Enquetes exigem de 2 a 12 opções distintas. `maxAnswers` é um inteiro positivo que não excede o número de opções. A ordem das opções faz parte da mensagem e da idempotência.

Cada seção de lista é `{ title?, rows }`. Cada linha é `{ title, description?, rowId }`. Há de 1 a 10 seções, com pelo menos uma linha em cada seção e no máximo 10 linhas no total. Todos os `rowId` são explícitos e distintos na mensagem.

Os botões têm estes formatos:

| `kind` | Campos |
| --- | --- |
| `reply` | `label`, `id` |
| `copy` | `label`, `code` |
| `url` | `label`, `url` HTTPS |
| `call` | `label`, `phoneNumber` |

Um conjunto contém de 1 a 10 botões. Se houver respostas rápidas, todos os botões são `reply` e o máximo é 3. Botões de ação não podem ser misturados com respostas rápidas. O cabeçalho opcional de `buttons` é `{ kind: "image" | "video", url }` e exige um conjunto somente de respostas rápidas.

Cada cartão do carrossel contém `header`, `body: { text }`, `footer?` e `buttons?`. O cabeçalho contém `title?`, `subtitle?` e exatamente um entre `imageUrl` e `videoUrl`. Há de 1 a 10 cartões. Os botões seguem os mesmos formatos e regras, inclusive a separação entre respostas rápidas e ações. O adaptador converte destinos explícitos dos botões para os campos específicos do provedor.

Textos de mensagem têm até 10.000 caracteres. Legendas têm até 2.000. Títulos, identificadores, nomes e rótulos têm até 200, conforme o schema de cada campo. A descrição de uma linha de lista tem até 1.000 caracteres. Esses limites são políticas do WaPilot, não garantias universais dos aplicativos WhatsApp.

## Exemplos

Uma resposta de texto cita uma mensagem conhecida:

```json
{
	"idempotencyKey": "example-text-1",
	"message": {
		"kind": "text",
		"to": "5511999999999",
		"text": "Confirmado!",
		"replyTo": { "messageId": "SOURCE_MESSAGE" }
	}
}
```

Uma enquete usa a mesma estrutura de citação:

```json
{
	"idempotencyKey": "example-poll-1",
	"message": {
		"kind": "poll",
		"to": "5511999999999",
		"question": "Qual horário?",
		"options": ["10h", "14h", "16h"],
		"maxAnswers": 1,
		"replyTo": { "messageId": "SOURCE_MESSAGE" }
	}
}
```

Um Status não recebe `to`:

```json
{
	"idempotencyKey": "example-status-1",
	"message": { "kind": "status_text", "text": "Aberto hoje até 18h." }
}
```

Os números e IDs destes exemplos são sintéticos. Um envio real depende de destinatário, conteúdo e autorização definidos para aquela ação.

## Resultado e migração

O resultado conserva `connectionId`, `accepted`, os identificadores retornados pelo serviço, `outcome`, `deliveryStatus` e `readStatus`. Aceite não comprova entrega nem leitura. Comprovantes mostram o texto ou um resumo da variante e não consultam o histórico para compor a apresentação.

A operação canônica de idempotência é `send_message`. A chave protege a ação por 24 horas no escopo do usuário e da conexão. O hash inclui variante, destino, referência citada, opções e conteúdo ordenado. Trocar a variante com a mesma chave produz conflito; não cria outra ação independente.

As antigas ferramentas `send_text`, `send_media`, `reply_to_message` e `forward_message` foram removidas do catálogo e dos handlers. `get_send_status` ainda aceita esses nomes como `operation` somente para consultar registros operacionais anteriores à migração. Esses registros continuam sujeitos à expiração original de 24 horas.

A migration `0010_unified_send_fence.sql` cria bloqueios atômicos entre os namespaces antigo e novo. Um registro legado ativo impede reservar a mesma chave por `send_message`; uma reserva nova impede um Worker antigo de reservar essa chave no namespace legado. O erro `send_legacy_action_exists` não autoriza reenvio, troca de chave ou cópia de conteúdo. A consulta usa a operação original, sem iniciar outra escrita. A [ordem de publicação](DEPLOY.md#publicação-da-ferramenta-unificada-de-envio) aplica essa migration antes do corte de catálogo e clientes.

## Inventário do provedor e suporte futuro

O inventário foi conferido em 11 de novembro de 2026 no checkout canônico `.scratch/evolution-go`. A árvore local coincide com `main` remoto no commit `0d361bd7abb6562aaf305a1e185559acea88daf0`. A tentativa de `git pull --ff-only` encontrou ausência de autenticação Git nesta sessão; a igualdade da árvore foi verificada pela API autenticada do GitHub. Isso não comprova a versão do backend em produção.

As fontes são `pkg/routes/routes.go`, `pkg/sendMessage/service/send_service.go`, `pkg/sendMessage/handler/send_handler.go` e `pkg/jsonapi/request.go` daquele checkout. O OpenAPI é referência secundária quando diverge do handler ou da construção nativa.

| Família do provedor | Rota | Parâmetros próprios do contrato Go |
| --- | --- | --- |
| Texto | `/send/text` | `text`, `forwardingScore?` |
| Link | `/send/link` | `text`, `title`, `url`, `description`, `imgUrl` |
| Mídia | `/send/media` | `type`, `url` ou multipart `file`, `caption`, `filename`, `gifPlayback`, `forwardingScore?` |
| Enquete | `/send/poll` | `question`, `options`, `maxAnswer` |
| Figurinha | `/send/sticker` | `sticker` como URL de imagem |
| Localização | `/send/location` | `name`, `latitude`, `longitude`, `address` |
| Contato | `/send/contact` | `vcard: { fullName, organization, phone }` |
| Botões | `/send/button` | `title`, `description`, `footer`, `buttons`, `imageUrl?`, `videoUrl?` |
| Lista | `/send/list` | `title`, `description`, `buttonText`, `footerText`, `sections` |
| Carrossel | `/send/carousel` | `body`, `footer`, `cards` |
| Status de texto | `/send/status/text` | `text`, `id` |
| Status de mídia | `/send/status/media` | `type` imagem/vídeo, `url` ou multipart `file`, `caption`, `id` |

Os envios de conversa declaram `number`, `delay`, `formatJid` e `quoted: { messageId, participant }`. Todos, exceto carrossel, declaram `mentionedJid` e `mentionAll`. Texto, link, mídia, enquete, figurinha, localização e contato declaram `id`; botões, lista e carrossel não declaram esse campo.

Botões Go declaram `type`, `displayText`, `id`, `copyCode`, `url`, `phoneNumber`, `currency`, `name`, `keyType` e `key`, conforme o tipo. Linhas de lista declaram `title`, `description` e `rowId`. Cartões declaram cabeçalho com `title`, `subtitle`, `imageUrl` e `videoUrl`, corpo com `text`, rodapé e botões. Botões de cartão usam `type`, `displayText`, `id` e `copyCode`; URL e telefone usam o campo sobrecarregado `id` no Go.

O suporte eventual de cada item abaixo requer uma implementação verificada antes de acrescentar a variante ao schema público:

| Item | Estado atual e dependência |
| --- | --- |
| Evento nativo | Não há rota de envio de evento no `main` conferido. Exige contrato, construção nativa, serialização e testes do backend. |
| Template de negócio | `/send/template` existe, mas o handler rejeita a operação. Exige outro canal ou implementação compatível. |
| Pix | Os campos existem no tipo de botão, mas o serviço rejeita esse envio porque há descarte silencioso no protocolo usado. |
| Anexo de áudio comum | A rota `audio` atual produz nota de voz. Exige suporte distinto para áudio sem PTT. |
| Nota de vídeo | Há construção `ptv` no caminho de URL, mas o caminho de bytes e a tradução por MIME não o preservam de forma completa. |
| Fonte URL para anexos comuns | O provedor possui esse caminho. O contrato público atual aceita bytes Base64; ampliar exige controle do download no processo que o executa. |
| Figurinha por bytes ou animada | O contrato atual de figurinha aceita URL e converte imagem. Exige contrato separado antes de prometer outros formatos. |
| Metadados manuais de prévia | O tipo Go declara `url`, `title`, `description` e `imgUrl`, mas o serviço extrai a URL do texto e substitui os metadados por conteúdo obtido da página. O WaPilot não anuncia esses campos como controles efetivos. |
| Corpo acima dos cartões | O tradutor JSON:API atual não preserva esse campo do carrossel. O WaPilot não anuncia um campo ignorado. |
| Citação e `formatJid` em carrossel | Há campos declarados, mas o fluxo não preserva toda a semântica no envio central. Não são anunciados nesta variante. |
| Coordenada zero | O handler atual trata latitude ou longitude zero como ausente. O schema recusa esse caso até a correção do backend. |
| Menções em listas e botões | O envio central não aplica menções nesses formatos. Campos rejeitados até a correção do backend. |
| Menções, citações e opções em Status | Não fazem parte dos structs atuais de Status. |
| Encaminhamento de todos os formatos nativos | O caminho atual reconstrói texto e mídia retidos. Outros formatos exigem retenção e reenvio nativos próprios. |
| Localização live | O envio disponível cria uma localização estática. Compartilhamento live requer contrato e construção nativa próprios. |
| Múltiplos contatos | O contrato atual envia um único vCard. Uma coleção de contatos requer suporte próprio do backend. |
| Comércio e outros formatos WhatsApp | Catálogos, produtos, pedidos e formatos de canais específicos exigem inventário e contratos próprios. O inventário acima não representa todos os tipos internos de `waE2E`. |
| Reações, edição, remoção, leitura e presença | Há rotas de gestão de mensagens no provedor. Não são variantes de criação de uma nova mensagem neste contrato. |

## Aceitação

`npm run test:acceptance:send` executa a aceitação conectada com o handler MCP, D1 local e uma fixture Go. A fixture usa middleware JSON:API, handlers e construção nativa reais. Um overlay temporário intercepta somente as fronteiras externas do cliente WhatsApp para capturar mensagens e uploads. O checkout do provedor permanece intacto; o launcher falha se os pontos de instrumentação não coincidirem com o fonte esperado. Não são usadas credenciais pessoais nem enviados dados ao WhatsApp.

Os testes do contrato também verificam descoberta de uma única ferramenta de envio, serialização das variantes, rejeição antes do despacho, autorização, posse da conexão, conflitos entre variantes, concorrência e bloqueio entre chaves antigas e novas. Os testes distinguem aceite confirmado de resultado desconhecido, sem replay automático. A execução e suas limitações ficam no relatório da mudança; este documento não afirma resultado de produção.

A aceitação em dispositivos é separada e depende de autorização para destinatário e conteúdo reais. Para cada variante homologada, a conferência registra Android, iOS e WhatsApp Web, versão do cliente e conexão usada. Verifica aparência nativa, conteúdo, autoria/citação, callback de linhas e botões, votação da enquete, reprodução de mídia e destinatário Status. Evento e RSVP entram nessa lista somente após existir suporte nativo. Uma resposta HTTP bem-sucedida não substitui a observação no dispositivo.
