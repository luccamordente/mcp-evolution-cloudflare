# Sender de callbacks do WaPilot

Serviço interno Node 22+, sem dependências, banco, arquivos de negócio ou retries. Executa um único POST HTTPS com corpo e cabeçalhos já preparados pelo Worker. Assinaturas, autorização de usuário, retenção e novas tentativas pertencem ao Worker. Este pacote não deve receber uma rota pública de proxy.

## Contrato HTTP

`GET /healthz` retorna `200 {"ok":true}` quando o processo está pronto. `POST /send` exige `Authorization: Bearer <CALLBACK_SENDER_TOKEN>`, `Content-Type: application/json`, `X-WaPilot-Deadline: <milissegundos Unix>` e este envelope:

```json
{
  "url": "https://receiver.example.com/callback",
  "body": "{\"type\":\"verification\",\"challenge\":\"example\"}",
  "headers": {
    "Content-Type": "application/json",
    "webhook-id": "verification_example",
    "webhook-timestamp": "1794090000",
    "webhook-signature": "v1,example",
    "X-MCP-Subscription-Id": "sub_example"
  }
}
```

Somente essas propriedades e cabeçalhos do envelope são aceitos. Os quatro cabeçalhos de identificação/assinatura são obrigatórios; `Content-Type` é opcional e assume `application/json`. Nomes de cabeçalho são comparados sem distinguir maiúsculas; valores são preservados. O corpo é a string UTF-8 exata que o Worker assinou: o sender não reserializa seu JSON. Headers de OAuth, conexão, prazo e autenticação interna não são encaminhados. A mesma interface atende desafios e notificações, conforme o [perfil OpenAI de MCP Events](https://developers.openai.com/plugins/build/mcp-events).

O prazo interno é obrigatório, inteiro positivo e seguro, validado somente após autenticação. Um prazo vencido retorna `504` sem acessar o callback; valor ausente ou inválido retorna `400`. O Node aplica o menor prazo entre esse valor absoluto e seus dez segundos locais, incluindo leitura do envelope, DNS e TLS. Respostas DNS tardias não iniciam conexão; a escrita HTTPS só começa após `secureConnect`, certificado verificado e nova conferência do prazo. Isso independe de cancelamento do chamador. O sender recebe apenas um limite de transporte, sem conhecer assinatura, lease ou eventos.

Uma operação HTTP concluída retorna `200 {"status":202,"body":"..."}`. `status` é o status real do callback, inclusive `3xx`, `410` e `413`; `200` do sender não significa aceite do callback. Respostas acima do limite incluem `bodyTruncated:true`, mantendo somente o prefixo limitado. O verificador de desafios deve rejeitar respostas truncadas. Aceite do callback `2xx` comprova somente recebimento HTTP.

Erros retornam somente `{"error":"<código>"}`:

| HTTP | Código | Significado |
| --- | --- | --- |
| 400 | `invalid_request` | Contrato, URL, tamanho do corpo ou cabeçalhos inválidos. |
| 400 | `destination_blocked` | IP literal ou resultado DNS não público. |
| 401 | `unauthorized` | Autenticação interna ausente ou inválida. |
| 404 | `not_found` | Método ou caminho não suportado. |
| 413 | `request_too_large` | Envelope interno acima de 2 MiB. |
| 502 | `callback_failed` | Falha de DNS, conexão, TLS ou leitura da resposta. |
| 504 | `callback_timeout` | Prazo absoluto recebido ou limite local de dez segundos atingido. |

Não registre envelope, corpo da resposta, URL completa, segredos ou assinaturas. O processo registra somente sua porta ao ficar pronto; erros externos nunca são copiados para a resposta.

## Rede e limites

A resolução acontece no `lookup` da conexão Node, com todos os endereços validados. Uma resposta DNS mista, com qualquer endereço bloqueado, é recusada. O socket usa somente o endereço escolhido nessa resolução, com seleção automática de família e pooling desativados. O hostname original permanece no Host/SNI e na validação padrão do certificado; o IP conectado também é conferido. Não há redirects, proxy de ambiente nem segunda consulta DNS para conectar. A implementação usa as APIs documentadas de [HTTPS](https://nodejs.org/docs/latest-v22.x/api/https.html) e [conexão TCP](https://nodejs.org/docs/latest-v22.x/api/net.html#socketconnectoptions-connectlistener) do Node completo.

O filtro recusa redes privadas, locais, multicast, documentação, benchmarks e blocos especiais. IPv6 aceita unicast global `2000::/3`, excluindo `2001::/23`, `2001:db8::/32`, `2002::/16` e `3fff::/20`. Isso também recusa endereços mapeados/traduzidos e protocolos especiais. A política é conservadora nos blocos reservados pelo IETF; não usa allowlist de hosts. A lista foi conferida nos registros [IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry) e [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) da IANA em 2026-11-07 e precisa acompanhar mudanças de política de egress.

| Item | Limite |
| --- | --- |
| URL HTTPS | 2.048 bytes UTF-8, sem credenciais ou fragmento. |
| Corpo do callback | 256 KiB UTF-8. |
| Envelope interno JSON | 2 MiB, incluindo o escaping do corpo. |
| Valor de cada cabeçalho permitido | 4.096 bytes, sem controles HTTP inválidos. |
| Cabeçalhos HTTP recebidos e da resposta do callback | 8 KiB. |
| Corpo lido da resposta do callback | Prefixo de até 16 KiB antes da conversão UTF-8. |
| Processamento do POST | Menor valor entre 10 segundos após receber os cabeçalhos e o prazo absoluto interno; inclui leitura do envelope, DNS, conexão, TLS e resposta. |

## Execução e validação local

`CALLBACK_SENDER_TOKEN` deve ser um segredo de pelo menos 32 bytes, fornecido ao processo pelo controlador. `PORT` assume `8080` e `HOST` assume `0.0.0.0`. Não grave o segredo na imagem. Ao receber SIGTERM, o processo para de aceitar conexões e permite que chamadas ativas terminem dentro do prazo; um limite de onze segundos garante encerramento.

```sh
npm --prefix sender test
docker build -t wapilot-callback-sender sender
npm --prefix sender run test:container
```

O último comando exige Docker e OpenSSL locais. Ele constrói a imagem, cria uma rede bridge temporária com subnet `93.184.216.0/24`, executa DNS e receptor TLS controlados e usa certificados temporários exclusivos dos testes. Não acessa callbacks reais. Remove containers, rede, imagem de teste e certificados ao terminar. Essa subnet pode conflitar com uma rede Docker já existente; pare a execução conflitante antes de repetir a suíte.

Os testes observam o endpoint HTTP de um processo Node real e, na imagem, o IP do receptor, Host/SNI, certificado, bytes Unicode, cabeçalhos, bloqueios de IP/DNS misto, rebinding, redirects, limites, prazo absoluto durante DNS/TLS sem cancelamento do chamador e SIGTERM durante uma chamada. `npm run test:sender-container` na raiz também cobre o controlador no workerd/Docker, inclusive expiração enquanto o Container inicia. A prova Docker local **não comprova o egress da Cloudflare**; a homologação remota continua necessária. Nenhum recurso remoto é criado por esses testes.
