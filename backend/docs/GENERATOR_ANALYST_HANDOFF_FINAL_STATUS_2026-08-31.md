# GERADOR → ANALISTA ADS — STATUS FINAL

Data: 2026-08-31
Status: **100% concluído no escopo do handoff explícito e seguro pós-MVP**

## 1. Objetivo concluído

O elo Gerador/execução controlada → Analista Ads deixou de depender apenas de descoberta implícita do histórico e passou a possuir um registro explícito, idempotente e persistente de acompanhamento por campanha.

Fluxo entregue:

**campanha confirmada na execução Meta controlada → `external_validation_succeeded` → registro explícito de tracking do Analista → resolução automática do vínculo → coleta/análise periódica pelo Analista.**

A identidade interna `campaign_id` é preservada entre os módulos. O usuário não precisa informar o ID técnico da campanha Meta.

## 2. Implementação

Migration: `023_analyst_tracking_registrations.sql`

Tabela: `analyst_tracking_registrations`

O registro contém:

- tenant;
- campaign_id interno;
- campaign_id externo da Meta;
- execution_plan_id;
- execution_manifest_id;
- meta_write_validation_protocol_id;
- origem da evidência (`execution_operation` ou `reconciled_operation`);
- timestamps de registro/atualização.

O handoff possui três camadas de robustez:

1. **Backfill:** campanhas históricas com protocolo já confirmado em `external_validation_succeeded` são matriculadas no tracking.
2. **Registro automático:** quando um protocolo passa a `external_validation_succeeded`, um trigger best-effort registra a campanha para acompanhamento.
3. **Auto-reparo:** se o registro não existir por qualquer motivo, o resolvedor do Analista consulta apenas histórico de execução confirmado, cria o registro idempotentemente e continua.

Campanhas com execução falha, parcial ou não confirmada não são matriculadas.

## 3. Segurança do handoff

O tracking é estado derivado e nunca pode invalidar ou reverter o estado primário da execução Meta.

O trigger de tracking é best-effort e isola qualquer falha própria. A aplicação também possui caminho de reparo idempotente.

O handoff não introduz:

- publicação;
- ativação;
- pausa automática;
- alteração de orçamento;
- autorização financeira;
- escrita nova na Meta;
- execução automática de recomendação.

## 4. Validação em CI

PR principal: **#117 — explicit Generator to Analyst tracking handoff**

Validações concluídas com sucesso:

- migration 023 em PostgreSQL 18;
- testes unitários;
- build NestJS;
- e2e completo;
- smoke de handoff autenticado existente;
- smoke de aprovação revisada existente.

PR de sincronização para API estável: **#118**

O diff de sincronização ficou restrito a 7 arquivos do tracking/resolvedor, preservando integralmente as mudanças específicas do Contexto Ads → Gerador existentes na branch estável.

## 5. Deploy estável

Branch: `agent/action-custom-header-auth`

Commit estável:

`4dbf62e395c36cfee097119d5ae814d07bcbdf80`

Deploy Render:

`dep-dab05qe7bikc73fkhi90`

Status: **live**

A migration 023 foi aplicada no deploy antes de a nova instância entrar em produção.

## 6. Prova hospedada pós-deploy

Workflow: **Analista Ads MVP Final Smoke**

Run:

`33447437633`

Job:

`99669581548`

Resultado: **success**

Campanha usada:

`b8f16916-cf4c-4e80-894e-dcc56fbd9564`

Resultado do vínculo:

```text
action_status=ANALYZED
meta_campaign_resolution.automatic=true
meta_campaign_resolution.source=reconciled_operation
technical_id_required_from_user=false
operational_state=PAUSED
decision=OBSERVAR
```

A chamada passa primeiro pela tabela explícita de tracking. Caso o backfill não tenha produzido o registro, o mesmo caminho cria/repara o registro a partir do protocolo confirmado antes de retornar a resolução. Portanto, o sucesso hospedado comprova o funcionamento do novo mecanismo explícito de Gerador → Analista.

O restante do smoke também permaneceu verde:

```text
summary=OK
alert=info
recommendation=NO_APPROVAL_REQUIRED
learning=NO_LEARNING
```

`NO_LEARNING` continua sendo o resultado correto enquanto não existirem dois períodos comparáveis suficientes.

## 7. Limites comprovados no smoke

Permaneceram falsos:

- `meta_write_performed=false`
- `external_writes_allowed=false`
- `recommendation_auto_executed=false`
- `financial_action_authorized=false`
- `autonomous_training_performed=false`

## 8. Conclusão

**Integração Gerador → Analista Ads: 100% concluída no escopo do handoff explícito e seguro.**

O Analista Ads MVP continua 100% concluído. Esta etapa é uma evolução pós-MVP do ecossistema e garante que campanhas confirmadas no fluxo do Gerador/execução controlada sejam automaticamente reconhecidas e acompanhadas pelo Analista sem intervenção técnica do usuário.
