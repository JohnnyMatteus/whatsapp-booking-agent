# Chart wba

Implanta os seis componentes do whatsapp-booking-agent num namespace. **Não foi instalado em nenhum cluster**:
o CI só roda `helm lint` e `helm template` (job `helm`).

- Um release por namespace; os Services têm o nome simples do componente (o `kong.yaml` e o nginx do painel dependem disso).
- RabbitMQ, Redis (7.4 ou mais novo: o booking-agent usa `HEXPIRE`), Keycloak, S3/MinIO, o SaaS e o provedor de LLM ficam fora do chart: os endereços vão em `config` e as credenciais num Secret existente (`secretName`, chaves no `values.yaml`).
- Nada de segredo no chart; `helm template` falha sem `secretName`.
- O api-gateway lê a chave pública do Keycloak ao subir (`OIDC_REALM_URL`); reinicie-o se o realm trocar de chave (ADR 0013).
- Exposição: `ingress.enabled` publica `/webhooks` e `/api` (api-gateway) e `/` (painel). Os demais componentes só aceitam tráfego interno (NetworkPolicy, que exige um CNI com suporte).

```bash
helm template wba deploy/helm/wba --set secretName=wba-secrets
```
