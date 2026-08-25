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
### `POST /v1/operator/tenants/:tenantId/meta/connections/start-oauth`
Exige o bearer do operador e membership com permissão `configure_tenant`. Cria a
conexão pendente e devolve a URL oficial de autorização. O início do OAuth e as
rotas de leitura não aceitam mais `tenantId` público no body ou na query.

### Diagnóstico e smoke test protegidos
Retorna um diagnóstico dinâmico, sem chamadas externas, para configuração do app,
cofre, OAuth, descoberta de ativos e capacidades de leitura. Cada pendência traz
significado, evidência e a próxima ação recomendada; nenhum segredo é retornado.

`POST /v1/operator/tenants/:tenantId/meta/connections/:connectionId/smoke-test`
exige autenticação e membership. Depois que o app Meta e o OAuth estiverem prontos,
executa automaticamente e em ordem: validação de identidade, descoberta de
ativos, comprovação de capacidades e leitura de uma conta descoberta. Para no
primeiro bloqueio, retorna somente códigos normalizados e jamais executa escrita
na Meta.
Todo resultado, aprovado ou bloqueado, é persistido. O relatório mais recente
fica disponível na rota protegida equivalente com `/smoke-test/latest`.

### `POST /v1/operator/tenants/:tenantId/meta/connections/:connectionId/discover-assets`
Executa descoberta somente leitura para uma conexão
OAuth já conectada e substitui o snapshot anterior atomicamente apenas em caso de
sucesso. Enquanto a Graph API real não estiver configurada, permanece fail-closed.

O cliente somente leitura usa os edges versionados `/me/adaccounts` e
`/me/accounts`, solicita apenas `id,name`, pagina por cursor com limite defensivo,
envia o token somente no header `Authorization` e assina chamadas com
`appsecret_proof`. O OAuth solicita apenas `public_profile`, `ads_read` e
`pages_show_list` nesta etapa.

### `GET /v1/operator/tenants/:tenantId/meta/connections/:connectionId/assets`
Lista somente os ativos persistidos para o tenant e a conexão informados.

### `GET /v1/meta/connections/:connectionId/ad-accounts/:adAccountId?tenantId=...`
Lê dados básicos (`id`, nome, estado, moeda e fuso horário) somente de uma conta
de anúncios presente no snapshot de descoberta da mesma conexão e tenant. IDs
malformados, conexões não prontas e contas não descobertas são recusados antes
de qualquer chamada à Graph API.

### `POST /v1/operator/tenants/:tenantId/meta/connections/:connectionId/capabilities/validate`
Consulta `/me/permissions`, cruza as permissões
concedidas com os ativos descobertos e substitui atomicamente o snapshot das
capacidades `DISCOVER_ASSETS` e `READ_AD_ACCOUNT`. Falhas da Meta não apagam a
última evidência válida; permissões ou ativos ausentes nunca são tratados como
capacidade disponível.

### Preparação autenticada do contexto da campanha
`GET /v1/operator/tenants/:tenantId/campaign-contexts` lista somente a versão
mais recente de cada campanha após autenticar e validar a membership.

`POST /v1/operator/tenants/:tenantId/campaign-contexts` cria a primeira versão
imutável. `POST /v1/operator/tenants/:tenantId/campaign-contexts/:campaignId/versions`
registra a próxima versão completa sob lock no PostgreSQL. Os endpoints públicos
anteriores foram removidos para que conhecer UUIDs não contorne o acesso do
operador.

O body contém `facts` com nome do negócio, oferta, objetivo, público, destino,
geografia, orçamento em unidade monetária mínima e duração. Cada fato registra a
origem `user_input`; campos ausentes nunca são inferidos e retornam tarefas
bloqueantes em linguagem operacional. Somente `owner` e `operator` podem gravar;
`viewer` permanece leitura. Persistência e `AuditEvent` acontecem na mesma
transação. Um pacote só recebe `ready_for_generation` quando todos os fatos
críticos estão válidos; isso não publica nem modifica nada na Meta.

