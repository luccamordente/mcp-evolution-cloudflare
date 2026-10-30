# Transcrição de áudio sob demanda

Para que o cliente MCP compreenda mensagens de áudio quando a tarefa exigir seu conteúdo, o WaPilot obtém o arquivo da mensagem na conexão autorizada e usa Cloudflare Workers AI, com `@cf/openai/whisper-large-v3-turbo`, para devolver somente a transcrição no idioma original. O escopo inclui notas de voz e anexos de áudio recebidos ou enviados; o áudio não é retornado pelo MCP, e a primeira entrega atende somente ao MCP HTTP, preservando os bindings remotos desativados no stdio local.

Áudio e transcrição permanecem apenas durante a chamada, sem cache persistente no WaPilot, para reduzir a retenção de conteúdo. Essa escolha aceita novo custo e latência em chamadas repetidas; tradução, resumo, timestamps e identificação de falantes ficam fora do resultado desta ferramenta.

Cada chamada processa integralmente o áudio de uma mensagem, com limite de 8 MiB e erro explícito para arquivos maiores, mídia indisponível ou falha de transcrição. O resultado é síncrono, sem fila, truncamento ou repetição automática da inferência; essa ferramenta terá um prazo de espera maior para permitir a conclusão da transcrição.

O prazo total de 300 segundos se aplica somente a essa ferramenta e inclui busca da mensagem, download e inferência. As operações recebem o cancelamento da chamada; o cliente MCP deve permitir pelo menos 360 segundos de espera, pois o servidor não pode impor esse prazo ao host.

As instruções do MCP orientam o modelo cliente a usar a ferramenta quando precisar do conteúdo do áudio para cumprir o pedido, mesmo sem uma solicitação explícita de transcrição, preservando a conexão da mensagem consultada.
