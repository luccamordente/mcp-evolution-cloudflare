# Comprovante de envio

Registro histórico do desenho inicial, publicado na [issue #34](https://github.com/luccamordente/mcp-evolution-cloudflare/issues/34). A implementação foi concluída e sua apresentação foi simplificada posteriormente a pedido do usuário: somente a bolha, com horário e um check de aceite. As decisões abaixo preservam a entrevista inicial; o contrato atual está em [TOOLS.md](TOOLS.md#comprovante-de-envio-de-texto).

## Decisões confirmadas

- O comprovante aparece após a tentativa de envio, sem acrescentar uma etapa de confirmação anterior à operação.
- O primeiro incremento cobre mensagens de texto. Anexos ficam para incrementos posteriores.
- A apresentação usa uma bolha inspirada no WhatsApp, com identidade WaPilot, preservando texto, quebras de linha e emojis, sem prometer reprodução exata do aplicativo.
- O resultado da operação não equivale a entrega ou leitura pelo destinatário.
- Cada envio tem seu próprio comprovante. Pedidos com múltiplas mensagens produzem comprovantes independentes, sem agrupamento nem ferramenta de lote neste incremento.
- O primeiro incremento abrange `send_text` e `reply_to_message`. Respostas recebem o marcador “Em resposta a uma mensagem”, sem buscar ou exibir o conteúdo citado.
- O comprovante identifica o destinatário pelo número ou identificador disponível e a conta de origem pelo nome da conexão. Não haverá consulta adicional apenas para resolver nomes de contatos ou grupos.
- A UI é somente de leitura, sem editar, reenviar ou repetir automaticamente o envio.
- Os resultados distinguem “Envio aceito”, falha confirmada e resultado desconhecido. Sem confirmação suficiente, a mensagem é “Não foi possível confirmar o envio”. Não são exibidos indicadores de entrega ou leitura.
- O texto interpreta a formatação do WhatsApp. A alternativa de exibir todos os marcadores literalmente foi descartada.
- A bolha cresce para exibir todo o conteúdo, sem truncamento, recolhimento ou rolagem interna. A rolagem fica somente no documento, inclusive para mensagens e trechos de código longos.

O termo de domínio está definido em [GLOSSARY.md](../GLOSSARY.md#mensagens).

## Formatação

Cobrir os oito formatos documentados pelo [WhatsApp Help Center](https://faq.whatsapp.com/539178204879377/?cms_platform=web&locale=en_US):

| Formato | Marcação |
| --- | --- |
| Negrito | `*texto*` |
| Itálico | `_texto_` |
| Tachado | `~texto~` |
| Monoespaçado | Três crases antes e depois |
| Código inline | Uma crase antes e depois |
| Lista | `- ` ou `* ` no início da linha |
| Lista numerada | Número, ponto e espaço no início da linha, como `1. ` |
| Citação | `> ` no início da linha |

A apresentação interpreta a marcação sem alterar o texto enviado ou os argumentos da ferramenta. HTML fornecido na mensagem continua sendo texto, sem executar conteúdo nem carregar recursos. Não se trata de um renderizador Markdown genérico.

A referência pública não especifica toda a gramática de combinações, escapes ou marcações incompletas. A implementação deve preservar literalmente sequências não reconhecidas, proteger conteúdo de código da interpretação dos demais formatos e testar combinações suportadas, sem prometer equivalência exata com todos os clientes WhatsApp.

## Garantias da implementação futura

- Reutilizar o padrão MCP Apps da galeria, incluindo tema do host, layout responsivo e ajuste automático de altura. O componente não cria áreas internas de rolagem.
- Preservar o contrato estruturado existente e manter resultado textual útil para clientes sem suporte à UI ou quando sua renderização falhar.
- Exibir o conteúdo exato da tentativa, sem reconstruí-lo a partir de histórico. Abrir, renderizar novamente ou restaurar o comprovante não executa outro envio.
- Classificar o resultado pela evidência e pela fase da operação. Erro genérico ou timeout não comprova falha de envio. Se o aceite já foi confirmado, erro posterior de auditoria ou renderização não pode transformá-lo em falha de envio.
- Diferenciar os estados também por texto, sem depender apenas de cor. Não usar marcas que sugiram entrega ou leitura.
- Não acrescentar consultas de nomes, busca do trecho citado, acompanhamento de entrega/leitura ou armazenamento adicional apenas para montar o comprovante.

O host controla a montagem e a permanência do componente. Um timeout do próprio cliente pode impedir a chegada de qualquer resultado ou desmontar a UI; não se pode garantir a exibição de um estado desconhecido em toda interrupção. Quando o componente receber uma interrupção sem evidência do resultado, ele não deve declarar falha confirmada nem oferecer reenvio.

## Critérios de validação

- Testes MCP simulados para `send_text` e `reply_to_message`, cobrindo sucesso, rejeição antes do envio, resultado desconhecido e falha posterior ao aceite. Preservar permissões, isolamento da conexão, contrato anterior e ausência de retry de escrita.
- Testes do renderizador para os oito formatos, combinações suportadas, sequências não reconhecidas, código literal, quebras de linha, emojis e conteúdo HTML hostil.
- Verificação visual com dados simulados para destinatário, conexão, marcador de resposta, estados, tema claro/escuro, largura estreita e texto no limite atual, sem corte nem rolagem interna.
- Executar `npm run check` e `npx wrangler deploy --dry-run` na implementação. Não há autorização de publicação ou de envio real neste design.

## Incrementos posteriores

Anexos ficam fora do primeiro incremento. Imagens com preview e legenda, documentos identificados sem preview e representações simples das demais mídias são possibilidades para novas decisões, sem antecipar implementação, persistência ou URLs de mídia neste recorte.

## Fatos do fluxo atual

- Cada chamada de `send_text` ou `reply_to_message` envia uma mensagem a um destino; não existe envio em lote nessas ferramentas.
- O sucesso normalizado informa aceite e identificadores, sem confirmar entrega ou leitura.
- O texto enviado e o destino estão disponíveis na operação. O cadastro da conexão tem nome amigável e número opcional; nomes de contatos e grupos exigiriam resolução adicional.
- Uma resposta conhece o identificador da mensagem citada, mas não seu conteúdo. Exibir o trecho citado exigiria outra leitura.
- Timeout ou erro após o efeito remoto pode deixar o resultado desconhecido. Escritas não são repetidas automaticamente; ausência no histórico retido não comprova que não houve envio.
- A galeria existente já usa MCP Apps. Clientes sem suporte à UI precisam continuar recebendo um resultado textual útil.

Referências: [ferramentas e erros](TOOLS.md), `src/lib/mcp.ts`, `src/lib/evolution.ts`, `src/types.ts` e [MCP Apps](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html).
