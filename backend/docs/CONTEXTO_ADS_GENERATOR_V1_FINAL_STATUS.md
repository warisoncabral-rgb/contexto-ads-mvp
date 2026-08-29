# Contexto Ads → Gerador V1 — Status Final

Data de fechamento: 2026-08-29

## Estado

A integração Contexto Ads → Gerador V1 está concluída no escopo definido para o handoff seguro e estável.

Fluxo validado:

`Contexto Ads → Campaign Package V1 → Action autenticada → Gerador estável → persistência → Campaign Context / Creative Package / Execution Plan → status seguro`

## Ambiente estável

- API: `https://contexto-ads-validation-api.onrender.com/v1`
- Tenant de validação: `22222222-2222-4222-8222-222222222222`
- Meta connection validada: `673dbb65-e187-4d80-8751-772d6e0156b3`
- Action GPT usa autenticação Bearer.

## Prova final do handoff estável

Workflow: `Campaign Package Stable Safe Smoke`

Resultado final:

- submit: HTTP `201`
- status: HTTP `200`
- Package ID: `84e261ba-febf-4f1b-91f5-d2dd77e158c5`
- Execution Plan ID: `95e434c6-60ff-49a2-a76e-426d3e995488`
- Plan hash: `4c43dde0739a02bc951cdbf664f4e8905fb537ce1a2281d5e2c34a3703e34bc5`
- orçamento: R$ 10/dia por 7 dias
- teto planejado: R$ 70
- `target_binding_status=PENDING_RESOLUTION`
- `execution_plan.status=draft`
- `creative.status=needs_review`
- `plan_approval=null`
- `publication_authorized=false`
- `external_writes_allowed=false`
- `external_writes_performed=false`
- `plan_approval_is_execution_authorization=false`

Nenhum endpoint de execução Meta foi chamado pelo smoke. Manifesto, autorização curta de execução, preflight, mutação de Kill Switch e `execute-paused` permaneceram fora do escopo.

## Prova histórica do executor Meta

O executor real já havia sido validado separadamente com criação controlada em `PAUSED`, idempotência, reconciliação e zero entrega observada. Essa prova não é repetida pelo handoff da Action V1.

Não existe nesta prova final uma leitura independente de `spend` via endpoint de Insights; portanto a evidência financeira deve ser descrita como ausência de autorização de gasto no handoff e zero entrega observada na prova do executor, sem afirmar uma leitura independente de gasto igual a zero.

## Segurança

- aprovação de criativo não é aprovação de plano;
- aprovação de plano não é autorização de execução;
- a Action V1 não expõe endpoints de execução Meta;
- o candidato isolado usado durante desenvolvimento foi retirado do fluxo principal;
- os contratos GPT canônicos apontam para a API estável.

## Conclusão

**Integração Contexto Ads → Gerador V1: 100% concluída no escopo do handoff seguro definido para V1.**

Isso não significa que o ecossistema inteiro esteja concluído: Analista Ads e Orquestrador pertencem às próximas etapas.
