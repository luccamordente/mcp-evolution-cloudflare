# Validação da seleção na galeria — issue #10

Data: 19 de outubro de 2026. Integração local: `codex/issue-10-image-selection`.

## Contrato e limites

- SDK MCP Apps fixado: `@modelcontextprotocol/ext-apps` 2.0.3; servidor/cliente MCP 2.3.1; protocolo HTTP stateless `2026-07-28`.
- Recurso versionado: `ui://whatsapp/image-gallery-v3.html`.
- Leitura auxiliar: `get_gallery_image`, somente leitura/visibilidade `app`, com UUID de conexão, conversa e ID de mensagem obrigatórios e filtro `text` original opcional de até 200 caracteres; URLs arbitrárias são rejeitadas.
- Proveniência: busca autenticada de até 50 imagens mais recentes da conversa, reaplicando o filtro textual original, e correspondência exata dos identificadores. Uma imagem antiga encontrada por texto continua selecionável mesmo fora da janela sem filtro. Se a mensagem deixou a janela atual dos resultados filtrados, atualizar a galeria é a recuperação disponível, sem lookup global de mensagem.
- Mídia selecionada: JPEG, PNG, GIF, WebP ou AVIF, até 5 MiB, leitura de storage em até 10 segundos, sem seguir redirects. MIME e assinatura precisam corresponder. A UI decodifica em memória e limita a 16.777.216 pixels; um formato pode ser recusado se o navegador não conseguir decodificá-lo.
- Apenas os bytes escolhidos e a projeção da mensagem entram no contexto corrente. URLs assinadas, envelopes brutos, credenciais e outras imagens permanecem fora dele.

## Evidência local

O baseline anterior à mudança passou com 134 testes, typecheck e verificação do bundle. Os ciclos red→green exercitam as fronteiras confirmadas pelo mantenedor: ferramenta MCP de leitura autorizada, ações da galeria/ponte `updateModelContext` e contrato de `reply_to_message`.

As capturas da ponte em testes devem conter PNG decodificável e metadados da mesma mensagem/conexão. Elas comprovam a forma do conteúdo enviado, não sua inclusão em um turno de um host real. A preparação de reply usa HTTP/D1 simulados; não envia mensagens reais.

O backend integrado passou em 91 testes de seleção, galeria e catálogo. A captura de reply individual/grupo usa os metadados retornados pela seleção após trocar o padrão no D1 simulado, e confere uma única escrita no destino e na instância originais, com o participante conhecido do grupo. Não houve escrita antes do pedido explícito simulado. Fixtures não sensíveis dos cinco formatos aceitos foram decodificadas com Pillow 12.1.1; a UI ainda precisa decodificar cada arquivo antes da entrega.

Um aviso após 15 segundos de espera pela confirmação do host não libera a fila de escritas: a promessa original continua pendente até se resolver. Rejeição da ponte, incluindo timeout do SDK ou perda de conexão, deixa o contexto incerto e bloqueia novas escritas nessa View. A UI identifica a última seleção confirmada e pede reabertura; não promete que um host com resposta perdida deixou de aplicar a imagem. Esse caso precisa ser conferido em cada integração real.

Os limites da UI são 15 segundos para a ferramenta auxiliar, com cancelamento local e descarte de respostas atrasadas; 5 segundos para decodificação, fechando também bitmaps que terminem depois do prazo; e 60 segundos para a requisição de contexto do SDK. O aviso visual dessa última operação aparece aos 15 segundos e preserva a serialização.

### Conferência no navegador

O adaptador de teste local usou o `mountGallery` compilado por esbuild, CSP com `connect-src 'none'` e somente a origem HTTPS sintética de storage em `img-src`. A ponte era simulada; a decodificação `createImageBitmap`, o canvas, o diálogo, o teclado e o layout eram reais em Chromium 155.0.0.0. Não houve chamadas a Evolution, Access ou WhatsApp reais.

A [imagem sintética](fixtures/gallery-selection-shapes.png), sem dados pessoais, tem 240 × 160 pixels e 781 bytes; sua legenda não revela as formas. A [captura resumida do contexto](fixtures/gallery-selection-context.json) registra uma chamada de leitura com o filtro original `formas`, uma atualização, a referência `test-shapes`, os metadados correspondentes e o SHA-256 dos bytes do bloco `image`: `ed3b9328cadc7da910faeb62b1dc7eb8f09e68660d8da548da6f036abdea69da`. A decodificação do próprio bloco capturado produziu um pixel vermelho `[220, 38, 38, 255]` no retângulo e um azul `[37, 99, 235, 255]` no círculo; os bytes não foram substituídos por legenda ou URL.

