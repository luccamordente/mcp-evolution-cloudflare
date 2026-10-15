# Pesquisa: D1 separado por número de WhatsApp

Data da pesquisa: 2026-10-15.

## Conclusão executiva

O Cloudflare D1 suporta explicitamente escala horizontal com bancos menores por usuário, tenant ou entidade. Portanto, um banco por conexão/número de WhatsApp **faz sentido como opção de isolamento**, especialmente quando cada conexão precisa de retenção, exportação, restauração ou exclusão independente. Ele não é, porém, uma mudança apenas de schema: o Worker atual tem um único binding `DB` declarado no `wrangler.jsonc`, enquanto o número de bancos e seus UUIDs seriam descobertos em runtime.

Para o estágio atual (poucos usuários e poucas conexões), a recomendação é manter o D1 atual como plano de controle e dados, adicionando isolamento lógico por `connection_id` nas tabelas de contatos, conversas e mensagens. Isso reduz o risco operacional e preserva consultas e transações simples. Um desenho híbrido — D1 central para usuários/conexões/auditoria e um D1 de dados por conexão — é tecnicamente válido, mas deve ser adotado somente se o requisito de isolamento justificar a operação adicional.

Há uma decisão de identidade importante: o banco deve ser associado a uma `connection_id`/instância Evolution estável, com `phone_number` como metadado. O número pode ser trocado ou reutilizado; usar o número como chave física ou nome do banco criaria colisões e exporia PII.

## O que a plataforma permite

