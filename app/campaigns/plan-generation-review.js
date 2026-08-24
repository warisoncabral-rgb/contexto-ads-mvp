'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { generateExecutionPlan } from '../actions'

const categoryLabels = {
  objective: 'Objetivo', budget: 'Orçamento', schedule: 'Duração',
  audience: 'Público', destination: 'Destino', creative_safety: 'Segurança criativa',
  execution_target: 'Ambiente de execução',
}
const severityLabels = { high: 'Alto', medium: 'Médio', low: 'Baixo' }

function money(currency, minor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(minor / 100)
}

function GenerateButton() {
  const { pending } = useFormStatus()
  return <button type="submit" disabled={pending}>{pending ? 'Gerando plano verificável…' : 'Gerar plano lógico'}</button>
}

export default function PlanGenerationReview({ context, canGenerate }) {
  const [state, action] = useActionState(generateExecutionPlan, { error: '', plan: null })
  const budget = context.facts.budget.value
  const durationDays = context.facts.durationDays.value
  const maximum = budget.mode === 'daily' ? budget.amountMinor * durationDays : budget.amountMinor
  const plan = state.plan

  return (
    <section className="plan-review">
      <div className="plan-review-heading">
        <div><span className="eyebrow">Revisão antes da geração</span><h2>Confira o compromisso planejado</h2></div>
        <span className="status-pill status-ready_for_executor_validation">Contexto completo</span>
      </div>
      <div className="review-facts">
        <article><span>Objetivo</span><strong>{context.facts.objective.value}</strong></article>
        <article><span>Destino</span><strong>{context.facts.destination.value}</strong></article>
        <article><span>Local</span><strong>{context.facts.geography.value}</strong></article>
        <article><span>Teto calculado</span><strong>{money(budget.currency, maximum)}</strong></article>
      </div>
      <div className="review-copy"><strong>Oferta</strong><p>{context.facts.offer.value}</p><strong>Público informado</strong><p>{context.facts.audience.value}</p></div>
      <div className="review-warning"><strong>O que este botão faz:</strong> cria um plano interno e rastreável em nível A0. Não pede aprovação, não publica e não inicia cobrança.</div>
      {state.error && <div className="form-error" role="alert">{state.error}</div>}
      {!plan && canGenerate && (
        <form action={action} className="generate-form">
          <input type="hidden" name="tenantId" value={context.tenantId} />
          <input type="hidden" name="campaignId" value={context.campaignId} />
          <input type="hidden" name="contextVersion" value={context.version} />
          <GenerateButton />
        </form>
      )}
      {!canGenerate && <div className="readonly-note">Seu papel permite revisar, mas não gerar o plano.</div>}

      {plan && (
        <div className="generated-plan" aria-live="polite">
          <div className="generated-plan-hero"><div><span className="eyebrow">Plano gerado e auditado</span><h3>{money(plan.financials.currency, plan.financials.maximumPlannedSpendMinor)} de teto máximo</h3><p>{plan.financials.calculation}</p></div><strong>A0 · aprovação obrigatória</strong></div>
          <div className="plan-boundaries"><span>Publicação: não</span><span>Ativação: não</span><span>Escrita externa: bloqueada</span><span>Objetos: pausados</span></div>
          <div className="plan-result-grid">
            <div><span className="eyebrow">Decisões e justificativas</span>{plan.decisions.map((decision) => <article key={decision.decisionId}><strong>{categoryLabels[decision.category]}</strong><p>{decision.rationale}</p><small>Regra: {decision.ruleId}</small></article>)}</div>
            <div><span className="eyebrow">Riscos que bloqueiam execução</span>{plan.risks.map((risk) => <article key={risk.code}><strong>{severityLabels[risk.severity]} · {risk.meaning}</strong><p>{risk.mitigation}</p></article>)}</div>
          </div>
          <a className="open-operation-link" href={`/?tenantId=${plan.tenantId}&executionPlanId=${plan.executionPlanId}`}>Abrir este plano na Central Operacional</a>
        </div>
      )}
    </section>
  )
}
