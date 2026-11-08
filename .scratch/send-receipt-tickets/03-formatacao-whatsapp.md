# Renderizar a formatação do WhatsApp nos comprovantes

## Parent

[Spec #34 — Comprovante de envio de texto](https://github.com/luccamordente/mcp-evolution-cloudflare/issues/34)

## What to build

Ao enviar texto com marcação do WhatsApp, ver no comprovante a formatação correspondente, sem alterar a mensagem enviada. Cobrir os oito formatos documentados: negrito, itálico, tachado, monoespaçado, código inline, listas com marcadores, listas numeradas e citações de bloco.

A entrega percorre o fluxo de envio até a bolha visível, usando a apresentação compartilhada da primeira entrega. Não depende de a ferramenta de respostas já estar integrada; quando estiver, ela usa a mesma apresentação.

## Acceptance criteria

- [ ] O resultado de um envio com marcação é mostrado com os oito formatos do WhatsApp, seguindo a [referência oficial](https://faq.whatsapp.com/539178204879377/?cms_platform=web&locale=en_US), sem aplicar regras adicionais de Markdown genérico.
- [ ] A interpretação ocorre somente na apresentação: texto e argumentos enviados ao serviço permanecem intactos, assim como os limites, o contrato de resultado e o fallback textual.
- [ ] Preservar espaços, quebras e emojis. Trechos de código não interpretam as demais marcações, e sequências incompletas ou não reconhecidas permanecem visíveis literalmente, sem perda de conteúdo.
- [ ] Combinações suportadas têm comportamento documentado e testado. Não prometer gramática idêntica ao aplicativo em aninhamento, escapes ou sintaxes ambíguas não especificadas publicamente.
- [ ] HTML hostil permanece conteúdo textual; a formatação não executa código nem carrega recursos. Não introduzir dependências/frameworks desnecessários para renderizar os formatos.
- [ ] Listas, citações e código continuam legíveis nos temas claro/escuro e em telas estreitas. A bolha cresce com todo o conteúdo, inclusive no limite atual, quebrando linhas longas, sem corte, recolhimento ou rolagem interna.
- [ ] A mesma apresentação é reutilizável em novas mensagens e respostas, sem confundir citação de bloco com o marcador de resposta e sem duplicar regras de formatação.
- [ ] Testes do fluxo MCP até o resultado consumido pelo componente comprovam que a mensagem enviada não muda. Testes de apresentação verificam os oito formatos pelo resultado visível, combinações suportadas, código literal, marcações incompletas, conteúdo hostil e mensagens longas; não testar detalhes privados do parser.
- [ ] Validar visualmente mensagens formatadas com dados simulados pelo caminho de integração do projeto. Atualizar a documentação sobre formatos e limites; verificação de tipos/testes e empacotamento dry-run passam, sem deploy nem envio real.

## Blocked by

Ticket 1 — Exibir comprovante de envio de texto com resultado confiável.
