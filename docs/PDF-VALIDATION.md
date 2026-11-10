# Validação da leitura progressiva de PDF

Registro de 2026-11-06, somente fixtures sintéticas e execução local. Não houve publicação, acesso a mensagens privadas ou inferência remota. Transporte JSON pelo handler MCP real; provedor, storage e identidade autenticada são simulados. PDFium executa de fato no Node e no workerd. O teste de handler não substitui uma negociação OAuth com um host externo.

## Capacidades verificadas

| Cliente/runtime | Caminho observado | Resultado e limite da evidência |
| --- | --- | --- |
| Node 24.13.0/Vitest 5.0.4 + Poppler | `get_message_document` → recurso nativo → arquivo temporário → `pdftotext` | Bytes idênticos ao PDF; leu a informação conhecida da fixture. Sem validação de transferência para filesystem em outros hosts. Tempo não instrumentado nessa prova. |
| Cliente HTTP local `message-tests` 1.0.0 → visão do agente nesta sessão | Scan → `read_message_document_pages`, página física 1, leitura 1600 × 1066 | PNG de 154.070 bytes (205.428 em Base64), 130 ms no handler. O modelo respondeu corretamente sobre informação presente somente nos pixels, sem recebê-la no prompt/metadados. |
| Mesmo cliente e visão, documento sintético de detalhe | Página 1 leitura 1600 × 1066 → `detail` com recorte `{x:0.3,y:0.4,width:0.15,height:0.15}` | Leitura: 12.853 bytes, 179 ms. Detalhe: 2400 × 1600, 42.461 bytes, 162 ms. O modelo confirmou seis dígitos após exibição reduzida a 1920 × 1280. A primeira imagem permitiu leitura tentativa: esta amostra comprova melhora de certeza, não impossibilidade de leitura padrão. |
| Cliente HTTP local + Poppler + visão | Original → extração local insuficiente → inspeção → prévia → recorte da mesma mensagem/conexão | Original idêntico: 98.618 bytes/26 ms; `pdftotext`: 0 caracteres/38 ms; inspeção: 28 ms, página 1 sem texto; prévia 640 × 426: 3.123 bytes/70 ms; detalhe 2400 × 1600: 42.461 bytes/159 ms. O agente confirmou visualmente os seis dígitos. Temporário removido pelo harness. |
| Miniflare/workerd | Renderização/inspeção reais e recorte de bitmap 2400 × 2400 | Conferência de regiões coloridas, rotação, scans, texto/página mista, formulário salvo, página 24, rótulos e bookmarks. Teste de vetores finos detecta detalhe perdido ao ampliar uma prévia. |
| ChatGPT e outros hosts externos | Catálogo, original no ambiente do agente, imagens ao modelo e redução de imagens | **Pendente**. Um resultado de teste local ou imagem visível só ao usuário não comprova esse caminho. |

O complemento local percorreu somente a página 1 e sua região necessária; a inspeção identificou paisagem 1080 × 720 pontos e ausência de texto. Todos os passos preservaram a mensagem e a conexão resolvida. Isso demonstra execução controlada do fluxo, sem provar seleção autônoma de ferramentas pelo modelo.

Tempos medem chamadas locais específicas, sem promessa de latência em produção. Os scans de aceite foram criados por outro agente; o agente leitor recebeu apenas a pergunta e os pixels do resultado MCP. Arquivos locais intermediários não são endpoints nem dependências do produto. A prova com `view_image` é explicitamente um adaptador local para a visão desta sessão.

## Cobertura e continuidade

A fixture de 24 páginas permite pedir prévias `[3,2]` e continuar com `[24]`, preservando ordem/identidade e entregando somente os blocos solicitados. `document-limits.pdf` demonstra `[1,2,3]` com páginas 1/3 válidas e página 2 indisponível por dimensão: `complete:false`, cobertura e falha explícitas. Texto extenso continua na mesma página antes de avançar; sumário tem cursor independente. Isso verifica transporte e navegação, não a estratégia espontânea de um modelo em todos os pedidos.

Regressões locais de 2026-11-09 em `test/mcp-messages.test.ts` verificam falha total de renderização em `page: 2` e `pages: [2]`, com `isError: true`, relatório e identidade preservados e auditoria de falha. Também conferem que texto JSON e `structuredContent` têm o mesmo envelope nas quatro ferramentas de PDF, em sucesso e erros operacionais. As instruções anunciadas exigem busca por conversa quando o remetente é conhecido, continuação dos lotes e distinção entre entrega e exame visual; o teste do catálogo confirma a publicação dessas instruções, sem comprovar obediência por um host externo.

Busca dirigida: a evidência visual foi conferida na página física 1 dos documentos de aceite. Revisão integral: essas provas **não** examinaram todas as páginas da fixture extensa e não podem ser apresentadas como revisão integral. Transcrição exata: o recorte confirmou o número sintético conhecido; scans piores podem continuar ilegíveis e devem ser descritos assim. Não há garantia universal de acurácia ou de suporte a recursos interativos.

## Aceites ainda abertos

Antes de fechar #27/#33, repetir no host desejado um pedido completo com original e ferramentas próprias, outro sem leitura local usando inspeção/páginas/recorte e um complemento local parcial. Confirmar entrega de bytes/pixels ao modelo, cobertura declarada, fontes, limpeza temporária pelo cliente e legibilidade após redução do host. Testar a matriz visual restante de tabelas largas/continuadas, fórmulas, duas folhas por página e scans degradados em tarefas controladas. As instruções e fixtures são necessárias, mas não substituem essa avaliação de comportamento.

A revisão publicada, o plano/limite de bundle e o comportamento remoto não foram verificados. Se o aceite exigir publicação, esta continua dependente de autorização específica; o código e dry-run não autorizam deploy. O cancelamento nativo é cooperativo entre operações e o prazo é detectado também pelo relógio; uma chamada WASM síncrona em andamento não é interrompida. A limpeza no filesystem do agente depende do cliente, sem verificação pelo WaPilot.


## Publicação posterior autorizada

Em 2026-11-07 às 03:01 UTC foi publicada a revisão `f41463aa-c534-465d-98b8-4b6e96af7865`, com 100% do tráfego confirmado. Saúde e metadata responderam 200; MCP sem bearer retornou 401 com metadata OAuth; `connection_status` autenticado funcionou. Bindings foram preservados. O registro anterior descreve as provas locais feitas antes do deploy. A publicação resolve a dependência de disponibilidade do código, mas não comprova entrega do original/pixels nem comportamento de leitura de PDFs no host externo. Esse aceite permanece aberto para o teste em produção solicitado pelo usuário; nenhum PDF privado foi lido nesta verificação.
