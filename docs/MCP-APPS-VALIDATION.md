# Validação da galeria MCP Apps — issue #8

Registro de 19 de outubro de 2026. A implementação e os testes locais não
comprovam a renderização no ChatGPT ou no Codex desktop. O critério de aceitação
que exige demonstração nos dois hosts permanece **aberto**.

## Caminhos de conexão e evidência disponível

| Host | Caminho verificado na documentação oficial | Evidência operacional desta entrega |
| --- | --- | --- |
| ChatGPT | Plugins → botão + → Add custom MCP server; informar endpoint HTTPS `/mcp` ou Secure MCP Tunnel, configurar OAuth, criar e instalar o plugin. Atualizar metadados com Refresh após alterações. | UI da galeria não demonstrada; versão do cliente não registrada. |
| Codex desktop | A configuração MCP documenta Streamable HTTP com OAuth. O app-server documenta `appContext.resourceUri` em chamadas de apps confiáveis. Essas informações não estabelecem que um servidor arbitrário adicionado à configuração MCP possa renderizar um componente. | Caminho de instalação com UI para este servidor ainda não comprovado; versão do cliente e interação não registradas. |

Fontes consultadas:

- [Conectar e testar um plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt).
- [UI MCP Apps no ChatGPT](https://developers.openai.com/plugins/build/chatgpt-ui).
- [Recursos MCP suportados no Codex](https://learn.chatgpt.com/docs/extend/mcp#supported-mcp-features).
- [Itens do app-server e contexto de apps](https://learn.chatgpt.com/docs/app-server#items).

O recurso deve usar o protocolo MCP Apps e detecção de capacidades; a documentação
não autoriza inferir suporte pelo nome do host. Sucesso no Inspector, em um host
de teste, em um navegador comum ou em `config.toml` não encerra esse critério.

O escopo desta issue exclui push, deploy e mudanças de infraestrutura. Nenhum
endpoint de produção foi atualizado para disponibilizar o código novo aos hosts.
Nenhum túnel foi criado nem foram ampliadas permissões de conexão. A inspeção da
aplicação desktop pelo mecanismo de automação disponível foi recusada pelo próprio
mecanismo; isso não é evidência de incompatibilidade do produto.

## Demonstração necessária para encerrar o critério

Para cada host separadamente, registrar data, versão, caminho de instalação,
commit servido e evidência redigida de:

1. Descoberta da ferramenta e leitura do recurso `ui://` com o MIME MCP Apps.
2. Galeria com imagens recebidas e enviadas em uma conexão autorizada.
3. Ampliação por teclado, fechamento e retorno do foco ao controle de origem.
4. Recuperação de falha de imagem e atualização explícita de links, mantendo a
   conexão original mesmo após mudança da conexão padrão.
5. Layout em largura reduzida e nos temas oferecidos pelo host.
6. Isolamento entre contas e fallback textual útil quando não houver UI.

Usar fixtures ou imagens autorizadas sem conteúdo sensível. Não incluir em
capturas, transcrições ou relatórios URLs assinadas, credenciais, envelopes brutos
ou conversas privadas. Se não existir caminho suportado no Codex, registrar a
limitação observada, a versão e a fonte oficial, mantendo o critério aberto.
