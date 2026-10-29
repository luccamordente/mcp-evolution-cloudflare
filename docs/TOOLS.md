# Ferramentas MCP

Este documento explica a intenção de uso das ferramentas. O catálogo enviado ao modelo é definido em `src/lib/mcp.ts`; mantenha as duas fontes alinhadas.

As ferramentas que operam uma conexão aceitam `connectionId` opcional, o UUID interno cadastrado para o usuário. O caminho padrão é omitir o campo e deixar o Worker usar a conexão padrão. Chame `list_connections` somente para inspecionar ou escolher entre conexões, ou depois de um erro que indique conexão padrão ausente ou ambígua. Nunca use token, nome interno ou credencial como identificador.

| Ferramenta | Use quando | Não use para | Resultado e limites |
| --- | --- | --- | --- |
| `list_connections` | Descobrir conexões ou resolver uma escolha ambígua | Enviar mensagens ou consultar histórico | Registro de configuração; use `connection_status` para disponibilidade live. Credenciais e dados de pareamento são omitidos. |
| `connection_status` | Verificar a disponibilidade atual de uma conexão | Descobrir todas as conexões | Estado atual da conexão escolhida. |
| `search_contacts` | Encontrar uma pessoa ou número antes de uma mensagem | Pesquisar mensagens | Contatos paginados filtrados por nome ou telefone. |
| `list_groups` | Encontrar grupos e seus metadados básicos | Enviar uma mensagem sem confirmar o destino | Grupos paginados, com participantes básicos quando disponíveis. |
| `list_messages` | Pesquisar mensagens retidas na conexão ou em uma conversa específica | Exibir uma galeria de imagens (use `show_image_gallery`), assumir que todo o histórico está disponível ou obter uma lista completa de conversas | Até 25 mensagens por padrão (máximo 50), com filtros opcionais de conversa e texto; a cobertura depende da retenção no serviço. |
| `show_image_gallery` | Atender pedidos para ver, mostrar ou abrir fotos/imagens recebidas e enviadas, inclusive de uma conversa específica | Analisar conteúdo visual pelo resumo, recuperar arquivos não retidos, enviar anexos (use `send_media`), baixar mídia ou assumir histórico completo | Somente leitura; 12 mensagens de imagem por padrão, máximo 20; conversa e texto opcionais; links ficam somente no componente. |
| `send_text` | Enviar uma nova mensagem de texto | Responder citando uma mensagem existente | Resultado estruturado do envio; é uma ação externa e deve ter destino e texto finais. |
| `reply_to_message` | Responder citando uma mensagem conhecida | Enviar uma mensagem nova sem referência | Resultado estruturado; requer destino, texto e `messageId` da mensagem citada. |
| `send_media` | Enviar imagem, documento, áudio ou vídeo em base64 | Enviar apenas texto ou conteúdo ainda indisponível | Resultado estruturado; aceita legenda, nome de arquivo e referência opcional; respeita o limite de mídia configurado. |

## Ordem de decisão

1. Por padrão, omita `connectionId` e use a conexão padrão.
2. Se a conexão estiver ausente ou ambígua, chame `list_connections` e escolha um identificador válido.
3. Use `search_contacts` ou `list_groups` para resolver um destinatário desconhecido.
4. Use `list_messages` somente para a história capturada ou retida; um resultado vazio é inconclusivo.
5. Use `send_text` para uma nova mensagem, `reply_to_message` para uma citação e `send_media` para anexos.
6. Antes de uma ação de envio, confirme o destinatário e o conteúdo quando a autorização do usuário não for explícita.

## Consulta de mensagens

Em `list_messages`, `connectionId` seleciona a conta WhatsApp do usuário; omita-o para usar a conexão padrão. `conversationId` seleciona um contato ou grupo dentro dessa conta e aceita uma string com número de contato (por exemplo, `5511999999999`), JID individual (`5511999999999@s.whatsapp.net`) ou JID de grupo (`120363123456789@g.us`). O campo é opcional, remove espaços nas extremidades e exige entre 1 e 200 caracteres após essa remoção. String vazia, somente espaços, `null` e valores de outros tipos são rejeitados.

