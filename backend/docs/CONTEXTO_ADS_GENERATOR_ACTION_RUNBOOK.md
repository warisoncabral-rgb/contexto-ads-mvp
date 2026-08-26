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
Retorna estado sanitizado e próximo passo.

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
11. encerrar a Action V1 nesse ponto; execução continua em gate separado.

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

## Teste de aceite hospedado sem escrita

1. Criar campanha completa no Contexto Ads.
2. Gerar novo `Campaign Package V1`.
3. `submitCampaignPackage` e repetir para confirmar idempotência.
4. `getCampaignPackageStatus`.
5. Confirmar Campaign Context, Creative Package e Execution Plan.
6. Confirmar binding Meta somente se o ativo já estiver descoberto para o tenant.
7. Revisar e `submitReviewedCreativePackage`.
8. Consultar e aprovar versão criativa exata.
9. Solicitar e decidir aprovação do plano.
10. Confirmar `publication_authorized=false`, `approvalIsExecutionAuthorization=false` e ausência de escrita Meta.
11. Confirmar que nenhum objeto novo foi criado na Meta.

## Gate seguinte

Após a prova hospedada e a Action funcionando em conversa real do Contexto Ads, o trecho de execução deverá ser promovido por contrato separado, mantendo manifesto, autorização curta, preflight, Kill Switch, criação apenas em `PAUSED` e reconciliação.

**Regra congelada desta fase:** aprovação do plano conclui a responsabilidade da Action V1 sem escrita. Qualquer operação externa pertence ao gate de execução e não pode ser adicionada silenciosamente ao mesmo contrato.
