# Ferramentas MCP

Todas as ferramentas exigem `connectionId`, o UUID interno cadastrado pelo usuário. Nenhuma aceita token Evolution ou nome de instância.

| Ferramenta | Fonte | Observação |
| --- | --- | --- |
| `list_connections` | D1 + `GET /instance/status` | Lista as conexões do usuário e consulta o estado atual de cada instância diretamente no Evolution Go; o resultado não é gravado no D1. |
| `connection_status` | `GET /instance/status` | Usa o token específico da conexão e nunca lê o estado operacional do D1. |
| `search_contacts` | `GET /user/contacts` | Filtra localmente e pagina a lista devolvida pelo Go. |
| `list_groups` | `GET /group/list` | Metadados e participantes básicos, com paginação local. |
| `list_messages` | `GET /message/search?q=&limit=` | Consulta mensagens persistidas pelo Evolution Go; depende de `DATABASE_SAVE_MESSAGES=true`. |
| `send_text` | `POST /send/text` | Destino individual ou grupo; resposta estruturada. |
| `reply_to_message` | `POST /send/text` com `quoted` | Usa `messageId` e participante opcional. |
| `send_media` | `POST /send/media` | Imagem, documento, áudio ou vídeo; limite configurável. |
| `download_media` | `POST /message/downloadmedia` | Requer o envelope completo `waE2E.Message` capturado no webhook; ID isolado não basta no Evolution Go. |

As respostas incluem `structuredContent.data` e preservam os campos que o backend fornecer: IDs, JID, conversa, remetente, direção, timestamp, tipo e metadados de mídia. Administração de instâncias, logout, exclusão de mensagens/grupos e gestão ampla de participantes não fazem parte da superfície padrão.