### `POST /v1/operator/tenants/:tenantId/campaigns/:campaignId/plans`
Body: `{"contextVersion":1}`. Depois de autenticar, validar a membership e exigir
permissão de preparação, transforma a versão indicada do Campaign Context em um
plano lógico imutável. A rota pública anterior foi removida para impedir bypass
por UUID. A mesma entrada é idempotente e retorna o plano originalmente
persistido, inclusive sob requisições concorrentes.

O plano calcula o teto financeiro, mapeia o objetivo por regras versionadas,
preserva público, geografia e destino informados, cria a dependência lógica entre
campanha, conjunto, briefing criativo e anúncio e registra a justificativa de
cada decisão. Todos os objetos permanecem `PAUSED`; conteúdo criativo, alvo Meta,
capacidades de escrita e aprovação são pendências bloqueantes explícitas.

Plano e evidência `operator_execution_plan_generated` são gravados na mesma
transação. Repetir a mesma geração recupera o plano idempotente sem duplicar
auditoria. A Central mostra a revisão dos fatos e do teto antes do botão e,
depois, apresenta decisões, regras, riscos e limites do plano. O resultado
permanece `draft`, autonomia A0 e aprovação humana obrigatória.

### Consulta de planos pelo operador
`GET /v1/operator/tenants/:tenantId/plans` lista o plano mais recente por
campanha dentro da membership autenticada.
Recupera somente o plano mais recente do tenant. O payload inclui hash,
idempotência, teto financeiro, decisões, riscos, prontidão e a garantia
`writesAllowed: false` / `writesPerformed: false`.

### `POST /v1/operator/tenants/:tenantId/campaigns/:campaignId/plans/:executionPlanId/approvals`
Exige autenticação e a permissão `request_approval`; a identidade solicitante é
derivada do token, nunca do body. Solicita aprovação somente
para o plano mais recente da campanha. A autorização fica vinculada à versão,
ao hash, ao teto financeiro, à moeda, aos objetos e às capacidades exatas do
plano, expira em 24 horas e não autoriza escrita externa.

Solicitações concorrentes para o mesmo hash retornam uma única aprovação ativa.
Cada mudança de estado e seu evento de auditoria são gravados na mesma transação:
se a auditoria falhar, a mudança também é revertida.

### `GET /v1/operator/tenants/:tenantId/approvals/:approvalId`
Consulta a aprovação dentro do tenant. Durante a consulta, aprovações vencidas
são marcadas como `expired`; se outro plano tiver se tornado o mais recente,
aprovações `pending` ou `approved` são marcadas como `invalidated`.

### Decisões de aprovação
- `POST /v1/operator/tenants/:tenantId/approvals/:approvalId/approve`.
- `POST /v1/operator/tenants/:tenantId/approvals/:approvalId/reject` com `reason`.
- `POST /v1/operator/tenants/:tenantId/approvals/:approvalId/revoke` com `reason`.

Somente `owner` possui `decide_approval`; `operator` pode solicitar e `viewer`
somente consultar. A identidade decisora vem da autenticação. A aprovação
acontece atomicamente apenas se o hash ainda corresponder ao plano
mais recente e o prazo não tiver vencido. Rejeição e revogação exigem motivo.

Cada solicitação ou decisão protegida também gera uma nova fotografia de
prontidão pela simulação interna e devolve aprovação e prontidão no mesmo
contrato. Isso atualiza o Centro de Pendências, mas declara explicitamente
`approvalIsExecutionAuthorization: false`, `publicationAuthorized: false` e
`externalWritesAllowed: false`. Aprovação não substitui autorização curta,
preflight, Kill Switch ou validação do executor real.

### `POST /v1/operator/tenants/:tenantId/campaigns/:campaignId/plans/:executionPlanId/target`
Body: `{"connectionId":"...","adAccountId":"act_..."}`. Exige autenticação,
membership ativa e `manage_campaign_preparation`.
Vincula ao plano somente uma conta de anúncios presente no snapshot de descoberta
da mesma conexão e tenant. IDs arbitrários, conexões não prontas e planos antigos
são recusados antes da persistência.

O vínculo produz um novo plano, hash e idempotency key, mantém os objetos pausados
e os efeitos externos desabilitados. Aprovações do hash anterior são invalidadas
imediatamente, com auditoria na mesma transação da invalidação.

