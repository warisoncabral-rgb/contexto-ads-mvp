# Runbook — Action Contexto Ads → Gerador V1

## Objetivo

Configurar o GPT Contexto Ads para usar a ponte V1 já implementada no backend do Gerador sem dar ao GPT acesso direto à Marketing API da Meta.

## Contrato oficial

Arquivo: `backend/docs/contexto-ads-generator-action.openapi.yaml`

Servidor hospedado esperado:

`https://contexto-ads-validation-api.onrender.com/v1`

## Autenticação

A Action usa autenticação Bearer no backend do Ecossistema Ads. O token operacional deve ser configurado como segredo da Action e nunca deve aparecer no `Campaign Package V1`, em mensagens do GPT, logs conversacionais ou respostas ao usuário.

O backend continua validando a associação do operador ao tenant antes de aceitar handoff, consulta ou decisão de aprovação.

## Operações expostas ao Contexto Ads

### `submitCampaignPackage`
Envia uma estratégia concluída como `Campaign Package V1`.

Permitido: validar, persistir/versionar internamente, criar/reusar Campaign Context, Execution Plan e Creative Package inicial, e vincular connection/ad account somente quando o ativo já tiver sido descoberto e validado pelo Gerador.

Proibido nessa operação: criar objetos Meta, ativar campanha, autorizar gasto, liberar veiculação, substituir aprovação humana ou executar manifesto.

### `getCampaignPackageStatus`
Retorna estado sanitizado e próximo passo. Quando existir uma aprovação vigente ligada ao ID/hash exatos do plano atual, o status também devolve `plan_approval`.

Estados de próximo passo congelados:

- `REVIEW_AND_APPROVE_CREATIVE_PACKAGE`;
- `RESOLVE_META_TARGET`;
- `REQUEST_EXECUTION_PLAN_APPROVAL`;
- `DECIDE_EXECUTION_PLAN_APPROVAL`;
- `EXECUTION_GATE_SEPARATE`.

`EXECUTION_GATE_SEPARATE` significa que o plano já foi aprovado e a responsabilidade da Action V1 terminou. Não significa autorização de execução.

### `submitReviewedCreativePackage`
Envia uma nova versão do Creative Package após revisão humana dos textos, mídia e checklist. Não aprova automaticamente.

### `getLatestCreativePackage`
Consulta a versão criativa atual e seu hash exato.

### `approveCreativePackage`
Registra aprovação humana da versão criativa exata pelo `contentHash`. Não aprova plano nem execução.

### `requestExecutionPlanApproval`
Abre a aprovação formal do plano atual, ligada ao ID/hash e escopo financeiro. Não executa o plano.

### `getExecutionPlanApproval`
Consulta o estado da aprovação do plano.

### `decideExecutionPlanApproval`
Registra decisão humana explícita `approve`, `reject` ou `revoke`. Plano aprovado não equivale a autorização curta de execução.

## Regra de uso pelo GPT

O Contexto Ads só chama `submitCampaignPackage` quando estratégia e handoff estiverem concluídos, todos os campos obrigatórios existirem, as mídias tiverem referência real/SHA-256/MIME/dimensões, cada anúncio estiver ligado à mídia correta e a revisão estratégica anterior ao handoff tiver terminado.

O handoff nunca deve ser descrito como publicação ou ativação.

## Regra de aprovação humana

O Contexto Ads pode consultar e explicar estados livremente, mas não pode transformar linguagem ambígua em aprovação.

Para `submitReviewedCreativePackage`, a revisão precisa ter ocorrido de fato. Para `approveCreativePackage` ou `decideExecutionPlanApproval` com `approve`, deve existir manifestação explícita e específica do usuário sobre a versão/hash apresentados.

Qualquer alteração relevante invalida a decisão anterior e exige nova versão e nova aprovação.

Sequência recomendada:

1. `getCampaignPackageStatus`;
2. apresentar textos, mídia e checklist;
3. após revisão, `submitReviewedCreativePackage`;
4. `getLatestCreativePackage`;
5. apresentar versão/hash;
6. após aprovação explícita, `approveCreativePackage`;
7. consultar o plano corrente;
8. `requestExecutionPlanApproval`;
9. apresentar hash, teto financeiro e escopo;
10. após aprovação explícita, `decideExecutionPlanApproval` com `approve`;
11. consultar novamente `getCampaignPackageStatus` e exigir `EXECUTION_GATE_SEPARATE`;
12. encerrar a Action V1 nesse ponto; execução continua em gate separado.

## Limite de segurança congelado da Action V1

A Action V1 deliberadamente NÃO expõe:

- preparação de manifesto;
- criação de autorização curta de execução;
- decisão da autorização curta;
- preflight de execução;
- alteração do Kill Switch;
- protocolo de escrita Meta;
- `execute-paused`;
- qualquer chamada direta à Marketing API.

Essas capacidades continuam no Gerador, mas ficam fora do contrato conversacional enquanto não houver prova hospedada sem escrita e configuração real da Action no GPT.

## Evidência E2E interna atual

O workflow `Campaign Package E2E validation`, em PostgreSQL 18 e API Nest reais, já comprovou:

1. handoff autenticado;
2. Campaign Context persistido;
3. Execution Plan criado;
4. Creative Package inicial em `needs_review`;
5. Creative Package revisado submetido;
6. criativo aprovado pelo hash exato;
7. aprovação do plano solicitada;
8. plano aprovado;
9. `approvalIsExecutionAuthorization=false`;
10. zero escrita Meta durante todo o fluxo.

O smoke de aprovação também consulta novamente o status do pacote após aprovar o plano. O aceite final exige `plan_approval.status=approved`, `next_action=EXECUTION_GATE_SEPARATE`, `plan_approval_is_execution_authorization=false` e zero efeitos externos.

## Prova hospedada automatizada

Workflow preparado: `.github/workflows/campaign-package-hosted-smoke.yml`.

Nome no GitHub Actions: `Campaign Package Hosted Candidate validation`.

Ele é manual (`workflow_dispatch`) e recebe:

- `base_url`: URL do backend candidato incluindo `/v1`;
- `tenant_id`: tenant usado para a prova.

Antes de executá-lo, deve existir o segredo de repositório:

`CONTEXT_ADS_HOSTED_OPERATOR_TOKEN`

Esse segredo deve conter o mesmo token operacional aceito pelo backend candidato. O workflow não imprime o token.

Cada execução cria um `package_id` novo, remove IDs específicos de ad account/Página/Instagram/WhatsApp e executa somente:

1. validação;
2. preparação;
3. handoff interno autenticado;
4. consulta de status;
5. revisão criativa;
6. aprovação do criativo;
7. solicitação de aprovação do plano;
8. aprovação do plano;
9. confirmação do gate separado de execução.

Manifesto, autorização curta, preflight e `execute-paused` não são chamados pelo workflow hospedado.

## Teste de aceite hospedado sem escrita

1. Disponibilizar o candidato no backend hospedado.
2. Configurar o segredo `CONTEXT_ADS_HOSTED_OPERATOR_TOKEN` no GitHub.
3. Disparar `Campaign Package Hosted Candidate validation` apontando para a URL candidata.
4. Exigir conclusão `success`.
5. Confirmar `publication_authorized=false`, `approvalIsExecutionAuthorization=false`, `plan_approval_is_execution_authorization=false` e ausência de escrita Meta.
6. Confirmar que nenhum objeto novo foi criado na Meta durante a prova.
7. Somente depois importar o OpenAPI no GPT Contexto Ads e repetir o fluxo a partir de uma conversa real.

## Gate seguinte

Após a prova hospedada e a Action funcionando em conversa real do Contexto Ads, o trecho de execução deverá ser promovido por contrato separado, mantendo manifesto, autorização curta, preflight, Kill Switch, criação apenas em `PAUSED` e reconciliação.

**Regra congelada desta fase:** aprovação do plano conclui a responsabilidade da Action V1 sem escrita. Qualquer operação externa pertence ao gate de execução e não pode ser adicionada silenciosamente ao mesmo contrato.