* A página oficial de limites diz que D1 é desenhado para “multiple, smaller (10 GB) databases”, incluindo bancos por usuário, tenant ou entidade. No plano pago há limite padrão de 50.000 bancos por conta, 10 GB por banco e 1 TB de armazenamento por conta; no plano Free são 10 bancos, 500 MB por banco e 5 GB por conta. O limite de 10 GB por banco não pode ser aumentado. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
* Cada banco é single-threaded e processa uma consulta por vez. Dividir por número pode isolar picos e reduzir contenção entre números, mas não melhora consultas de um único número além do limite daquele banco. A própria página recomenda reduzir round-trips e usar `batch()`; o limite de queries por invocação do Worker é separado do limite do banco. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
* A cobrança não é por quantidade de bancos nem por horas de banco: é por linhas lidas, linhas escritas e armazenamento acima da franquia. Um banco vazio ocupa aproximadamente 12 KB. No plano pago, a página de preços informa 25 bilhões de linhas lidas/mês e 50 milhões escritas/mês incluídas, além de 5 GB de armazenamento incluído; confirmar os valores do plano antes de uma decisão comercial. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
* O Worker Binding API expõe um D1 como `env.DB`, onde `DB` é o binding declarado no Wrangler. A documentação mostra que o binding contém `database_name` e `database_id` e que o código acessa o recurso pelo nome do binding. Isso é uma configuração do Worker, não um lookup de banco por UUID fornecido a `prepare()`. [D1 Database binding](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 getting started](https://developers.cloudflare.com/d1/get-started/)
* É possível declarar vários bindings e bindings diferentes por ambiente no Wrangler. Isso funciona para um conjunto pequeno e conhecido de números, mas cada novo banco exigiria alteração de configuração e novo deploy (inferência a partir do modelo de bindings documentado). [D1 environments](https://developers.cloudflare.com/d1/configuration/environments/)
* A API REST permite criar, consultar e excluir bancos e executar SQL pelo `database_id`, com um token da Cloudflare que tenha permissão D1 Read/Write. A própria documentação de Workers diz que bindings têm melhor desempenho e menos restrições que as APIs REST; o tutorial de proxy D1 recomenda a REST API embutida principalmente para uso administrativo, pois a rate limit global da Cloudflare se aplica. Usar essa API no caminho de cada webhook/tool exigiria guardar um token de conta no Worker, adicionar uma chamada HTTP e aceitar esse limite. [D1 REST API — create](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/), [D1 REST API — query](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/), [Workers bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/), [D1 proxy tutorial](https://developers.cloudflare.com/d1/tutorials/build-an-api-to-access-d1/)
* `batch()` é transacional apenas dentro de uma instância/binding D1: as instruções executam sequencialmente e uma falha reverte a sequência inteira. Não há uma transação documentada que englobe o D1 central e o D1 de um número. [D1 Database — `batch()`](https://developers.cloudflare.com/d1/worker-api/d1-database/)
* Cada banco tem seu próprio histórico de migrações em `d1_migrations`; `wrangler d1 migrations apply` aplica as migrações ao banco escolhido por nome ou binding. Com N bancos, cada banco precisa ser criado, migrado e verificado, e uma migração futura precisa alcançar todos os bancos. [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
* Time Travel é por banco: no plano pago permite restaurar qualquer minuto dos últimos 30 dias (7 dias no Free), sem custo adicional de histórico/restauração. Isso ajuda a restaurar um número isoladamente, mas multiplica a rotina de inventário e verificação dos bancos. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

Esses documentos confirmam a capacidade da plataforma; não confirmam que o Worker possa transformar arbitrariamente um UUID em um `D1Database` nativo em cada request. Para o código atual, a alternativa documentada para seleção dinâmica é a API REST ou um conjunto pré-declarado de bindings.

## Comparação das três arquiteturas

| Opção | Vantagens | Custos e riscos | Adequação agora |
| --- | --- | --- | --- |
| **Um D1 compartilhado com isolamento lógico** | Mantém `env.DB`; uma migração; joins, busca entre números e transações simples; não exige token de conta no Worker; adapta diretamente `webhook_events` existente. | Um banco single-threaded e limitado a 10 GB; bug de autorização pode vazar linhas de outro número; um número muito ativo compartilha fila e limite. Exige `connection_id` em todas as tabelas, chaves únicas compostas e índices. | **Recomendado para poucos números.** |
| **Um D1 por número/conexão, com bindings estáticos** | Isolamento físico forte; queries e Time Travel separados; hotspots não bloqueiam outros bancos; acesso usa bindings sem segredo de conta. | Número de bancos conhecido no deploy; cada novo número altera Wrangler e publica Worker; migrações e observabilidade multiplicam-se; consultas entre números exigem fan-out. | Válido para 2–5 conexões estáveis ou requisito de isolamento forte. |
| **Um D1 por número/conexão, selecionado dinamicamente via REST** | Criação e seleção podem ser dirigidas pelo registro de conexões em D1, sem redeploy para cada número. | Token Cloudflare D1 Read/Write no Worker; chamada HTTP e latência em cada operação; rate limit global da API; binding tipado e transações nativas são perdidos; maior superfície de segurança e operação. | **Evitar como caminho normal de mensagens/webhooks.** Usar para provisionamento administrativo/migrações ou atrás de um serviço dedicado, se houver requisito forte. |

Cloudflare reconhece tanto “database per tenant” quanto isolamento por linha como soluções válidas para SaaS; a escolha depende do nível de isolamento e do custo operacional. [Store and isolate customer data](https://developers.cloudflare.com/use-cases/saas/data-isolation/)

## Mudanças necessárias para um banco por conexão

### Plano de controle no D1 atual

Manter `mcp-evolution` para identidade e roteamento e acrescentar a `whatsapp_connections`:

* `data_database_id`, `data_database_name` e estado (`pending`, `provisioning`, `ready`, `error`, `retired`);
* versão de schema, timestamps de provisionamento e último health check;
* eventualmente jurisdição/região escolhida, se uma exigência de residência de dados existir;
* nenhum token de conta Cloudflare ou token Evolution em respostas ou logs.

O `connection_id` continua sendo o identificador autorizado pelo usuário. O Worker resolve `(user_id, connection_id)` no plano de controle antes de obter qualquer `database_id`; conhecer um UUID não concede acesso.

### Provisionamento e migrações

1. Um provisionador administrativo (CI/Wrangler ou serviço controlado com token D1 de menor privilégio) cria o banco com nome opaco derivado de um UUID, nunca com o número em claro.
2. O provisionador aplica um schema idempotente contendo `contacts`, `conversations`, `messages`, `webhook_events`/deduplicação e, se necessário, `media_envelopes`. Cada banco registra suas migrações em `d1_migrations`.
3. O provisionador só marca a conexão como `ready` após aplicar migrações e executar leituras de verificação. Provisionamento é uma máquina de estados; não deve acontecer no meio de uma chamada MCP nem depender de uma resposta HTTP isolada.
4. Migrações futuras precisam enumerar todos os bancos registrados, aplicar a mesma versão, registrar falhas e permitir retry. Criação, migração, exportação, Time Travel, retenção e exclusão passam a ser operações por conexão.
5. Para conexões existentes, copiar `webhook_events` do D1 atual para o banco de dados correspondente, comparar contagem e hashes/IDs, então trocar leitura e escrita. Só remover os dados centrais depois de um período de leitura de retorno e auditoria.

### Roteamento de mensagens

O webhook continua usando seu segredo opaco para localizar a conexão no D1 central. Depois da validação de `instanceId` e do usuário, grava o evento no banco de dados daquela conexão, com deduplicação local por `(event_name, message_id)` e índices por conversa/data. A inserção de uma mensagem e sua chave de idempotência deve ficar no mesmo banco para ser atômica.

As ferramentas MCP continuam recebendo apenas `connectionId`; não devem aceitar `database_id`, número ou nome de instância. `list_connections` consulta o plano central; `list_conversations`, `list_messages` e `recent_messages` consultam o banco da conexão resolvida. Falha, atraso de migração ou banco `retired` deve produzir estado explícito e auditável, sem cair silenciosamente em outro número.

### Contatos

O contrato atual do projeto obtém contatos por `GET /user/contacts` e filtra a lista devolvida pelo Evolution Go; o webhook materializa eventos de mensagens. Portanto, persistir contatos não acontece automaticamente ao separar os bancos: é preciso adicionar uma sincronização on-demand e/ou agendada que faça snapshot/upsert no banco da conexão, registre `fetched_at`/origem e trate remoções ou contatos não vistos. O Worker deve informar a data da última sincronização e poder renovar o snapshot quando a leitura estiver obsoleta.

### UI, autorização e documentação

* A UI continua listando conexões pelo D1 central e mostra o estado de provisionamento do banco de dados, sem expor UUID, tokens ou segredos.
* `/connections/provision` e a automação administrativa precisam coordenar criação do D1, migração, webhook e read-back; falhas parciais ficam em `provisioning/error`, com retry seguro.
* Atualizar `docs/ARCHITECTURE.md`, `docs/TOOLS.md` e `docs/DEPLOY.md` para explicar plano de controle, plano de dados, ciclo de vida, REST versus bindings e ausência de transação entre bancos.
* Testar isolamento com dois `connection_id`s, webhook duplicado, banco indisponível, migração parcial, exclusão de uma conexão e tentativa de consultar o `database_id` de outra conexão.

## Desenho recomendado

1. **Agora:** migrar as tabelas de mensagens/eventos para um modelo lógico compartilhado: `contacts(connection_id, jid, ...)`, `conversations(connection_id, jid, ...)`, `messages(connection_id, message_id, ...)`, índices compostos por conexão/conversa/data e deduplicação composta. O plano central continua com `users`, `whatsapp_connections`, auditoria e metadados. Isso já elimina mistura lógica e permite testar o domínio.
2. **Preparar a seam:** encapsular acesso em uma interface `ConnectionDataStore`/factory que receba a conexão autorizada. A implementação inicial usa o binding `DB`; a futura implementação pode resolver um binding estático ou um cliente de banco dedicado sem mudar as tools.
3. **Só adotar D1 por conexão quando houver gatilho verificável:** necessidade de restauração/exclusão independente, requisito contratual de isolamento físico, um banco se aproximando de 10 GB, contenção observada entre números ou necessidade de jurisdição distinta. Medir rows read/written, duração, tamanho e erros antes de promover a divisão.
4. **Se a divisão for aprovada:** preferir provisionador fora do caminho quente e bindings estáticos para um conjunto pequeno. Para escala dinâmica, avaliar um Worker/serviço de dados dedicado com controles de permissão e rate limit; não colocar um token de conta D1 amplo no handler MCP sem uma revisão de segurança.

Esta recomendação é uma análise de arquitetura, não uma confirmação de que bancos novos foram criados, migrados ou ligados ao Worker publicado.

## Fontes primárias consultadas

* [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
* [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
* [D1 Database / Worker Binding API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
* [D1 getting started and bindings](https://developers.cloudflare.com/d1/get-started/)
* [D1 environments](https://developers.cloudflare.com/d1/configuration/environments/)
* [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
* [D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
* [Cloudflare Workers bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/)
* [D1 REST API — create database](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/)
* [D1 REST API — query database](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
* [D1 proxy tutorial and REST API guidance](https://developers.cloudflare.com/d1/tutorials/build-an-api-to-access-d1/)
* [Cloudflare SaaS data isolation](https://developers.cloudflare.com/use-cases/saas/data-isolation/)