### Simulação interna protegida
As rotas públicas de simulação foram removidas. O dry-run é invocado apenas pelo
fluxo autenticado de aprovação/prontidão, sem chamar endpoints de escrita, e comprova:

- plano mais recente e grafo de dependências sem ciclos;
- conexão Meta pronta e conta ainda presente nos ativos descobertos;
- todas as capacidades de escrita exigidas com evidência `available`;
- aprovação vigente para o hash, moeda e teto financeiro atuais;
- conteúdo criativo aprovado;
- trava de escrita externa ativa.

O relatório ordena campanha, criativo, conjunto e anúncio pelas dependências,
mas todas as operações registram `willExecute: false`. Mesmo um relatório
`ready_for_execution` não publica nada e não é exposto como autorização pública.

### `POST /v1/operator/tenants/:tenantId/campaigns/:campaignId/plans/:executionPlanId/creative-packages`
Registra uma nova versão completa do pacote criativo com `creative`. Exige
membership ativa e `manage_campaign_preparation`; `createdBy` é sempre derivado
da identidade autenticada. O conteúdo inclui uma ou mais
variações de texto e CTA, alegações com referências de origem, mídias com
referência opaca e SHA-256 e o checklist explícito de revisão.

Somente formatos JPEG, PNG e MP4 são aceitos nesta versão. Cada alteração cria
um novo hash, deriva um plano bloqueado e invalida imediatamente aprovações do
plano anterior. A operação não envia nem transforma mídia e não chama a Meta.

### `POST /v1/operator/tenants/:tenantId/campaigns/:campaignId/creative-packages/:version/approve`
Body: `{"contentHash":"..."}`. Exige `decide_approval`; `approvedBy` é derivado
da identidade autenticada.
Aprova somente a versão mais recente, quando o hash corresponde exatamente ao
conteúdo persistido, todas as alegações possuem fontes e todo o checklist foi
confirmado. A aprovação deriva um novo plano em autonomia A0; portanto ainda é
necessária a aprovação final do plano e nenhuma escrita externa é liberada.

### `GET /v1/operator/tenants/:tenantId/campaigns/:campaignId/creative-packages/latest`
Retorna somente a versão criativa mais recente após autenticação e membership.
As rotas públicas anteriores foram removidas. Criação e aprovação recalculam a
prontidão, mas `creativeApprovalIsPlanApproval` permanece `false`. O dry-run exige que o
plano referencie exatamente o ID, a versão e o hash desse pacote em estado
`approved`; marcar apenas `copyStatus` no plano não é suficiente.

### Decisões internas de prontidão
As rotas públicas de geração foram removidas. O fluxo autenticado de aprovação
gera uma decisão operacional
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

`GET /v1/operator/tenants/:tenantId/plans/:executionPlanId/readiness` retorna a
última decisão persistida somente depois de autenticar, validar membership e comprovar que o plano
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
real e adapter ainda impedem execução. Por isso `executionRecordCreated`,
`externalAttemptStarted`, publicação, ativação, entrega e todos os efeitos
externos permanecem `false`.

### Kill Switch por tenant e campanha
`POST /v1/tenants/:tenantId/kill-switch` recebe `status` (`engaged` ou
`released`), `changedBy` e `reason`. O switch do tenant prevalece sobre todas as
campanhas. `POST /v1/campaigns/:campaignId/kill-switch` recebe os mesmos campos
e `tenantId`, restringindo somente a campanha validada dentro daquele tenant.

Cada mudança cria uma versão imutável e um `AuditEvent` na mesma transação.
Repetir concorrentemente o mesmo estado recupera a versão atual sem duplicar
histórico ou auditoria. Acionar o switch nunca apaga planos, manifestos,
autorizações ou evidências anteriores.

`GET /v1/campaigns/:campaignId/kill-switch/effective?tenantId=...` aplica as
regras de precedência. Estado ausente em qualquer escopo é
`blocked_missing_state`; qualquer switch acionado é `blocked_engaged`; somente
dois estados conhecidos e liberados produzem `released` para este controle.
Mesmo nesse último caso, `externalWritesAllowed` continua `false`, pois os demais
gates permanecem independentes.

