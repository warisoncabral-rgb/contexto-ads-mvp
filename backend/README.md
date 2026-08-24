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

### `POST /v1/campaigns/:campaignId/plans/:executionPlanId/target`
Body: `{"tenantId":"...","connectionId":"...","adAccountId":"act_..."}`.
Vincula ao plano somente uma conta de anúncios presente no snapshot de descoberta
da mesma conexão e tenant. IDs arbitrários, conexões não prontas e planos antigos
são recusados antes da persistência.

O vínculo produz um novo plano, hash e idempotency key, mantém os objetos pausados
e os efeitos externos desabilitados. Aprovações do hash anterior são invalidadas
imediatamente, com auditoria na mesma transação da invalidação.

### `POST /v1/campaigns/:campaignId/plans/:executionPlanId/simulations`
Body: `{"tenantId":"...","approvalId":"..."}`. Executa um dry-run local e
persistente, sem chamar endpoints de escrita. A simulação comprova:

- plano mais recente e grafo de dependências sem ciclos;
- conexão Meta pronta e conta ainda presente nos ativos descobertos;
- todas as capacidades de escrita exigidas com evidência `available`;
- aprovação vigente para o hash, moeda e teto financeiro atuais;
- conteúdo criativo aprovado;
- trava de escrita externa ativa.

O relatório ordena campanha, criativo, conjunto e anúncio pelas dependências,
mas todas as operações registram `willExecute: false`. Mesmo um relatório
`ready_for_execution` não publica nada. O último relatório fica disponível em
`GET /v1/plans/:executionPlanId/simulations/latest?tenantId=...`.

### `POST /v1/creative-packages/:campaignId/versions`
Registra uma nova versão completa do pacote criativo com `tenantId`,
`executionPlanId`, `createdBy` e `creative`. O conteúdo inclui uma ou mais
variações de texto e CTA, alegações com referências de origem, mídias com
referência opaca e SHA-256 e o checklist explícito de revisão.

Somente formatos JPEG, PNG e MP4 são aceitos nesta versão. Cada alteração cria
um novo hash, deriva um plano bloqueado e invalida imediatamente aprovações do
plano anterior. A operação não envia nem transforma mídia e não chama a Meta.

### `POST /v1/creative-packages/:campaignId/versions/:version/approve`
Body: `{"tenantId":"...","contentHash":"...","approvedBy":"..."}`.
Aprova somente a versão mais recente, quando o hash corresponde exatamente ao
conteúdo persistido, todas as alegações possuem fontes e todo o checklist foi
confirmado. A aprovação deriva um novo plano em autonomia A0; portanto ainda é
necessária a aprovação final do plano e nenhuma escrita externa é liberada.

### `GET /v1/creative-packages/:campaignId/latest?tenantId=...`
Retorna somente a versão criativa mais recente do tenant. O dry-run exige que o
plano referencie exatamente o ID, a versão e o hash desse pacote em estado
`approved`; marcar apenas `copyStatus` no plano não é suficiente.

### `POST /v1/campaigns/:campaignId/plans/:executionPlanId/readiness-decisions`
Body: `{"tenantId":"...","approvalId":"..."}`. Gera uma decisão operacional
em linguagem simples. Quando `approvalId` é omitido, o serviço reaproveita a
referência da última simulação e sempre executa um novo dry-run seguro para
detectar aprovação expirada, plano alterado ou evidência que deixou de ser válida.

A resposta organiza cada ponto como decisão, motivo e base, apresenta o teto
financeiro, classifica bloqueadores por responsável (`system`, `operator` ou
`meta_environment`) e escolhe uma única próxima ação pela ordem técnica correta.
Os marcos são separados para impedir falsa continuidade:

- preparação da campanha;
- validação do ambiente Meta;
- aprovação criativa;
- aprovação humana do plano;
- validação do executor;
- publicação;
- ativação;
- entrega.

O estado máximo nesta fase é `ready_for_executor_validation`. Mesmo nele,
`campaignPublished`, `campaignActive`, `campaignDelivering`,
`externalWritesAllowed` e `externalWritesPerformed` permanecem `false`.

### `GET /v1/plans/:executionPlanId/readiness-decisions/latest?tenantId=...`
Retorna a última decisão persistida somente depois de comprovar que o plano
pertence ao tenant. Decisões semanticamente iguais retornam o mesmo snapshot e
somente a primeira inserção gera o evento de auditoria.

