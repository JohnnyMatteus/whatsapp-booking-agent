# ADR 0013: Login do painel por OIDC, com estúdio e papel vindos do token

**Status:** Aceito. Substitui a autenticação do painel descrita nos ADRs 0004 e 0012 (token estático injetado pelo proxy).

## Contexto

Até aqui o painel não tinha identidade de atendente. O nginx do painel injetava um JWT fixo, sem expiração, assinado com um segredo de desenvolvimento versionado no compose, para qualquer visitante; o booking-agent usava o `:tenantId` da URL sem compará-lo com ninguém. Quem alcançasse a porta lia e respondia conversas de qualquer estúdio, e só o bind em `127.0.0.1` segurava.

## Decisão

1. **Login por OIDC no Keycloak**, fluxo authorization code com PKCE (S256), client público `wba-panel` sem segredo (`oidc-client-ts` no painel). O realm `wba` de desenvolvimento é versionado em `infra/keycloak/wba-realm.json`, com três usuários fictícios (`ana.lotus` e `bia.lotus` do `estudio-lotus`, `caio.sol` do `estudio-sol`), senhas `dev-only-*` e **nenhuma chave**: o Keycloak gera o par RSA no primeiro boot, então nada que assine token está no repositório. Produção usa realm próprio.
2. **Estúdio e papel vêm só do token.** O estúdio é a realm role `tenant:<id>` (exatamente uma; zero ou mais de uma falha fechado) e o papel é `attendant` ou `manager`. A escolha por role e não por atributo do usuário evita depender do user profile do Keycloak, que descarta atributos não declarados. `manager` pode tudo do `attendant` e vê as métricas.
3. **Duas validações.** O api-gateway (Kong, plugin `jwt`, RS256, chave pública do realm lida do Keycloak ao subir) rejeita token sem assinatura válida, expirado ou com validade acima de 1 hora, e aplica rate limit. O Authorization segue intacto para o booking-agent, que valida de novo (`jose`, JWKS do Keycloak, `iss`, `aud=wba-api`, `exp`, algoritmo RS256) e é quem decide: o `:tenantId` da rota precisa ser o do token (senão 403) e o papel mínimo da rota precisa estar no token (senão 403). Cabeçalhos de tenant ou papel enviados pelo cliente não existem para o servidor.
4. **Nada de token no servidor do painel.** O nginx repassa o Authorization do navegador ao gateway; `PANEL_API_TOKEN`, `PANEL_JWT_SECRET` e o JWT fixo foram removidos. A configuração pública do login (`issuer`, `clientId`) sai em `/config.json`.
5. **Sem rota pública para o booking-agent.** A porta 8081 deixou de ser publicada no host: o painel só entra pelo gateway. A rota `/internal/*` (avisos por template, chamada pelo SaaS) não tem rota no Kong e exige o token de serviço `INTERNAL_API_TOKEN`; um JWT de atendente não a abre.
6. **A política do booking-agent é decidida pela rota casada, não pela URL crua.** O roteador decodifica o caminho (`/%61pi/...` casa `/api/...`); decidir por `request.url` deixaria esse caminho sem autenticação. O hook usa `routeOptions.url` e falha fechado: só `/healthz` e `/metrics` são públicos, `/api` exige JWT, `/internal` exige o token de serviço e qualquer outra rota casada sem política é recusada. Há teste com variantes codificadas de cada rota `/api` e `/internal`, e o smoke do Kong cobre as mesmas formas na borda.
7. O painel guarda a sessão em `sessionStorage` (fechar a aba encerra o login), renova o token em segundo plano e, num 401, volta ao login. Esconder a tela de métricas de quem não é `manager` é conveniência: o servidor recusa de qualquer modo.

## Consequências

- Vazamento entre estúdios é testado em cada rota `/api` (`tests/adapters/panel-auth.test.ts`): token de outro estúdio, sem papel, expirado, forjado, de outra audiência ou emissor, e com dois estúdios.
- O Kong OSS não busca JWKS: o `entrypoint.sh` lê a chave pública de `GET /realms/wba` (rede interna, com tentativas) e o gateway **não sobe** se ela não vier, se estiver vazia ou fora do formato PEM. Rotação de chave no Keycloak exige reiniciar o gateway; o booking-agent acompanha sozinho pelo JWKS. Se o Keycloak perder o banco e gerar outro par de chaves, todo token passa a dar 401 no gateway (falha fechada) até ele reiniciar: `docker compose restart api-gateway`. O compose não persiste o banco de desenvolvimento do Keycloak: recriar o contêiner troca a chave, e o gateway precisa reiniciar junto. Um volume em `/opt/keycloak/data/h2` foi tentado e derrubou o Keycloak (o diretório nasce de root e a imagem roda sem root).
- Os dois pontos de validação precisam concordar em emissor e audiência; o compose define os dois a partir do mesmo `OIDC_ISSUER`.
- `/internal/*` continua com token de serviço compartilhado: serve a quem está na rede interna, não a usuário. Um token por estúdio e por chamador é próximo passo.
- O fluxo contra um Keycloak real (login no navegador, renovação, logout) não foi exercitado nesta rodada: os testes cobrem a validação do token e o cliente do painel com um provedor falso, e o CI valida o Kong com um par de chaves descartável gerado no próprio job. O script `fetch-realm-key.lua` (leitura da chave no Keycloak) só roda dentro da imagem do Kong e não foi exercitado.

## Alternativas

- **Manter o JWT HS256 de desenvolvimento**: segredo compartilhado e token sem dono; não identifica atendente.
- **Só o gateway valida**: o booking-agent confiaria em cabeçalhos que o gateway repassa; um desvio da rota do gateway abriria tudo. Duas validações custam uma biblioteca.
- **Só o booking-agent valida**: perde o filtro e o rate limit na borda.
- **Tenant como atributo do usuário**: mais convencional, mas depende de declarar o atributo no user profile e falha em silêncio quando esquecido.
- **Plugin `openid-connect` do Kong**: é Enterprise.
