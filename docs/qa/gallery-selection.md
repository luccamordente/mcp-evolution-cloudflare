# Validação da seleção na galeria — issue #10

Data: 19 de outubro de 2026. Integração local: `codex/issue-10-image-selection`.

## Contrato e limites

- SDK MCP Apps fixado: `@modelcontextprotocol/ext-apps` 2.0.3; servidor/cliente MCP 2.3.1; protocolo HTTP stateless `2026-07-28`.
- Recurso versionado: `ui://whatsapp/image-gallery-v3.html`.
- Leitura auxiliar: `get_gallery_image`, somente leitura/visibilidade `app`, com UUID de conexão, conversa e ID de mensagem obrigatórios; URLs arbitrárias são rejeitadas.
- Proveniência: busca autenticada das 50 imagens mais recentes da conversa e correspondência exata dos identificadores. A revalidação não aplica o filtro textual: uma imagem antiga encontrada por texto pode continuar com miniatura disponível e falhar na seleção por estar fora dessa janela. Atualizar a galeria é a recuperação disponível, sem lookup global de mensagem.
- Mídia selecionada: JPEG, PNG, GIF, WebP ou AVIF, até 5 MiB, leitura de storage em até 10 segundos, sem seguir redirects. MIME e assinatura precisam corresponder. A UI decodifica em memória e limita a 16.777.216 pixels; um formato pode ser recusado se o navegador não conseguir decodificá-lo.
- Apenas os bytes escolhidos e a projeção da mensagem entram no contexto corrente. URLs assinadas, envelopes brutos, credenciais e outras imagens permanecem fora dele.

## Evidência local

O baseline anterior à mudança passou com 134 testes, typecheck e verificação do bundle. Os ciclos red→green exercitam as fronteiras confirmadas pelo mantenedor: ferramenta MCP de leitura autorizada, ações da galeria/ponte `updateModelContext` e contrato de `reply_to_message`.

As capturas da ponte em testes devem conter PNG decodificável e metadados da mesma mensagem/conexão. Elas comprovam a forma do conteúdo enviado, não sua inclusão em um turno de um host real. A preparação de reply usa HTTP/D1 simulados; não envia mensagens reais.

O backend integrado passou em 91 testes de seleção, galeria e catálogo. A captura de reply individual/grupo usa os metadados retornados pela seleção após trocar o padrão no D1 simulado, e confere uma única escrita no destino e na instância originais, com o participante conhecido do grupo. Não houve escrita antes do pedido explícito simulado. Fixtures não sensíveis dos cinco formatos aceitos foram decodificadas com Pillow 12.1.1; a UI ainda precisa decodificar cada arquivo antes da entrega.

Um aviso após 15 segundos de espera pela confirmação do host não libera a fila de escritas: a promessa original continua pendente até se resolver. Rejeição da ponte, incluindo timeout do SDK ou perda de conexão, deixa o contexto incerto e bloqueia novas escritas nessa View. A UI identifica a última seleção confirmada e pede reabertura; não promete que um host com resposta perdida deixou de aplicar a imagem. Esse caso precisa ser conferido em cada integração real.

## Validação obrigatória por host

| Host | Caminho necessário | Resultado nesta entrega |
| --- | --- | --- |
| ChatGPT | Conector MCP com MCP Apps, recurso v3, capacidades de imagem/texto/contexto estruturado e próximo turno real | **Pendente.** A branch local não foi publicada nem carregada nesse host. Versão do cliente e capacidade negociada não foram verificadas. |
| Codex desktop | Integração MCP Apps que carregue o recurso v3 e encaminhe `updateModelContext` ao próximo turno | **Pendente.** O código local não foi instalado/publicado na integração real. A disponibilidade de ferramentas MCP nesta conversa não comprova o carregamento da View nem a transferência multimodal. |

Esses dois critérios permanecem abertos no issue #10. Mocks, navegador local e basic-host não substituem a evidência acima. Nenhum deploy, push ou envio WhatsApp real faz parte desta validação local.

## Roteiro para concluir os critérios dos hosts

1. Em ambiente autorizado com mídia de teste não sensível já retida, atualizar o catálogo e abrir uma nova galeria v3. Registrar nome/versão do cliente, caminho de integração e capacidades negociadas; não registrar credenciais ou URLs assinadas.
2. Usar uma imagem com formas e cores conhecidas e legenda que não as revele. Selecionar pelo teclado, confirmar foco/estado e capturar o pedido/ack da ponte: bloco `image` decodificável mais “O usuário selecionou a mensagem X”, UUID original e metadados da mesma mensagem. A seleção não deve iniciar resposta nem chamar ferramenta de envio.
3. No próximo turno, perguntar sobre uma característica visual ausente da legenda. Registrar a resposta e a imagem sintética usada, sem dados pessoais. Selecionar outra imagem e repetir; remover e verificar que o contexto corrente foi limpo, distinguindo-o do histórico já incorporado ao chat.
4. Testar seleção rápida A→B, resposta de mídia atrasada, atualização que preserve a mensagem, mudança de consulta/conexão, ausência da mensagem e falhas de mídia/host. Não confirmar transferência enquanto a ponte não confirmar. Fechar a ampliação deve preservar a seleção.
5. Separadamente, capturar a **preparação** da chamada de reply em um servidor de teste que intercepte envios: selecionar na conexão A, trocar o padrão para B e solicitar explicitamente uma resposta. Conferir `reply_to_message` com A, destino e ID originais. Repetir para grupo e participante disponível. Não executar envio real sem autorização específica.
6. Registrar rejeição ou ausência da modalidade imagem como limitação do host, mantendo o critério aberto. Em timeout, distinguir seleção confirmada de estado de contexto incerto; um ack atrasado não pode ser anunciado como uma seleção mais recente.
