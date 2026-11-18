# Verificação de produção: contrato MCP para agentes

Verificação pontual em 15 de novembro de 2026; os resultados não garantem o estado futuro do serviço.

## Publicação

- Branch: `release/mcp-api-descriptions`.
- Commit de código: `97d255473d6a24eec5f7c10cff16c85c3f21ad37`.
- Versão do Worker: `f5c7ee20-6c31-481b-b24a-fcbfdcda420c`.
- Deployment: `26749fe5-0391-4bf7-8b43-153dd29ea74c`.
- Read-back: versão publicada com 100% do tráfego.
- Runtime e bindings comparados antes/depois e preservados, incluindo autenticação e imagem do sender.
- Módulo publicado comparado por SHA-256 ao bundle validado; conteúdos idênticos. Orientações de `data.error.recovery` e descrições das variantes presentes.

A branch parte da versão que estava publicada. O `main` remoto já contém a migração de login para Clerk, enquanto a versão ativa e seus bindings ainda usam a autenticação anterior. Esta entrega não publica essa troca de login. A integração com o novo `main` precisa preservar também suas alterações de identidade e prazos totais de leitura.

## Dados e migrations

A listagem remota confirmou que a migration Clerk já constava do histórico antes desta entrega. Somente `0012_send_action_conflict.sql` foi aplicada nesta publicação. Read-back confirmou os triggers `send_message_blocks_conflicting_action_key` e `conflicting_action_blocks_send_message_key`. O bloqueio de envios duplicados e os registros existentes foram preservados.

## Validação

- `npm run check`: 838 testes passaram; 13 condicionais ignorados.
- Dry-run do Worker aprovado com a imagem existente, sem depender de build Docker local.
- Descoberta local HTTP/stdio: seis ferramentas, títulos, descrições e parâmetros; 16 variantes públicas de envio com descrições próprias.
- `/healthz`: 200, protocolo `2026-07-28`.
- `/.well-known/oauth-protected-resource/mcp`: 200.
- `POST /mcp` sem bearer: 401, com desafio OAuth e endereço de metadata esperado.
- Chamada autenticada com página zero: `invalid_options`, `validationIssues`, `recovery.action: correct_arguments` e `isError: true`.
- Chamada autenticada por ID sintético ausente: `message_not_found` e orientação para `search_messages`, com resultados equivalentes no JSON estruturado e no bloco textual.

As chamadas autenticadas usaram somente argumentos sintéticos de leitura. Não foram consultadas mensagens pessoais nem enviados anexos para testar a publicação. O plugin da sessão ainda apresentava metadata em cache do catálogo anterior; os textos do novo catálogo foram conferidos no bundle publicado e na descoberta local, sem afirmar uma nova descoberta autenticada remota por esse plugin.

## Mensagem ao grupo

O envio do resumo ao grupo WaPilot pelo Heitor ficou condicionado ao acesso autenticado correspondente. A conexão do plugin nesta sessão listava somente a conta de Lucca, em estado de QR. Não foi usado acesso administrativo para contornar o isolamento de usuário. A mensagem não foi enviada nesta verificação.

## Nota posterior de consolidação — 18 de novembro de 2026

Este registro descreve a janela original da branch de release. O resumo ao grupo foi aceito posteriormente pelo WaPilot do Heitor via Composio; isso não comprova entrega nem leitura. O contrato MCP foi incorporado ao `main` pela PR #71 e a PR #68 foi encerrada. A pendência de envio descrita acima era específica daquele instante e não permanece em aberto.
