---
status: accepted
---

# MCP Events da OpenAI e retenção de mensagens

Decisão discutida em 07/11/2026 e reconciliada com a implementação em 08/11/2026. O WaPilot adota o perfil MCP Events da OpenAI, com entrega por webhook e ciclo de assinaturas, preservando o transporte MCP HTTP stateless existente. A [pesquisa de 07/11/2026](../research/mcp-events-webhooks.md) registra as alternativas e propostas iniciais; este ADR registra a decisão consolidada.

Os contratos atuais estão em [ARCHITECTURE.md](../ARCHITECTURE.md#ciclo-de-assinaturas-mcp-events), [TOOLS.md](../TOOLS.md#assinaturas-mcp-events) e [DEPLOY.md](../DEPLOY.md#filas-e-retenção-de-mcp-events). Os registros de publicação nesses documentos são evidências datadas, não garantias permanentes do ambiente remoto.

## Decisões confirmadas

O WaPilot não mantém um histórico próprio de conversas. Assinaturas são persistidas durante sua vigência e a retenção temporária de conteúdo se limita ao necessário para entregar notificações correspondentes a assinaturas ativas e autorizadas; recebimentos sem assinatura interessada não justificam armazenar seu conteúdo.

O evento inicial é `message.received`, somente para mensagens novas recebidas, com filtros por conexão e, opcionalmente, conversa. Mensagens enviadas, sincronização de histórico e confirmações de leitura ficam fora desse evento. O contrato atual de filtros individuais, aliases e grupos está em [TOOLS.md](../TOOLS.md#assinaturas-mcp-events).

O código não lê nem grava o cache local de conteúdo enviado ou o arquivo geral de webhooks. Listagem, leitura integral e encaminhamento dependem da retenção do provedor, aceitando que mensagens ausentes nele fiquem indisponíveis; o envio continua devolvendo o identificador da mensagem. Essa escolha reduz a retenção local de conteúdo e elimina a manutenção de um segundo histórico.

As notificações contêm identificadores, autor, horário, tipo e prévia de até 2.000 pontos de código Unicode do texto. Mídia contém somente metadados, sem arquivos ou URLs privadas. A ferramenta `get_message` consulta o texto integral e os metadados ainda disponíveis no provedor, sem novo cache; conteúdo ausente tem resultado explícito de indisponibilidade, e mídia continua nas ferramentas específicas. O prazo da assinatura não representa garantia de retenção da mensagem.

Notificações pendentes podem ser entregues por até uma hora do recebimento. O conteúdo é apagado após aceite HTTP `2xx`, vencimento ou invalidação; identificadores para deduplicação e resultado operacional podem permanecer por até 24 horas desde o recebimento, sem texto. Filas transportam somente IDs. A retenção de controle das assinaturas e da revogação é distinta e está em [ARCHITECTURE.md](../ARCHITECTURE.md#ciclo-de-assinaturas-mcp-events).

Não há replay: somente mensagens novas recebidas durante a vigência de uma assinatura podem gerar notificações. Novas tentativas de uma entrega já pendente permanecem permitidas dentro do prazo operacional. A deduplicação por identificadores também se limita a 24 horas; uma retransmissão arbitrariamente tardia pode voltar a notificar uma assinatura continuamente ativa.

A decisão de transição inclui excluir os registros legados de `webhook_events` e `outbound_messages`, sem importar conteúdo para o novo modelo, preservando conexões, autorizações e auditoria operacional. A migration `0009_drop_legacy_message_storage.sql` está preparada e testada localmente; o [registro de publicação de 08/11/2026](../DEPLOY.md#publicação-controlada-de-mcp-events-em-8-de-novembro-de-2026-utc) informa que ela não foi autorizada nem aplicada remotamente. Publicar o código compatível e excluir os dados legados são etapas distintas; o [procedimento de transição](../DEPLOY.md#procedimento-da-transição-de-mensagens) rege uma eventual aplicação autorizada.

Assinaturas têm prazo padrão e máximo de sete dias por vigência, respeitando pedidos menores. A renovação pelo cliente pode prolongar o acompanhamento; sem renovação, a assinatura expira. Pedidos sem expiração também recebem prazo finito.

As instruções orientam o agente a encerrar o acompanhamento por pedido do usuário ou quando o objetivo de acompanhamento estiver cumprido. Uma mensagem recebida de terceiros não é, por si só, autorização para cancelar; o encerramento efetivo ocorre pelo cliente via `events/unsubscribe`.

Envios com chave explícita de idempotência guardam por 24 horas somente a chave da ação, escopo de usuário/conexão/operação, hash dos argumentos, estado e resultado mínimo, incluindo o ID da mensagem enviada. Repetições concluídas com a mesma chave devolvem o resultado anterior; argumentos diferentes com a mesma chave são rejeitados. Resultado de envio desconhecido não permite reenvio automático com a mesma chave. A proteção depende da chave e da janela de retenção, sem garantia de exatamente uma vez; consulte [TOOLS.md](../TOOLS.md#envios-com-chave-de-idempotência).

## Arquitetura de implementação

O Worker existente usa D1 para assinaturas, notificações temporárias, deduplicação e controle de idempotência. A persistência tem finalidade operacional específica, sem substituir o arquivo geral de webhooks ou o histórico local de envios.

Cloudflare Queues transporta somente identificadores de entregas, com consumidor e fila de falhas. O conteúdo limitado da notificação fica no D1 enquanto necessário, permitindo removê-lo após aceite ou prazo sem deixar cópia do texto na fila ou na fila de falhas. A criação de entregas é transacional e somente para assinaturas correspondentes; um Cron recupera publicações pendentes e leases vencidas e aplica a limpeza. Contadores e prazos persistentes impedem que a recuperação reinicie tentativas indefinidamente. Aceite externo seguido de falha local ainda pode repetir a notificação; `2xx` não comprova execução do agente.

Os métodos `events/list`, `events/subscribe` e `events/unsubscribe` permanecem no endpoint MCP autenticado por OAuth. O callback é verificado antes de ativar a assinatura; cada entrega revalida vigência e autorização. Cancelamento, revogação ou perda da conexão impedem novas tentativas, sem promessa de cancelar requisições já em voo. O Worker preserva MCP `2026-07-28`, resposta JSON e ausência de sessão de transporte; o stdio de desenvolvimento não anuncia eventos nem habilita bindings remotos.

### Sender HTTPS em Container

A avaliação de 07/11/2026 não demonstrou um caminho pronto nas APIs do Workers para fixar o endereço validado preservando a identidade TLS exigida pelos callbacks. Essa limitação motivou a revisão registrada na [pesquisa histórica](../research/mcp-events-webhooks.md#revisão-de-arquitetura-sender-https-explícito) e a escolha de um sender Node em Cloudflare Containers.

O sender recebe destino, corpo exato e cabeçalhos já assinados por uma interface interna autenticada; valida DNS e conecta ao endereço aprovado preservando hostname/SNI e certificado; bloqueia redes não públicas e redirects; devolve status e resposta limitada. Não tem banco, fila, histórico ou retries próprios. Assinaturas, criptografia, autorização, prazos, retenção e controle de tentativas continuam no Worker/D1.

Uma instância `lite` compartilhada é controlada por Durable Object no Worker existente. O controlador cuida de roteamento, inicialização e prontidão, sem estado de negócio ou sessões MCP. O Container para após um minuto sem uso e inicia novamente na próxima chamada; pendências permanecem no D1/Queue. Configuração, encerramento de chamadas ativas e limites de homologação estão em [ARCHITECTURE.md](../ARCHITECTURE.md#sender-de-callbacks) e [DEPLOY.md](../DEPLOY.md#container-do-sender).

### Organização dos módulos

O Worker concentra assinaturas, seleção de notificações, persistência, fila e recuperação em `src/lib/mcp-events.ts` e `src/lib/event-deliveries.ts`; as ferramentas reutilizam a autorização e o cliente de mensagens existentes. O sender Node tem pacote, imagem e testes próprios em `sender/`, sem importar regras de negócio ou código específico de Workers. O controlador do Container fica no runtime Workers.

## Verificação da implementação

As provas locais percorrem as entradas externas do Worker (MCP, webhook, fila e agendamento), com D1 local e serviços externos simulados, e o contrato HTTP do sender Node, incluindo DNS/TLS, bytes assinados e ciclo do Container. Cobrem isolamento, cancelamento/revogação, expiração, exclusão de conteúdo, chaves repetidas, resultados desconhecidos e falhas entre persistência, fila e confirmação HTTP. A descrição das suítes está em [DEVELOPMENT.md](../../DEVELOPMENT.md#entregas-mcp-events-locais).

Testes locais e dry-run não comprovam disponibilidade, configuração ou conformidade completa de produção. O [registro de publicação e homologação](../DEPLOY.md#publicação-controlada-de-mcp-events-em-8-de-novembro-de-2026-utc) distingue o ciclo sintético observado na Cloudflare/OpenAI das provas que continuam locais e das operações remotas não realizadas.

## Estado e cronologia

Em 07/11/2026, a primeira implementação local foi removida a pedido do usuário e o comportamento anterior foi restaurado, permanecendo pesquisa e decisão. Naquela etapa não houve deploy nem exclusão de dados de produção. Esse era o estado da proposta original, posteriormente superado.

Em 08/11/2026, a implementação foi retomada, integrada ao `main` e publicada, conforme [DEPLOY.md](../DEPLOY.md#publicação-controlada-de-mcp-events-em-8-de-novembro-de-2026-utc). A [issue #39](https://github.com/luccamordente/mcp-evolution-cloudflare/issues/39) registra a especificação de implementação; os contratos técnicos atuais estão nos documentos vinculados no início deste ADR. A remoção física das tabelas legadas continua separada da publicação, conforme o registro daquela sessão.

O [PR #49](https://github.com/luccamordente/mcp-evolution-cloudflare/pull/49), integrado por squash em `7537a6bf8cd5757bfff276f6c97cc91be4228da3`, corrigiu a correspondência entre telefone, JID e alias individual sem ampliar filtros de grupos. A [publicação da correção](../DEPLOY.md#correção-dos-filtros-de-monitoramento-em-8-de-novembro-de-2026-utc) registra 562 testes e dry-run, com publicação às 14:30 UTC de 08/11/2026. Na sessão posterior, o usuário confirmou o funcionamento em grupos e conversas individuais. São evidências históricas dessa sessão, sem nova validação de produção nesta reconciliação documental.
