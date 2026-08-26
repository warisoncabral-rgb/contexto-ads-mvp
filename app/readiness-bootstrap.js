'use client'

import { useActionState } from 'react'
import { recalculateOperationalReadiness } from './actions'

export default function ReadinessBootstrap({ plan }) {
  const [state, action, pending] = useActionState(recalculateOperationalReadiness, { error: '' })
  return <div className="readiness-bootstrap">
    <form action={action}>
      {['tenantId', 'campaignId', 'executionPlanId'].map((key) =>
        <input key={key} type="hidden" name={key} value={plan[key]} />)}
      <button disabled={pending}>
        {pending ? 'Calculando diagnóstico…' : 'Calcular prontidão deste plano'}
      </button>
    </form>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    <small>Somente registra evidências internas. Não aprova, publica ou acessa a Meta.</small>
  </div>
}
