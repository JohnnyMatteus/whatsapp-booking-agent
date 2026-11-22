## O que muda

<!-- Uma ou duas frases: o problema e a solução. -->

## Serviços e contratos afetados

- [ ] messaging-gateway (provedores, webhook, sender, ACLs)
- [ ] api-gateway (Kong)
- [ ] booking-agent (domínio, agente, adaptadores)
- [ ] saas-mcp-server (ferramentas MCP, ACL do SaaS)
- [ ] media-processor
- [ ] web (painel)
- [ ] contratos da fila (`packages/contracts`) ou topologia do RabbitMQ
- [ ] infraestrutura (compose, mocks, observabilidade)
- [ ] documentação (design doc, ADR, roteiros)

## Checklist

- [ ] Nenhum tipo da Meta ou do SaaS fora dos tradutores da ACL (ADR 0002)
- [ ] Mudança de contrato da fila é compatível ou cria nova versão (`version`)
- [ ] O bot continua citando só horários vindos das ferramentas (teste em `slot-citation.test.ts`)
- [ ] Saída nova do LLM tem schema e um retry
- [ ] Sem telefone, texto do aluno ou segredo em logs, spans e mensagens de erro
- [ ] Testes cobrem caminho feliz, bordas e falhas; decisão relevante registrada em ADR
- [ ] `make lint` e `make test` passam localmente

## Como testar

<!-- Comandos copiáveis. -->