Seleção por mouse e por Tab/Enter confirmou `aria-pressed`. Abrir a ampliação e fechá-la por Escape preservou a seleção e devolveu o foco à miniatura, sem nova atualização de contexto. Remover por teclado gerou `{ content: [], structuredContent: {} }`, sem chamada de envio; selecionar novamente gerou apenas a leitura auxiliar. A [captura da seleção confirmada](fixtures/gallery-selection-confirmed.png) mostra o estado em uma janela de 420 × 900; o layout também foi conferido em 1280 pixels de largura.

O caso de filtro textual foi reproduzido antes da correção no mesmo navegador: a ferramenta auxiliar omitia `text`, a seleção falhava e havia zero atualizações de contexto. Após a correção, a captura acima confirmou o filtro original e os pixels. Essa evidência não comprova um próximo turno de ChatGPT ou Codex.

### Resultado final dos checks e da revisão

- `npm run check`: **210 testes em 16 arquivos**, tipos do Worker/UI e bundle sincronizado passaram.
- `npx wrangler deploy --dry-run`: passou com Wrangler 4.150.0; nenhuma publicação.
- **Standards:** nenhum achado acionável nas regras documentadas ou heurísticas de código.
- **Spec:** um P2 sobre perda do filtro textual na leitura auxiliar foi corrigido, coberto nos seams MCP/DOM e reconferido pelo revisor. Nenhum achado de implementação restante; critérios reais por host continuam abaixo.

## Validação obrigatória por host

| Host | Caminho necessário | Resultado nesta entrega |
| --- | --- | --- |
| ChatGPT | Conector MCP com MCP Apps, recurso v3, capacidades de imagem/texto/contexto estruturado e próximo turno real | **Pendente.** Código publicado para teste; carregamento do recurso, versão do cliente e capacidade negociada ainda não foram verificados nesse host. |
| Codex desktop | Integração MCP Apps que carregue o recurso v3 e encaminhe `updateModelContext` ao próximo turno | **Pendente.** Código publicado para teste. A disponibilidade de ferramentas MCP nesta conversa não comprova o carregamento da View nem a transferência multimodal. |

Esses dois critérios permanecem abertos no issue #10. Mocks, navegador local e basic-host não substituem a evidência acima. A validação local anterior à publicação não incluiu deploy, push ou envio WhatsApp real.

## Publicação autorizada para teste

O mantenedor autorizou o deploy em 19 de outubro de 2026. O código `0666241` foi publicado na revisão `3f69a8cb-b12e-4559-9124-fcbfb0aa2154`, confirmada em 100% do tráfego às 19:04 (America/Bahia). Saúde e descoberta OAuth responderam `200`; `/mcp` sem bearer respondeu `401` tanto em GET quanto em POST. A publicação não executou ferramentas autenticadas nem enviou mensagens reais. Os testes por host acima continuam pendentes; abra uma nova galeria v3 para iniciá-los.

## Roteiro para concluir os critérios dos hosts

1. Em ambiente autorizado com mídia de teste não sensível já retida, atualizar o catálogo e abrir uma nova galeria v3. Registrar nome/versão do cliente, caminho de integração e capacidades negociadas; não registrar credenciais ou URLs assinadas.
2. Usar uma imagem com formas e cores conhecidas e legenda que não as revele. Selecionar pelo teclado, confirmar foco/estado e capturar o pedido/ack da ponte: bloco `image` decodificável mais “O usuário selecionou a mensagem X”, UUID original e metadados da mesma mensagem. A seleção não deve iniciar resposta nem chamar ferramenta de envio.
3. No próximo turno, perguntar sobre uma característica visual ausente da legenda. Registrar a resposta e a imagem sintética usada, sem dados pessoais. Selecionar outra imagem e repetir; remover e verificar que o contexto corrente foi limpo, distinguindo-o do histórico já incorporado ao chat.
4. Testar seleção rápida A→B, resposta de mídia atrasada, atualização que preserve a mensagem, mudança de consulta/conexão, ausência da mensagem e falhas de mídia/host. Não confirmar transferência enquanto a ponte não confirmar. Fechar a ampliação deve preservar a seleção.
5. Separadamente, capturar a **preparação** da chamada de reply em um servidor de teste que intercepte envios: selecionar na conexão A, trocar o padrão para B e solicitar explicitamente uma resposta. Conferir `reply_to_message` com A, destino e ID originais. Repetir para grupo e participante disponível. Não executar envio real sem autorização específica.
6. Registrar rejeição ou ausência da modalidade imagem como limitação do host, mantendo o critério aberto. Em timeout, distinguir seleção confirmada de estado de contexto incerto; um ack atrasado não pode ser anunciado como uma seleção mais recente.