### Protocolo de validação controlada da escrita Meta
`POST /v1/execution-manifests/:executionManifestId/meta-write-validation-protocols`
recebe `tenantId` e `preparedBy`. Somente o manifesto mais recente pode gerar o
protocolo imutável do primeiro teste externo. Requisições semanticamente iguais
recuperam o mesmo protocolo e não duplicam auditoria.

O protocolo fixa o número e os fingerprints das operações, exige `PAUSED` e
proíbe ativação, entrega, aumento de orçamento, tentativa concorrente e retry
automático. Ele também exige evidências do app e versão Graph, identidade OAuth,
conta vinculada, `ads_management`, requisições, respostas sanitizadas, IDs
externos, estado pausado observado, reconciliação e entrega zero.

`GET /v1/execution-manifests/:executionManifestId/meta-write-validation-protocols/latest?tenantId=...`
retorna o protocolo somente dentro do tenant. Sua existência passa a aparecer
como referência no preflight, mas o check `real_meta_write_validation` permanece
`blocked`: preparar o teste não significa executá-lo nem aprová-lo.

### Acesso do operador e seleção de clientes
`GET /v1/operator/tenants` exige `Authorization: Bearer <token>` e retorna
somente tenants ativos vinculados ao sujeito autenticado por uma membership
ativa. Perfis suspensos, memberships revogadas e vínculos de outro sujeito não
aparecem na resposta.

O primeiro adapter é um bootstrap sem dependência cloud. Ele aceita o fluxo
manual legado com `OPERATOR_BOOTSTRAP_TOKEN_SHA256` ou, na hospedagem Render,
um `OPERATOR_BOOTSTRAP_TOKEN` gerado pela própria plataforma e compartilhado
com o painel. Nesse segundo fluxo, o backend deriva o SHA-256 somente em memória.
A comparação é feita em tempo constante e configuração ausente ou inválida
responde fail-closed. O token em texto puro nunca entra no Git, PostgreSQL,
resposta ou auditoria.

As permissões são derivadas exclusivamente do papel persistido (`owner`,
`operator` ou `viewer`). Nenhum papel autoriza publicação ou escrita externa
por si só. Cada tenant retornado gera evidência de acesso de leitura em
`AuditEvent`; falha ao auditar impede a resposta.

`GET /v1/operator/tenants/:tenantId/plans` repete a autenticação, confirma a
membership ativa antes de consultar o repositório e retorna somente o plano mais
recente de cada campanha daquele tenant. Tentativas de descoberta entre tenants
são recusadas antes da consulta de planos e toda listagem autorizada é auditada.

A Central Operacional consome os dois endpoints exclusivamente no servidor com
`CONTEXT_ADS_OPERATOR_TOKEN`. O token não usa prefixo `NEXT_PUBLIC_`, não integra
o HTML e não é enviado ao navegador. Cliente e plano passam a ser selecionados
por nome/estado, sem digitação manual de UUID. Respostas fora do tenant ou que
aleguem publicação/escrita são rejeitadas pela interface em modo fail-closed.
`GET /v1/operator/tenants/:tenantId/plans/:executionPlanId/readiness` protege
também a decisão final: autentica novamente, confirma membership, comprova que o
plano pertence ao tenant e audita a leitura antes de devolver a evidência.

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
- Kill Switch ausente ou acionado bloqueia; liberá-lo não substitui autorização, validação Meta ou adapter.
- Protocolo de validação é somente instrução/evidência esperada; não é comando de execução nem prova de escrita real.
- Identidade autenticada não concede acesso global; toda seleção deriva de membership ativa e tenant ativo.
- Respostas Graph são limitadas a 256 KiB, redirects são recusados e erros externos são normalizados.

## Próxima entrega
Usar o protocolo já preparado para validar o ambiente Meta real e, somente
depois, implementar o menor adapter capaz de executar a criação controlada com
todos os objetos em `PAUSED`. Até essas evidências existirem, a escrita Meta
continua desligada e o preflight permanece bloqueado. Em paralelo,
criar/configurar o app Meta, concluir um OAuth real e acionar o smoke test
automatizado continua sendo a validação externa necessária para o vertical atual.
