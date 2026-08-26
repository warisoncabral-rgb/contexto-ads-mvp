# Runbook — Action Contexto Ads → Gerador V1

## Objetivo

Configurar o GPT Contexto Ads para usar a ponte V1 já implementada no backend do Gerador sem dar ao GPT acesso direto à Marketing API da Meta.

## Contrato oficial

Arquivo: `backend/docs/contexto-ads-generator-action.openapi.yaml`

Servidor hospedado esperado:

`https://contexto-ads-validation-api.onrender.com/v1`

## Autenticação

A Action usa autenticação Bearer no backend do Ecossistema Ads. O token operacional deve ser configurado como segredo da Action e nunca deve aparecer no `Campaign Package V1`, em mensagens do GPT, logs conversacionais ou respostas ao usuário.

O backend continua validando a associação do operador ao tenant antes de aceitar handoff ou consulta de status.

## Operações expostas ao Contexto Ads

### `submitCampaignPackage`

Envia uma estratégia concluída como `Campaign Package V1`.

Efeitos permitidos:

- validar o pacote;
- persistir/versionar o handoff internamente;
- criar/reusar o Campaign Context interno;
- criar/reusar o Execution Plan;
- criar/reusar o Creative Package;
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

A Action V1 não expõe endpoint de execução Meta. Isso é intencional. A integração conversacional é validada primeiro em modo sem escrita externa; a execução real continua protegida pela trilha já existente de aprovação, preflight, autorização curta, Kill Switch e criação em `PAUSED`.

Somente após a prova ponta a ponta sem escrita e o congelamento do contrato deve-se avaliar expor operações adicionais ao GPT.

## Teste de aceite sem escrita

1. Criar uma campanha completa no Contexto Ads.
2. Gerar um `Campaign Package V1` novo.
3. Chamar `submitCampaignPackage` uma vez.
4. Reenviar o mesmo pacote e confirmar idempotência.
5. Chamar `getCampaignPackageStatus`.
6. Confirmar que Campaign Context, Creative Package e Execution Plan existem internamente.
7. Confirmar que o alvo Meta só foi vinculado se a conta fornecida já estava descoberta para o tenant.
8. Confirmar `publication_authorized=false` e ausência de escrita Meta.
9. Confirmar que nenhuma campanha, conjunto, criativo ou anúncio novo foi criado na Meta durante esse teste.

## Gate seguinte

Depois do teste acima passar no ambiente hospedado, configurar a Action no GPT Contexto Ads e executar o mesmo fluxo a partir de uma conversa real. A prova real de criação Meta permanece um gate posterior, separado e explicitamente autorizado, sempre com objetos em `PAUSED` no V1.
