# Exibir comprovante de envio de texto com resultado confiável

## Parent

[Spec #34 — Comprovante de envio de texto](https://github.com/luccamordente/mcp-evolution-cloudflare/issues/34)

## What to build

Ao executar `send_text`, mostrar um comprovante após a tentativa, com destinatário, nome da conexão e uma bolha com o conteúdo enviado. O resultado distingue envio aceito, falha confirmada e resultado desconhecido, sem induzir reenvio ou sugerir entrega/leitura.

Esta é a primeira entrega demonstrável: mensagens sem marcação já têm o fluxo completo, e marcações permanecem literais até o ticket de formatação. Reutilizar MCP Apps, o padrão visual e a integração com o host existentes, sem criar infraestrutura ou abstrações antecipadas.

## Acceptance criteria

- [ ] A descoberta vincula `send_text` a um recurso MCP Apps válido; o recurso estático não contém dados de usuários. O cliente recebe o resultado da tentativa e o apresenta na bolha, sem ferramenta de escrita disparada pela montagem da UI.
- [ ] Cada chamada tem seu próprio comprovante, com texto exato, destinatário pelo número/identificador disponível e nome da conexão resolvida. Não buscar nomes ou reconstruir conteúdo a partir do histórico.
- [ ] O comprovante só aparece como resultado da tentativa, sem acrescentar confirmação anterior ao envio. Espaços, quebras e emojis são preservados, e HTML hostil permanece texto.
- [ ] A bolha cresce até mostrar o conteúdo integral, inclusive no limite atual de texto; temas claro/escuro, largura estreita, quebra de URLs e ajuste de altura do host funcionam. Não há truncamento, recolhimento ou rolagem interna vertical/horizontal.
- [ ] “Envio aceito” exige confirmação do aceite; falha confirmada exige evidência de que o envio não ocorreu. Sem evidência suficiente, mostrar “Não foi possível confirmar o envio”. Não inferir falha apenas de erro genérico, timeout ou interrupção.
- [ ] Um aceite já confirmado não é apagado por erro posterior de auditoria ou apresentação. Preservar auditoria e tratamento sanitizado de seus erros, sem credenciais ou conteúdo desnecessário.
- [ ] A UI é somente de leitura, sem editar, reenviar, retry automático, indicadores de entrega/leitura ou polling. Estados são distinguíveis por texto; abrir/restaurar/renderizar o resultado não repete a escrita.
- [ ] Interrupção recebida sem confirmação suficiente produz resultado desconhecido; documentar que o host pode impedir a montagem ou desmontar a UI antes de qualquer resultado.
- [ ] Preservar argumentos, validação, campos estruturados e fallback textual existentes, permissões HTTP/stdio, conexão explícita/padrão e isolamento entre usuários. Não adicionar migrações, armazenamento, mudanças de transporte ou acesso direto da UI ao serviço de mensagens.
- [ ] Testes na fronteira MCP com serviço/persistência simulados cobrem recurso e resultado, aceite, rejeição antes do envio, timeout, erro posterior ao aceite, isolamento e ausência de retry. Testes do componente cobrem dados visíveis, conteúdo hostil, restauração e layout; aproveitar as suítes existentes sem duplicá-las.
- [ ] Documentar o acionamento, estados, fallback e limites do host. Verificar renderização pelo caminho de integração do projeto, distinguindo simulação de demonstração no cliente e registrando limitações sem presumir compatibilidade.
- [ ] Verificação de tipos/testes e empacotamento dry-run passam, sem deploy nem envio real.

## Blocked by

Nenhum; pode começar imediatamente.
