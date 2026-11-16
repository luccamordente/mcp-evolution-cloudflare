# Testar envios de GIF

Execute a aceitação local do WaPilot com:

```sh
npm run test:acceptance:gif
```

Os pré-requisitos são Node 22+ e as dependências npm instaladas. O comando executa o bloco `GIF acceptance` de `test/outbound-history.test.ts`, também incluído em `npm test`. Não depende de checkout do backend, Go, FFmpeg ou ffprobe.

O harness executa o handler HTTP MCP e o cliente de mídia reais com D1 e backend simulados. Ele verifica o contrato JSON:API de envio e encaminhamento, legenda e citação, autorização de escrita, isolamento de conexões, limite de entrada, metadados retornados pelo provedor e preservação da opção de reprodução em loop. Também verifica a sanitização das respostas e da auditoria, a ausência de cache de conteúdo e a ausência de repetição automática após falha no envio.

A conversão real de GIF para MP4, a inspeção do arquivo produzido e a construção da mensagem nativa devem ser verificadas pelos testes do backend no próprio repositório. As respostas simuladas desta suíte expressam as expectativas do WaPilot; não comprovam que uma versão do provedor atende a esse contrato.

Os testes usam dados sintéticos, sem credenciais de produção ou envios a destinatários reais. A entrega e a reprodução no aplicativo exigem uma validação posterior em Android, iOS e WhatsApp Web com destino e conteúdo autorizados.