Combine `conversationId`, `text` e `limit` para pesquisar um assunto na conversa. Sem `text`, a consulta retorna as mensagens retidas mais recentes da conversa; sem `conversationId`, preserva a busca geral na conexão. Por exemplo:

```json
{ "conversationId": "120363123456789@g.us", "text": "reunião", "limit": 10 }
```

O cliente consulta diretamente `GET /message/search`, enviando a conversa como `chat`, o texto como `q` e o limite como `limit`. O Evolution Go aplica o filtro de conversa na consulta persistida, antes do limite; o Worker não filtra uma página geral posteriormente. A ordenação e o envelope de resposta permanecem os mesmos. A busca depende da retenção do Evolution Go, incluindo `DATABASE_SAVE_MESSAGES=true`, e não representa todo o histórico do WhatsApp: um resultado vazio é inconclusivo.

## Campos compartilhados

- `connectionId`: UUID interno opcional; não invente valores.
- `to`: destino individual ou grupo no formato aceito pelo serviço.
- `cursor`: cursor opaco retornado pela página anterior; omita na primeira página.
- `limit`: quantidade máxima de itens da página.
- `messageId`: identificador da mensagem a ser citada.
- `dataBase64`: conteúdo do anexo codificado em Base64, sem prefixo de URL de dados.
- `replyTo`: identificador opcional da mensagem que será citada junto com o anexo.

Todas as respostas bem-sucedidas usam `structuredContent.data` e podem conter objetos, listas, strings, números, booleanos ou `null`. Erros de execução usam `isError: true`, repetem um envelope sanitizado em `content[0].text` e em `structuredContent.data.error`, com os campos:

- `code`: classificação estável (`connection_not_found`, `no_default_connection`, `multiple_default_connections`, `wapilot_timeout`, `upstream_timeout`, `evolution_unreachable`, `evolution_http_error`, `media_too_large`, `invalid_base64`, `token_decryption_failed` ou `unexpected_error`);
- `status`: status HTTP sem payload upstream;
- `retryable`: indica se uma nova tentativa é plausível; operações de escrita não devem ser repetidas automaticamente;
- `operation`: nome da ferramenta que falhou;
- `message`: mensagem textual limitada e redigida;
- `hint`: próxima ação segura para o agente.

O envelope nunca inclui tokens, chaves, credenciais, payloads ou `details` do Evolution Go. Erros HTTP do upstream preservam somente o status e uma mensagem sanitizada.

As respostas MCP são normalizadas pelo Worker, mas a origem Evolution Go é JSON:API 1.1. `list_messages` lê a coleção diretamente de `data`; cada mensagem usa `id`, `attributes.at` em milissegundos, `attributes.encodingFormat`, `attributes.body`, `relationships.author` e `meta.chat`. Recibos são mensagens próprias com `body.state` e `relationships.target`. O cliente não depende de `data.items`, `raw`, `message_id`, `timestamp` ou de um `status` na mensagem.

Administração de conexões, logout, exclusão de mensagens ou grupos e gestão ampla de participantes não fazem parte desta superfície MCP.

### Origem dos timeouts

| Código | Evidência | Mensagem |
| --- | --- | --- |
| `wapilot_timeout` | O temporizador local do WaPilot cancelou a espera, inclusive durante a leitura do corpo da resposta. O status 504 é gerado localmente. | `WaPilot stopped waiting for the WhatsApp service after <prazo> ms (WaPilot timeout). The service outcome is unknown.` |
| `upstream_timeout` | A chamada recebeu HTTP 408 ou 504 do serviço externo. O status é preservado. | `The WhatsApp service returned a timeout response (HTTP <status>) to WaPilot.` |

Um timeout local não comprova que o Evolution Go sofreu timeout. Um timeout recebido comprova uma resposta externa de timeout, mas não identifica sua causa dentro do provedor ou de seu gateway. A classificação usa a origem registrada na fronteira HTTP, sem inferi-la pelo texto do erro. A galeria preserva esses códigos e mensagens sem repassar detalhes privados.

