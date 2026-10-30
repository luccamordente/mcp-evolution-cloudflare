# Pesquisa: bytes de PDF no ChatGPT e em respostas MCP

Data da pesquisa: 2026-10-30.

## Conclusão

**Sim, existe suporte documentado para enviar os bytes de um PDF, mas o contrato depende da superfície.** A OpenAI API aceita PDF em Base64 como `input_file`; GPT Actions também podem devolver PDFs em Base64. Isso não demonstra que um PDF devolvido por uma ferramenta MCP será incorporado pelo ChatGPT da mesma forma que um bloco `image`. Nas fontes oficiais consultadas, esse comportamento específico de MCP não ficou confirmado. [OpenAI: File inputs](https://developers.openai.com/api/docs/guides/file-inputs), [OpenAI: Sending and returning files with GPT Actions](https://developers.openai.com/api/docs/actions/sending-files), [OpenAI: Tool results](https://developers.openai.com/plugins/reference#tool-results).

| Superfície | O que foi confirmado | Consequência |
| --- | --- | --- |
| Arquivo anexado no ChatGPT | ChatGPT Work pode receber arquivos de origem e trabalhar com eles. | Suporte a anexos não define o contrato de saída de uma ferramenta MCP. |
| OpenAI Responses API | PDF em `input_file`, por Base64, `file_id` ou `file_url`. | Há contrato explícito para enviar o PDF original. |
| GPT Actions | Retorno `openaiFileResponse` aceita PDF em Base64 ou URL. | Há contrato específico para tornar o arquivo parte da conversa. |
| MCP | O protocolo admite imagens, links e recursos binários. | A admissão pelo protocolo não garante que o ChatGPT processe um recurso PDF como entrada de documento. |

Fontes da tabela: [ChatGPT: Work with files](https://learn.chatgpt.com/docs/artifacts-viewer), [OpenAI: File inputs](https://developers.openai.com/api/docs/guides/file-inputs), [OpenAI: GPT Actions](https://developers.openai.com/api/docs/actions/sending-files#returning-files), [MCP: Tool Result](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool-result), [MCP: Resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources#user-interaction-model).

## OpenAI API: bytes de PDF são uma entrada documentada

Na Responses API, o envelope para os bytes é este:

```json
{
  "type": "input_file",
  "filename": "documento.pdf",
  "file_data": "data:application/pdf;base64,<BASE64_DO_PDF>"
}
```

A API também aceita ID de arquivo previamente enviado e URL externa. Em modelos com visão, o processamento de PDF inclui texto extraído e imagens das páginas. Portanto, não se trata de pedir ao modelo que interprete a string Base64 como texto: a plataforma processa um campo de arquivo tipado. O limite documentado é de menos de 50 MB por arquivo, com 50 MB combinados por request; imagens e texto processados consomem contexto. Esses limites são da API, não uma promessa para MCP ou ChatGPT. [OpenAI: File inputs](https://developers.openai.com/api/docs/guides/file-inputs).

## GPT Actions: retorno inline também é documentado

Uma resposta de GPT Action pode incluir:

```json
{
  "openaiFileResponse": [
    {
      "name": "documento.pdf",
      "mime_type": "application/pdf",
      "content": "<BASE64_DO_PDF>"
    }
  ]
}
```

O guia permite até dez arquivos de até 10 MB cada, exclui imagem e vídeo desse mecanismo e diz que os arquivos passam a integrar a conversa como uploads, podendo ficar disponíveis para Code Interpreter e File Search. A alternativa por URL exige headers de nome/MIME e tem timeout de dez segundos por download. **Esse é o contrato de GPT Actions/OpenAPI; a documentação não o apresenta como formato de resultado MCP.** [OpenAI: Sending and returning files with GPT Actions](https://developers.openai.com/api/docs/actions/sending-files#returning-files).

## MCP: transportar o PDF não confirma leitura pelo ChatGPT

A especificação MCP consultada distingue `image` com `data` em Base64, `resource_link` com URI e `resource` embutido. Recursos podem carregar dados binários em `blob` Base64. Assim, um recurso binário com MIME `application/pdf` é compatível com o mecanismo genérico de recursos; não há um bloco de conteúdo dedicado `type: "pdf"` nessa especificação. O host determina como recursos entram no contexto. [MCP: Tool Result](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool-result), [MCP: Resource Contents](https://modelcontextprotocol.io/specification/2025-11-25/server/resources#resource-contents), [MCP: User Interaction Model](https://modelcontextprotocol.io/specification/2025-11-25/server/resources#user-interaction-model).

Na documentação de plugins, `content` e `structuredContent` chegam ao modelo; `_meta` fica restrito ao componente. Isso descreve visibilidade de campos, sem estabelecer que qualquer binário contido neles vira um documento processado. [OpenAI: Tool results](https://developers.openai.com/plugins/reference#tool-results).

As File APIs de ChatGPT documentam `uploadFile`, `selectFiles`, `getFileDownloadUrl` e `_meta["openai/fileParams"]`. Este último declara **entradas** de arquivos para ferramentas. A referência também menciona arquivos retornados por “tool file references”, mas a seção consultada não fornece um contrato de saída que confirme o processamento de PDF via `resource.blob`. Obter uma URL de download ou renderizar um arquivo no componente não comprova que o modelo recebeu seu conteúdo. A última distinção é uma inferência técnica a partir dos contratos documentados. [OpenAI: File APIs](https://developers.openai.com/plugins/reference#file-apis), [OpenAI: Define file inputs](https://developers.openai.com/plugins/reference#define-file-inputs).

**Resultado da pesquisa:** suporte a PDF binário em resultado MCP do ChatGPT permanece **não confirmado nas fontes consultadas**. Isso não prova impossibilidade nem incompatibilidade universal; faltam uma garantia oficial específica ou um teste no cliente alvo.

## Situação deste repositório

A inspeção de código realizada nesta tarefa encontrou:

- `get_message_image` devolve um bloco MCP `image` e mantém apenas metadados no resultado estruturado: [src/lib/mcp.ts](../src/lib/mcp.ts#L290).
- `getMessageImage` aceita JPEG, PNG e WebP, confere MIME/assinatura e tem limite padrão de 8 MiB; PDF é rejeitado pelo contrato atual: [src/lib/evolution.ts](../src/lib/evolution.ts#L585).
- A documentação descreve essa ferramenta visual, sem prometer leitura de PDF: [docs/TOOLS.md](../docs/TOOLS.md#L82).

Esses pontos descrevem o código lido em 2026-10-30, não uma limitação intrínseca do ChatGPT. Nenhuma implementação foi alterada nesta pesquisa.

## Encaminhamento mínimo para WaPilot

Se o objetivo é permitir perguntas sobre um PDF recebido em mensagem, a proposta mais previsível para o MCP é entregar texto extraído e, quando a aparência importar, imagens das páginas. Isso aproveita os tipos de conteúdo já usados, mas extração e renderização ainda precisariam de implementação e validação. Se o requisito é enviar o PDF original com suporte explicitamente documentado, a Responses API oferece `input_file`. Essas são propostas derivadas da comparação dos contratos acima, não funcionalidades implementadas ou testadas. [OpenAI: File inputs](https://developers.openai.com/api/docs/guides/file-inputs), [MCP: Tool Result](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool-result), [implementação atual](../src/lib/mcp.ts#L290).

Não houve teste de ponta a ponta no ChatGPT, chamada paga à API, alteração de ferramentas nem deploy. A versão MCP consultada para os tipos genéricos foi `2025-11-25`; ela não estabelece a compatibilidade de todas as versões ou clientes.

## Continuação: caminho com Cloudflare Workers AI

Consulta adicional em 2026-10-30. Para PDFs com texto, o caminho mínimo é **converter os bytes com `env.AI.toMarkdown` e devolver o texto no resultado MCP**. ChatGPT continua responsável por responder às perguntas; essa versão não precisa chamar um segundo modelo de conversa. A conversão de PDF e o retorno `ConversionResult` são documentados pela Cloudflare; a composição com o MCP é uma proposta para este repositório. [Cloudflare: Workers Binding](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/usage/binding/).

```ts
const converted = await env.AI.toMarkdown(
  {
    name: "documento.pdf",
    blob: new Blob([pdfBytes], { type: "application/pdf" }),
  },
  { conversionOptions: { pdf: { metadata: false } } },
);
// Validar converted.format e converted.data antes de montar o resultado MCP.
```

`format` pode ser `markdown`, `text` ou `error`; `data` contém o documento convertido e não existe no resultado de erro. `pdf.metadata: false` remove metadados do resultado. [Cloudflare: Workers Binding](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/usage/binding/#conversionresult-definition), [Cloudflare: Conversion Options](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/conversion-options/#pdf).

### Integração proposta

Uma ferramenta como `read_message_document(messageId, connectionId?)` resolveria a conexão autorizada do usuário, baixaria apenas o PDF retido e disponível na origem permitida, validaria MIME, assinatura e tamanho, chamaria a conversão e retornaria conteúdo textual com identificação da mensagem. Erros, resultado vazio, timeout e eventual truncamento precisam ser explícitos. É desenho proposto, não implementação concluída.

O projeto já tem binding `AI` em [wrangler.jsonc](../wrangler.jsonc#L16) e fluxo de download autorizado seguido de Workers AI em [src/lib/audio-transcription.ts](../src/lib/audio-transcription.ts#L16). A tipagem atual de `AI` expõe apenas `run`, portanto precisaria incluir `toMarkdown`: [src/types.ts](../src/types.ts#L4). A primeira versão pode seguir o mesmo escopo HTTP da transcrição, sem mudar o entrypoint stdio local.

### Limites de fidelidade e OCR

Para PDF, a Cloudflare percorre as páginas, usa `StructTree` quando disponível para construir Markdown semântico e, sem essa estrutura, retorna o texto da página como encontrado. A descrição não promete preservação integral do layout ou leitura visual de gráficos e imagens embutidas. A consequência prática é tratar conversão textual e compreensão visual como capacidades distintas. [Cloudflare: How it works — PDFs](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/#pdfs).

**OCR de PDF escaneado não ficou confirmado para `toMarkdown`.** As opções públicas de PDF expõem somente `metadata`; a opção de idioma `image.descriptionLanguage`, inclusive `pt`, controla descrições geradas de imagens e não configura OCR de PDF. Descrição de imagem é um fluxo com detecção de objetos e modelo de visão, não uma garantia de transcrição literal. [Cloudflare: Conversion Options](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/conversion-options/), [Cloudflare: How it works — Images](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/#images).

A Cloudflare documenta OCR em **AI Search**, ativado por `indexing_options.use_ocr`, com limite de 10 MiB para PDF com OCR e cobrança por ingestão de imagens. São contratos de outro produto; não devem ser aplicados automaticamente ao binding `toMarkdown`. Para leitura pontual de uma mensagem, adicionar indexação e busca ainda não se justifica. [Cloudflare: AI Search — Data source](https://developers.cloudflare.com/ai-search/configuration/data-source/#images-and-optical-character-recognition).

Se scans forem requisito, uma segunda etapa possível é rasterizar as páginas e enviá-las a um modelo de visão no Workers AI para OCR. A Cloudflare documenta visão no Gemma 4 e divulga OCR entre seus usos. Esse desenho ainda exige escolher e validar a rasterização e testar extração em português; não pressupõe entrada PDF nativa no modelo nem um renderizador de PDF embutido no Worker. [Cloudflare: Gemma 4](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/), [Cloudflare: anúncio do modelo](https://developers.cloudflare.com/changelog/post/2026-04-04-gemma-4-26b-a4b-workers-ai/).

### Custo e limites operacionais

`toMarkdown` é gratuito para a maioria das conversões; fluxos de imagem podem usar modelos de Workers AI e gerar custo além da franquia. Isso não implica custo total zero do Worker ou de futuras rotas OCR. [Cloudflare: Markdown Conversion — Pricing](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/#pricing).

Não encontrei limites específicos e explícitos de bytes, páginas ou duração de PDF para `toMarkdown` nas páginas consultadas. A implementação deve começar com limite próprio conservador de entrada/saída e timeout, calibrados com PDFs representativos antes da publicação. Nenhuma inferência, OCR ou medição de qualidade/latência foi executada nesta pesquisa.


## Escopo aprovado para implementação

Pedido do usuário nesta conversa: fazer rebase com `main`; implementar o fluxo sugerido com Workers AI, **sem OCR**, documentar esse gap e atualizar as instruções MCP para uso proativo da ferramenta. A implementação deve reutilizar autenticação, conexão autorizada, download de mídia e binding `AI` existentes, retornando texto pelo MCP HTTP e preservando o isolamento do stdio. Os pontos de teste confirmados pelo usuário são chamadas MCP `tools/call` e runtime Workers com HTTP/conversão simulados. O contrato implementado e os limites ficam em [TOOLS.md](../docs/TOOLS.md#leitura-de-pdfs).
