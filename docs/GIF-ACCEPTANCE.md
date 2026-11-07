# Testar envios de GIF

Execute a aceitação dos dois repositórios com:

```sh
npm run test:acceptance:gif
```

O comando exige Node 22+, as dependências npm instaladas, Go compatível com o `go.mod` do backend, FFmpeg e ffprobe. O checkout de `https://github.com/neurau/evolution-go.git` fica em `.scratch/evolution-go`, conforme `AGENTS.md`. A versão desse checkout precisa incluir o suporte a GIF e seus testes.

O teste do WaPilot executa o handler HTTP MCP e o cliente de mídia reais com D1 e backend simulados. Ele verifica o contrato JSON:API, a autorização de escrita, os metadados do arquivo convertido e a preservação da reprodução em loop no encaminhamento.

O teste do backend executa o middleware JSON:API, o handler HTTP, o serviço de mídia e a conversão FFmpeg reais. Um transporte simulado captura o upload e o despacho ao WhatsApp. O ffprobe verifica o arquivo MP4 produzido. A aceitação exige FFmpeg e ffprobe presentes, sem pular a conversão quando faltam.

Os testes não usam credenciais de produção nem enviam mensagens a destinatários reais. A aceitação local verifica o contrato e o arquivo produzido. A reprodução no aplicativo exige uma validação posterior em Android, iOS e WhatsApp Web com destino e conteúdo autorizados.
