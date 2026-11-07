# Mostrar comprovante ao responder com citação

## Parent

[Spec #34 — Comprovante de envio de texto](https://github.com/luccamordente/mcp-evolution-cloudflare/issues/34)

## What to build

Ao usar `reply_to_message`, receber o mesmo comprovante de envio de texto, acrescido de “Em resposta a uma mensagem”. Mostrar o novo texto enviado, sem buscar ou inventar o conteúdo da mensagem citada.

Reutilizar a apresentação e as regras de resultado da primeira entrega. O comportamento deve funcionar com ou sem o ticket de formatação já integrado, mantendo uma única apresentação compartilhada.

## Acceptance criteria

- [ ] `reply_to_message` anuncia e entrega o recurso de comprovante existente. O cliente observa novo texto, destinatário, nome da conexão e marcador “Em resposta a uma mensagem”.
- [ ] O conteúdo citado não é consultado nem mostrado; não são inventados texto ou autoria da mensagem original. O marcador de resposta é distinto da citação de bloco eventualmente presente no novo texto.
- [ ] Os argumentos de resposta, referência citada, participante opcional, validação e semântica do envio são preservados. Não transformar a resposta em nova mensagem independente.
- [ ] Reutilizar estados, classificação por evidência/fase, fallback textual, layout integral e regras de segurança da primeira entrega; não duplicar renderer ou regras de envio. Cada chamada mantém seu comprovante, mesmo em pedidos misturando mensagens novas e respostas.
- [ ] Preservar autorização e resolução da conexão por usuário. A montagem/restauração do comprovante não escreve novamente e não há consultas extras para montar sua apresentação.
- [ ] A fronteira MCP simulada verifica a resposta enviada sem alterações, metadados corretos, conexão explícita/padrão, resultados aceito/recusado/desconhecido e ausência de repetição. A apresentação simulada verifica marcador, conteúdo e separação entre comprovantes.
- [ ] A documentação inclui as respostas com citação; verificação de tipos/testes e empacotamento dry-run passam, sem deploy nem envio real.

## Blocked by

Ticket 1 — Exibir comprovante de envio de texto com resultado confiável.
