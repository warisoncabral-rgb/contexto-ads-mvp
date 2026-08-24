# Contexto Ads Platform — Fundação Fase 1

Fundação técnica do ecossistema para o primeiro vertical de integração Meta:

**Connect → Discover → Validate → Read → Contextualize**

A fase atual é **somente leitura**. Não há métodos de publicação, criação de campanha ou alteração de objetos Meta.
O contexto interno de campanha já pode ser estruturado e validado sem qualquer
operação externa.

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
Retorna um diagnóstico dinâmico, sem chamadas externas, para configuração do app,
cofre, OAuth, descoberta de ativos e capacidades de leitura. Cada pendência traz
significado, evidência e a próxima ação recomendada; nenhum segredo é retornado.

### `POST /v1/readiness/:connectionId/snapshots`
Body: `{"tenantId":"..."}`. Gera e persiste uma fotografia imutável do diagnóstico
atual. `GET /v1/readiness/:connectionId/snapshots/latest?tenantId=...` recupera a
evidência mais recente somente depois de validar a conexão do tenant.

### `POST /v1/readiness/:connectionId/smoke-test`
Body: `{"tenantId":"..."}`. Depois que o app Meta e o OAuth estiverem prontos,
executa automaticamente e em ordem: validação de identidade, descoberta de
ativos, comprovação de capacidades e leitura de uma conta descoberta. Para no
primeiro bloqueio, retorna somente códigos normalizados e jamais executa escrita
na Meta.
Todo resultado, aprovado ou bloqueado, é persistido. O relatório mais recente
fica disponível em `GET /v1/readiness/:connectionId/smoke-test/latest?tenantId=...`.

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

### `POST /v1/meta/connections/:connectionId/capabilities/validate`
Body: `{"tenantId":"..."}`. Consulta `/me/permissions`, cruza as permissões
concedidas com os ativos descobertos e substitui atomicamente o snapshot das
capacidades `DISCOVER_ASSETS` e `READ_AD_ACCOUNT`. Falhas da Meta não apagam a
última evidência válida; permissões ou ativos ausentes nunca são tratados como
capacidade disponível.

### `POST /v1/campaign-contexts`
Cria a primeira versão imutável do contexto de uma campanha. O body contém
`tenantId` e `facts` com nome do negócio, oferta, objetivo, público, destino,
geografia, orçamento em unidade monetária mínima e duração. Cada fato persistido
registra a origem `user_input`; campos ausentes nunca são inferidos e retornam
pendências bloqueantes com próxima ação.

### `POST /v1/campaign-contexts/:campaignId/versions`
Registra uma nova versão completa do contexto. A numeração é alocada sob lock no
PostgreSQL para evitar colisões concorrentes e versões anteriores não são
alteradas.

### `GET /v1/campaign-contexts/:campaignId/latest?tenantId=...`
Retorna somente a versão mais recente dentro do tenant. Um pacote só recebe
`ready_for_generation` quando todos os fatos críticos estão válidos; isso ainda
não publica ou modifica nada na Meta.

### `POST /v1/campaigns/:campaignId/plans`
Body: `{"tenantId":"...","contextVersion":1}`. Transforma uma versão pronta do
Campaign Context em um plano lógico imutável. Se `contextVersion` for omitida, a
versão mais recente é fixada no plano. A mesma entrada é idempotente e retorna o
plano originalmente persistido, inclusive sob requisições concorrentes.

O plano calcula o teto financeiro, mapeia o objetivo por regras versionadas,
preserva público, geografia e destino informados, cria a dependência lógica entre
campanha, conjunto, briefing criativo e anúncio e registra a justificativa de
cada decisão. Todos os objetos permanecem `PAUSED`; conteúdo criativo, alvo Meta,
capacidades de escrita e aprovação são pendências bloqueantes explícitas.

### `GET /v1/campaigns/:campaignId/plans/latest?tenantId=...`
Recupera somente o plano mais recente do tenant. O payload inclui hash,
idempotência, teto financeiro, decisões, riscos, prontidão e a garantia
`writesAllowed: false` / `writesPerformed: false`.

### `POST /v1/campaigns/:campaignId/plans/:executionPlanId/approvals`
Body: `{"tenantId":"...","requestedBy":"..."}`. Solicita aprovação somente
para o plano mais recente da campanha. A autorização fica vinculada à versão,
ao hash, ao teto financeiro, à moeda, aos objetos e às capacidades exatas do
plano, expira em 24 horas e não autoriza escrita externa.

Solicitações concorrentes para o mesmo hash retornam uma única aprovação ativa.
Cada mudança de estado e seu evento de auditoria são gravados na mesma transação:
se a auditoria falhar, a mudança também é revertida.

### `GET /v1/approvals/:approvalId?tenantId=...`
Consulta a aprovação dentro do tenant. Durante a consulta, aprovações vencidas
são marcadas como `expired`; se outro plano tiver se tornado o mais recente,
aprovações `pending` ou `approved` são marcadas como `invalidated`.

### Decisões de aprovação
- `POST /v1/approvals/:approvalId/approve` com `tenantId` e `approvedBy`.
- `POST /v1/approvals/:approvalId/reject` com `tenantId`, `rejectedBy` e `reason`.
- `POST /v1/approvals/:approvalId/revoke` com `tenantId`, `revokedBy` e `reason`.

A aprovação acontece atomicamente apenas se o hash ainda corresponder ao plano
mais recente e o prazo não tiver vencido. Rejeição e revogação exigem motivo.

## Segurança
- Tokens nunca entram em CampaignPackage, ExecutionPlan, ExecutionRecord ou AuditEvent.
- O Meta Adapter está fail-closed até OAuth e permissões reais serem configurados.
- Capacidade desconhecida não é tratada como disponível.
- A Fase 1 não possui escrita na Meta.
- Fatos críticos ausentes bloqueiam geração; a automação não cria inferências silenciosas.
- Planos lógicos são idempotentes, explicáveis e não autorizam efeitos externos.
- Aprovações são temporárias, vinculadas ao hash e auditadas atomicamente.
- Respostas Graph são limitadas a 256 KiB, redirects são recusados e erros externos são normalizados.

## Próxima entrega
Vincular ao plano uma conta Meta previamente descoberta, validar capacidades de
escrita e preparar o orquestrador fail-closed, mantendo a publicação desligada.
Em paralelo, criar/configurar o app Meta, concluir
um OAuth real e acionar o smoke test automatizado continua sendo a única
validação externa restante para o vertical atual.
