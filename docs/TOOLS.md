# Ferramentas MCP

Este documento explica a intenção de uso das ferramentas. O catálogo enviado ao modelo é definido em `src/lib/mcp.ts`; mantenha as duas fontes alinhadas.

As ferramentas que operam uma conexão aceitam `connectionId` opcional, o UUID interno cadastrado para o usuário. O caminho padrão é omitir o campo e deixar o Worker usar a conexão padrão. Chame `list_connections` somente para inspecionar ou escolher entre conexões, ou depois de um erro que indique conexão padrão ausente ou ambígua. Nunca use token, nome interno ou credencial como identificador.

| Ferramenta | Use quando | Não use para | Resultado e limites |
| --- | --- | --- | --- |
| `list_connections` | Descobrir conexões ou resolver uma escolha ambígua | Enviar mensagens ou consultar histórico | Registro de configuração; use `connection_status` para disponibilidade live. Credenciais e dados de pareamento são omitidos. |
| `connection_status` | Verificar a disponibilidade atual de uma conexão | Descobrir todas as conexões | Estado atual da conexão escolhida. |
| `search_contacts` | Encontrar uma pessoa ou número antes de uma mensagem | Pesquisar mensagens | Contatos paginados filtrados por nome ou telefone. |
| `list_groups` | Encontrar grupos e seus metadados básicos | Enviar uma mensagem sem confirmar o destino | Grupos paginados, com participantes básicos quando disponíveis. |
| `list_messages` | Pesquisar mensagens capturadas ou retidas | Assumir que todo o histórico está disponível ou obter uma lista completa de conversas | Mensagens paginadas, com filtro textual opcional; a cobertura depende dos eventos retidos pelo serviço. |
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

## Campos compartilhados

- `connectionId`: UUID interno opcional; não invente valores.
- `to`: destino individual ou grupo no formato aceito pelo serviço.
- `cursor`: cursor opaco retornado pela página anterior; omita na primeira página.
- `limit`: quantidade máxima de itens da página.
- `messageId`: identificador da mensagem a ser citada.
- `dataBase64`: conteúdo do anexo codificado em Base64, sem prefixo de URL de dados.
- `replyTo`: identificador opcional da mensagem que será citada junto com o anexo.

Todas as respostas bem-sucedidas usam `structuredContent.data` e podem conter objetos, listas, strings, números, booleanos ou `null`. Erros de execução usam `isError: true`, repetem um envelope sanitizado em `content[0].text` e em `structuredContent.data.error`, com os campos:

- `code`: classificação estável (`connection_not_found`, `no_default_connection`, `multiple_default_connections`, `evolution_unreachable`, `evolution_http_error`, `media_too_large`, `invalid_base64`, `token_decryption_failed` ou `unexpected_error`);
- `status`: status HTTP sem payload upstream;
- `retryable`: indica se uma nova tentativa é plausível; operações de escrita não devem ser repetidas automaticamente;
- `operation`: nome da ferramenta que falhou;
- `message`: mensagem textual limitada e redigida;
- `hint`: próxima ação segura para o agente.

O envelope nunca inclui tokens, chaves, credenciais, payloads ou `details` do Evolution Go. Erros HTTP do upstream preservam somente o status e uma mensagem sanitizada.

As respostas MCP são normalizadas pelo Worker, mas a origem Evolution Go é JSON:API 1.1. `list_messages` lê a coleção diretamente de `data`; cada mensagem usa `id`, `attributes.at` em milissegundos, `attributes.encodingFormat`, `attributes.body`, `relationships.author` e `meta.chat`. Recibos são mensagens próprias com `body.state` e `relationships.target`. O cliente não depende de `data.items`, `raw`, `message_id`, `timestamp` ou de um `status` na mensagem.

Administração de conexões, logout, exclusão de mensagens ou grupos e gestão ampla de participantes não fazem parte desta superfície MCP.
