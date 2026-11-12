# Implementação de histórico nativo e eventos

A execução incorpora a leitura existente, corrige perdas locais e acrescenta criação de evento em `send_message`. Nenhum teste envia mensagem real ou usa migrations remotas.

## Alterações

- Cinco famílias de conteúdo nativo, diagnósticos e relações de respostas são preservados na leitura MCP.
- `list_message_responses` devolve uma página autenticada, com máximo de 100 e validação do tamanho solicitado, tipo, alvo e continuação.
- VCards textuais são preservados sem expor URLs ou bytes privados. Precisão, velocidade, direção e waveform passam pela normalização.
- `event` valida campos de criação, instantes com fuso, limites UTF-16, localização e citações. O fingerprint normaliza offsets equivalentes e JID PN. O adaptador usa `/send/event`, sem retry de POST.

## Evidências

O teste MCP de contato/metadados falhou antes da correção, mostrando os cartões e quatro metadados ausentes. Depois passaram os 254 testes focados de mensagens, rotas e histórico, com a parte conectada inicialmente pulada.

Duas criações válidas de evento falharam antes da variante com `No matching discriminator`. Os testes de evento cobrem schema, wire e MCP, incluindo offsets equivalentes com a mesma chave, conflito semântico, permissão de escrita e resultado desconhecido sem reenvio.

A aceitação conectada usa o handler MCP, HTTP/autenticação/repositório/encoder reais do Go e PostgreSQL isolado. Após a correção de cardinalidade passaram 17 testes, incluindo a travessia de 500 votos e 500 RSVP. O launcher versionado é `npm run test:acceptance:history`. Configure `MESSAGE_HISTORY_TEST_DSN` de teste local e opcionalmente `WAPILOT_HISTORY_BACKEND` e `WAPILOT_ACCEPTANCE_GO`. Sem DSN o launcher falha explicitamente; a suíte regular sem URL não substitui a prova conectada.

O reinício do Orca encerrou a primeira rodada geral e removeu logs temporários. A rodada final usa `TMPDIR` privado e executável fora do checkout conforme `DEVELOPMENT.md`. A rodada final de `npm run check` passou com 49 arquivos aprovados, um arquivo pulado, 759 testes aprovados e 13 pulados. Os testes pulados não são tratados como cobertura executada.

`npm run test:acceptance:send` passou com 60 testes, incluindo 14 casos nativos Go. A fixture usa a rota, decoder e serviço de evento reais, com somente o dispatch externo capturado. Um store SDK SQLite isolado é reaberto em outra conexão antes do dispatch para comprovar os 32 bytes duráveis. Há round-trip protobuf, campos/segundos/localização zero/citação, segredos distintos e falha de storage com zero disparos. O launcher aceita `WAPILOT_SEND_ACCEPTANCE_BACKEND` para um checkout explicitamente autorizado e conserva o padrão canônico.

Comandos conectados usados exigem `WAPILOT_ACCEPTANCE_GO` apontando para Go 1.26 e o checkout local autorizado. O servidor PostgreSQL foi extraído em cache do usuário e iniciado somente em loopback; não houve instalação de serviço do host ou mudanças de infraestrutura remota.

## Limites

O dry-run padrão exige Docker para construir o Container de callbacks. Não houve daemon Docker disponível nesta execução. Essa etapa não pode ser declarada aprovada apenas por typecheck.

Renderização Android/iOS/Web, entrega real, RSVP de saída, edição/cancelamento, recuperação de conteúdo antigo e totais completos continuam fora da prova local. Não houve deploy, push, mensagem real, alteração de provedor ou configuração remota.

## Revisão final

A revisão de padrões reproduziu a aceitação indevida de páginas maiores que o limite. O schema agora limita 100 registros e o cliente rejeita contagens maiores que o solicitado, com regressão executável. A revisão final corrigiu um lock no harness para não bloquear a inspeção quando a validação do segredo falhar; a aceitação de envio passou novamente após a correção. A revisão de especificação não encontrou outro bloqueio funcional. A inspeção de comentários não pediu remoções.

Os modelos alternativos previstos pelas skills não estavam disponíveis; as revisões usaram agentes com o modelo herdado. Os relatórios anteriores de produção são referências e não foram transformados em uma nova certificação remota.
