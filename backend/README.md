# Contexto Ads Platform — Fundação Fase 1

Fundação técnica do ecossistema para o primeiro vertical de integração Meta:

**Connect → Discover → Validate → Read**

A fase atual é **somente leitura**. Não há métodos de publicação, criação de campanha ou alteração de objetos Meta.

## Stack
- Node.js 24 LTS
- TypeScript
- NestJS
- PostgreSQL 18

A escolha usa Node 24 LTS, enquanto Node 26 ainda está na linha Current em agosto de 2026. O PostgreSQL 18 é a versão estável corrente; PostgreSQL 19 está em beta.

## Rodar localmente
```bash
cp .env.example .env
docker compose up -d
npm install
npm run start:dev
```

## Endpoints iniciais
### `POST /v1/meta/connections/start`
Body:
```json
{"tenantId":"00000000-0000-0000-0000-000000000001"}
```
Enquanto o app Meta real não estiver configurado, retorna `authorization_pending` e não chama nenhuma operação externa de escrita.

### `GET /v1/readiness/:connectionId?tenantId=...`
Retorna um snapshot explícito do bloqueio atual de configuração.

## Segurança
- Tokens nunca entram em CampaignPackage, ExecutionPlan, ExecutionRecord ou AuditEvent.
- O Meta Adapter está fail-closed até OAuth e permissões reais serem configurados.
- Capacidade desconhecida não é tratada como disponível.
- A Fase 1 não possui escrita na Meta.

## Próxima entrega
Implementar o onboarding OAuth real, descoberta de ativos, Capability Registry validado e leitura de conta/estado.