`retryable: true` permite considerar uma nova tentativa de leitura; não autoriza repetir envios automaticamente. A entrega pode ter ocorrido mesmo sem confirmação: confira o histórico antes de decidir reenviar, lembrando que a ausência de uma mensagem no histórico retido é inconclusiva.

O cliente/host MCP também pode atingir seu próprio prazo antes de receber a resposta. Esse erro é produzido pelo cliente e pode não chegar ao Worker; não deve ser atribuído ao provedor nem confundido com o temporizador local do WaPilot.

## Galeria de imagens MCP Apps

Use `show_image_gallery` quando o usuário pedir para ver, mostrar, explorar ou abrir fotos/imagens do WhatsApp. A ferramenta pode ser chamada diretamente, sem consultar `list_messages` antes. `list_messages` pesquisa mensagens; `send_media` envia anexos.

Os parâmetros são `connectionId` opcional, `conversationId` e `text` com os mesmos significados e limites de `list_messages`, e `limit` inteiro de 1 a 20 (padrão 12). O filtro `text` pesquisa texto das mensagens, não o conteúdo visual das imagens: buscar um assunto não equivale a reconhecer objetos nas fotos. Parâmetros desconhecidos, inclusive URLs fornecidas pelo cliente, são rejeitados. Por exemplo:

```json
{ "conversationId": "120363123456789@g.us", "limit": 12 }
```

A ferramenta consulta `GET /message/search` com `encodingFormat=image/*`, aplicando o filtro de imagem no provedor antes do limite. Imagens JPEG, PNG, GIF, WebP e AVIF com URL HTTPS de uma origem de storage aprovada podem ser exibidas. Outros formatos, arquivos sem URL e links fora da allowlist aparecem como indisponíveis, sem bloquear as demais imagens. Esse escopo não inclui SVG, HTML, QR codes, avatares, vídeos ou documentos; a ferramenta não envia, edita nem baixa arquivos para o dispositivo.

O recurso `ui://whatsapp/image-gallery-v2.html`, com MIME `text/html;profile=mcp-app`, é anunciado em `_meta.ui.resourceUri`. Miniaturas mantêm a proporção; os botões podem ser acionados pelo teclado e a ampliação usa diálogo com fechamento por Escape e retorno do foco. Legendas e contexto são exibidos como texto; o texto alternativo descreve a função da imagem na mensagem, sem inventar seu conteúdo visual.

A versão visual v2 usa os tokens de cor, botões arredondados e fontes DM Sans/Manrope do dashboard WaPilot, com adaptação clara/escura ao tema do host. Os bytes das fontes e suas licenças são incorporados ao HTML estático; `FontFace` registra os buffers em memória, sem URLs de fonte ou novas origens externas. A CSP mantém `font-src 'none'`, e uma falha opcional usa a fonte do host/sistema sem bloquear a galeria. O URI é versionado para evitar reutilização do template anterior pelo cache do cliente. Após publicar, atualize o catálogo e abra uma nova galeria para receber o template novo.

O botão **Atualizar** consulta novamente pelo host autorizado e mantém o UUID da conexão resolvida originalmente, mesmo se a conexão padrão mudar. Não há polling nem tentativas automáticas de recarregar imagens quebradas. Uma falha de carregamento pode significar URL expirada, arquivo ausente ou falha de storage; a UI não consegue distinguir essas causas apenas pelo evento do navegador. A atualização pode renovar URLs de arquivos ainda retidos, mas não recuperar arquivos ausentes.

`content` e `structuredContent.data` contêm somente contagens e a orientação de fallback. A galeria exibe imagens ao usuário, mas não fornece pixels ao modelo para análise visual. Um resultado vazio não prova ausência de imagens, e um arquivo indisponível não prova exclusão. URLs assinadas, legendas e dados destinados ao componente ficam em `_meta.gallery`; nenhuma credencial de serviço ou mensagem bruta é enviada à UI. `list_messages` mantém seu contrato anterior. Clientes sem MCP Apps recebem o resumo textual, sem acesso aos links privados desta ferramenta. A galeria requer um host compatível com MCP Apps; a presença do servidor no catálogo MCP não garante a renderização da UI.
