# Validação da galeria MCP Apps — issue #8

Registro de 19 de outubro de 2026. A implementação e os testes locais não
comprovam a renderização no ChatGPT ou no Codex desktop. O critério de aceitação
que exige demonstração nos dois hosts permanece **aberto**.

## Verificação local concluída

No código integrado em `c1ca5ed`, `npm run check` passou com 134 testes em 15
arquivos, incluindo os typechecks do Worker e da UI e a conferência do bundle
gerado. `npx wrangler deploy --dry-run` e `git diff --check` também passaram.
Os testes verificam descoberta e leitura do recurso MCP Apps, limites e filtro
no provedor, isolamento entre contas, privacidade de URLs, CSP, falhas sanitizadas
e renovação na conexão original. A falha na primeira consulta, após autorização,
também permite atualização explícita sem mudar de conexão.

O componente foi exercitado com uma ponte de host fictícia no Chrome 155.0.0.0,
macOS: miniaturas recebidas/enviadas, mídia indisponível, Tab/Enter para ampliar,
Escape com retorno de foco, falhas de atualização sem repetição automática e
renovação manual de link. A inspeção visual cobriu tema claro em 840 × 760 e tema
escuro em largura de 360 px, sem overflow horizontal. As imagens eram fixtures;
nenhuma mensagem real foi usada. Isso comprova o componente local, sem comprovar
uma integração instalada nos hosts exigidos.

### Standards

Revisão independente do diff `898bfea...c1ca5ed`: nenhum achado acionável de
padrões documentados ou dos heurísticos de manutenção da skill `code-review`.

### Spec

Revisão independente do mesmo diff contra o Agent Brief da issue #8: nenhum
desvio de implementação ou ampliação de escopo confirmado. Um critério
operacional continua pendente: demonstração separada nos dois hosts. A issue
deve permanecer aberta até essa verificação.

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