### `POST /v1/campaigns/:campaignId/plans/:executionPlanId/execution-manifests`
Body: `{"tenantId":"...","approvalId":"..."}`. Refaz a decisão operacional e,
somente quando todas as verificações internas passam, prepara um manifesto
imutável das operações futuras. Cada operação recebe chave idempotente,
fingerprint da configuração, dependências, pré-condições e regras fail-closed
para falha parcial, compensação e reconciliação.

O manifesto não é um comando de execução. Seu único estado é
`prepared_gate_closed`; todas as operações continuam `PAUSED`, `not_started` e
`executionAllowed: false`. O gate registra como ausentes a aprovação específica
de execução, a validação real de escrita e o adapter de escrita. Resultado
externo desconhecido jamais poderá ser repetido antes de reconciliação.

### `GET /v1/plans/:executionPlanId/execution-manifests/latest?tenantId=...`
Retorna o manifesto mais recente somente dentro do tenant e plano informados.
Solicitações semanticamente iguais recuperam o mesmo manifesto; a persistência e
o evento de auditoria ocorrem atomicamente apenas na primeira inserção.

### Autorização específica de execução
`POST /v1/execution-manifests/:executionManifestId/authorizations` recebe
`tenantId` e `requestedBy`. A solicitação é de alto risco, vale 15 minutos e fica
vinculada ao plano, manifesto e hashes exatos. Ela autoriza somente a intenção
futura de criação controlada com objetos pausados; não libera escrita por si só.

- `POST /v1/execution-authorizations/:id/approve` — `tenantId`, `approvedBy`;
- `POST /v1/execution-authorizations/:id/reject` — `tenantId`, `rejectedBy`, `reason`;
- `POST /v1/execution-authorizations/:id/revoke` — `tenantId`, `revokedBy`, `reason`;
- `GET /v1/execution-authorizations/:id?tenantId=...` — consulta e atualiza
  expiração/invalidação de forma fail-closed.

Mesmo aprovada, a resposta mantém `effectiveExecutionPermission: false`,
`externalWritesAllowed: false` e `externalWritesPerformed: false`. Manifesto
substituído ou prazo vencido invalida a autorização.

### `POST /v1/execution-authorizations/:id/preflights`
Body: `{"tenantId":"..."}`. Persiste uma avaliação idempotente do gate. O
preflight distingue manifesto atual, autorização específica, Kill Switch do
tenant e campanha, validação Meta real e adapter de escrita.

Nesta fase o resultado é sempre `blocked_before_attempt`: Kill Switch, validação
real e adapter ainda não existem. Por isso `executionRecordCreated`,
`externalAttemptStarted`, publicação, ativação, entrega e todos os efeitos
externos permanecem `false`.

## Segurança
- Tokens nunca entram em CampaignPackage, ExecutionPlan, ExecutionRecord ou AuditEvent.
- O Meta Adapter está fail-closed até OAuth e permissões reais serem configurados.
- Capacidade desconhecida não é tratada como disponível.
- A Fase 1 não possui escrita na Meta.
- Fatos críticos ausentes bloqueiam geração; a automação não cria inferências silenciosas.
- Planos lógicos são idempotentes, explicáveis e não autorizam efeitos externos.
- Aprovações são temporárias, vinculadas ao hash e auditadas atomicamente.
- Simulações validam o plano inteiro e jamais executam as operações apresentadas.
- Mudanças criativas invalidam o plano anterior; mídias e conteúdo são ligados por hash.
- A linguagem operacional nunca confunde preparação com publicação, ativação ou entrega.
- Manifestos descrevem efeitos futuros, mas não são executáveis e não contêm IDs externos inventados.
- Autorizações curtas não substituem os demais gates; preflight bloqueado não é registrado como execução.
- Respostas Graph são limitadas a 256 KiB, redirects são recusados e erros externos são normalizados.

## Próxima entrega
Implementar o Kill Switch persistente por tenant e campanha e integrá-lo ao
preflight, ainda sem adicionar um adapter de escrita ou liberar efeitos externos.
A escrita Meta continuará desligada. Em paralelo, criar/configurar o app Meta, concluir
um OAuth real e acionar o smoke test automatizado continua sendo a única
validação externa restante para o vertical atual.
