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

Efeitos permitidos:

- validar o pacote;
- persistir/versionar o handoff internamente;
- criar/reusar o Campaign Context interno;
- criar/reusar o Execution Plan;
- criar/reusar o Creative Package inicial;
- vincular connection/ad account somente quando o ativo informado já tiver sido descoberto e validado pelo Gerador.

Efeitos proibidos nessa operação:

- criar objetos na Meta;
- ativar campanha;
- autorizar gasto;
- liberar veiculação;
- substituir aprovação humana do plano;
- executar manifesto.

### `getCampaignPackageStatus`

Retorna estado sanitizado para o Contexto Ads explicar ao usuário o estágio atual e o próximo passo.

### `submitReviewedCreativePackage`

Envia uma nova versão do Creative Package após a revisão humana dos textos, mídia e checklist. A chamada usa o `executionPlanId` corrente e não aprova o criativo automaticamente.

### `getLatestCreativePackage`

Consulta a versão criativa atual e seu hash exato. É somente leitura e serve para o Contexto Ads apresentar ao usuário aquilo que efetivamente está prestes a ser aprovado.

### `approveCreativePackage`

Registra a aprovação humana da versão criativa exata pelo `contentHash`. A chamada só deve ocorrer depois de uma decisão explícita do usuário. Aprovar o criativo não aprova o plano e não autoriza execução.

### `requestExecutionPlanApproval`

Abre a aprovação formal do plano atual, vinculada ao ID/hash do plano e ao escopo financeiro calculado pelo Gerador. Abrir a solicitação não executa o plano.

### `getExecutionPlanApproval`

Consulta o estado da aprovação do plano. É somente leitura.

### `decideExecutionPlanApproval`

Registra uma decisão humana explícita `approve`, `reject` ou `revoke`. O Contexto Ads não deve inferir nem antecipar essa decisão. Mesmo quando o plano é aprovado, isso não equivale à autorização curta de execução e não permite escrita Meta por si só.

## Regra de uso pelo GPT

O Contexto Ads só deve chamar `submitCampaignPackage` quando:

1. a estratégia estiver concluída;
2. `strategy_status = COMPLETE`;
3. `handoff_status = READY_FOR_GENERATOR`;
4. os campos obrigatórios do contrato estiverem presentes;
5. as mídias possuírem referência real, SHA-256, MIME e dimensões;
6. cada anúncio estiver ligado explicitamente à sua mídia;
7. o usuário tiver concluído a revisão estratégica que precede o handoff.

O handoff não deve ser descrito ao usuário como publicação ou ativação.

## Regra de aprovação humana

O Contexto Ads pode consultar e explicar estados livremente, mas não pode transformar linguagem ambígua em aprovação.

Para `submitReviewedCreativePackage`, a revisão deve ter ocorrido de fato. Para `approveCreativePackage` ou `decideExecutionPlanApproval` com decisão `approve`, deve existir manifestação explícita e específica do usuário sobre o objeto apresentado.

A aprovação fica ligada à versão/hash exatos; qualquer alteração relevante exige nova versão e nova decisão.

A sequência recomendada é:

1. `getCampaignPackageStatus`;
2. apresentar textos, mídia e checklist ao usuário;
3. após a revisão, `submitReviewedCreativePackage` com o checklist real;
4. `getLatestCreativePackage`;
5. apresentar versão/hash do criativo;
6. após aprovação explícita, `approveCreativePackage`;
7. consultar novamente o status/plano;
8. `requestExecutionPlanApproval`;
9. apresentar hash, teto financeiro e escopo ao usuário;
10. após aprovação explícita, `decideExecutionPlanApproval` com `approve`;
11. encerrar a Action V1 nesse ponto e informar que execução continua em gate separado.

## Comportamento de retorno

Se o backend devolver pendências, o Contexto Ads deve apresentar somente as pendências acionáveis e solicitar os dados faltantes. Não deve inventar valores para completar o pacote.

Se o handoff for aceito, o GPT deve usar o retorno estruturado e, quando necessário, `getCampaignPackageStatus` para informar:

- versão aceita;
- estado do Creative Package;
- ID/hash do Execution Plan;
- estado do alvo Meta;
- teto financeiro calculado quando disponível no status;
- próximo passo.

## Limite de segurança da Action V1

A Action V1 deliberadamente NÃO expõe:

- preparação de manifesto de execução;
- criação de autorização curta de execução;
- decisão da autorização curta;
- preflight de execução;
- alteração do Kill Switch;
- preparação de protocolo de escrita Meta;
- `execute-paused`;
- qualquer chamada direta à Marketing API.

Esses endpoints continuam existindo no Gerador, mas permanecem fora do contrato conversacional até a prova hospedada sem escrita ser concluída. Essa separação impede que a simples instalação da Action transforme o Contexto Ads em executor externo.

## Evidência E2E interna atual

O workflow `Campaign Package E2E validation` valida em PostgreSQL real e API Nest real:

1. handoff autenticado;
2. persistência do Campaign Context;
3. criação do Execution Plan;
4. criação do Creative Package inicial em `needs_review`;
5. submissão de Creative Package revisado;
6. aprovação do criativo pelo hash exato;
7. solicitação de aprovação do plano;
8. aprovação do plano;
9. confirmação de `approvalIsExecutionAuthorization=false`;
10. confirmação de zero escrita Meta durante todo o fluxo.

## Teste de aceite hospedado sem escrita

1. Criar uma campanha completa no Contexto Ads.
2. Gerar um `Campaign Package V1` novo.
3. Chamar `submitCampaignPackage` uma vez.
4. Reenviar o mesmo pacote e confirmar idempotência.
5. Chamar `getCampaignPackageStatus`.
6. Confirmar que Campaign Context, Creative Package e Execution Plan existem internamente.
7. Confirmar que o alvo Meta só foi vinculado se a conta fornecida já estava descoberta para o tenant.
8. Revisar o conteúdo e chamar `submitReviewedCreativePackage`.
9. Consultar e aprovar a versão criativa exata.
10. Solicitar e decidir a aprovação do plano.
11. Confirmar `publication_authorized=false`, `approvalIsExecutionAuthorization=false` e ausência de escrita Meta.
12. Confirmar que nenhuma campanha, conjunto, criativo ou anúncio novo foi criado na Meta durante esse teste.

## Gate seguinte

Depois do teste acima passar no ambiente hospedado e a Action funcionar numa conversa real do Contexto Ads, poderá ser criado um contrato separado para o trecho de execução. Esse futuro contrato deverá continuar exigindo manifesto, aprovação curta, preflight, Kill Switch, criação apenas em `PAUSED` e reconciliação antes de qualquer promoção a V1 concluída.
