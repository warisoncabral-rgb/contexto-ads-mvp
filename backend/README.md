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

Aplique os arquivos SQL de `db/migrations` em ordem numérica antes de iniciar a API.

## Credential Vault sem Google Cloud
O MVP suporta um cofre PostgreSQL criptografado com:

```bash
CREDENTIAL_VAULT_PROVIDER=postgres
CREDENTIAL_VAULT_MASTER_KEY=<32 bytes aleatórios codificados em base64>
```

Gere a chave uma única vez com `openssl rand -base64 32`. Guarde-a somente nas
configurações protegidas do ambiente de hospedagem, separada do banco. Perder a
chave torna as credenciais irrecuperáveis; expor a chave junto com uma cópia do
banco elimina a proteção do cofre. O banco contém apenas ciphertext autenticado
com AES-256-GCM e referências opacas.

PRs que alteram o backend executam a suíte completa contra PostgreSQL 18 real,
incluindo migrações, consumo concorrente do state OAuth, isolamento entre
tenants, armazenamento criptografado e revogação de credenciais.

## Endpoints iniciais
### `POST /v1/meta/connections/start`
Body:
```json
{"tenantId":"00000000-0000-0000-0000-000000000001"}
```
Enquanto o app Meta real não estiver configurado, retorna `authorization_pending` e não chama nenhuma operação externa de escrita.

### `GET /v1/readiness/:connectionId?tenantId=...`
Retorna um snapshot explícito do bloqueio atual de configuração.

### `POST /v1/meta/connections/:connectionId/discover-assets`
Body: `{"tenantId":"..."}`. Executa descoberta somente leitura para uma conexão
OAuth já conectada e substitui o snapshot anterior atomicamente apenas em caso de
sucesso. Enquanto a Graph API real não estiver configurada, permanece fail-closed.

O cliente somente leitura usa os edges versionados `/me/adaccounts` e
`/me/accounts`, solicita apenas `id,name`, pagina por cursor com limite defensivo,
envia o token somente no header `Authorization` e assina chamadas com
`appsecret_proof`. O OAuth solicita apenas `public_profile`, `ads_read` e
`pages_show_list` nesta etapa.

### `GET /v1/meta/connections/:connectionId/assets?tenantId=...`
Lista somente os ativos persistidos para o tenant e a conexão informados.

### `GET /v1/meta/connections/:connectionId/ad-accounts/:adAccountId?tenantId=...`
Lê dados básicos (`id`, nome, estado, moeda e fuso horário) somente de uma conta
de anúncios presente no snapshot de descoberta da mesma conexão e tenant. IDs
malformados, conexões não prontas e contas não descobertas são recusados antes
de qualquer chamada à Graph API.

### `GET /v1/meta/connections/:connectionId/capabilities?tenantId=...`
Lista o registro persistido de capacidades e suas evidências somente depois de
validar que a conexão pertence ao tenant informado. A validação contra a Meta
continua fail-closed enquanto o app real não estiver configurado.

## Segurança
- Tokens nunca entram em CampaignPackage, ExecutionPlan, ExecutionRecord ou AuditEvent.
- O Meta Adapter está fail-closed até OAuth e permissões reais serem configurados.
- Capacidade desconhecida não é tratada como disponível.
- A Fase 1 não possui escrita na Meta.
- Respostas Graph são limitadas a 256 KiB, redirects são recusados e erros externos são normalizados.

## Próxima entrega
Validar o fluxo somente leitura já implementado com um app Meta real e então
ligar as evidências reais ao Capability Registry.
