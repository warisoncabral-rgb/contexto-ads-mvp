'use client'

import { useActionState } from 'react'
import { runMetaReadOnlySmoke } from './actions'

export default function MetaSmokeForm({ tenantId }) {
  const [state, action, pending] = useActionState(runMetaReadOnlySmoke, {})
  return <section className="preparation-form">
    <h2>Validar conexão real</h2>
    <p>Depois de concluir o callback OAuth, informe o connectionId retornado para executar identidade → descoberta → capacidades → leitura de conta.</p>
    <form action={action}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <label>Connection ID<input name="connectionId" required placeholder="UUID retornado pelo callback" /></label>
      <button type="submit" disabled={pending}>{pending ? 'Validando…' : 'Executar smoke somente leitura'}</button>
    </form>
    {state?.error && <p role="alert">{state.error}</p>}
    {state?.report && <div role="status"><strong>{state.report.passed ? 'Smoke aprovado' : 'Smoke bloqueado'}</strong><p>{state.report.steps.filter((step) => step.status === 'passed').length}/4 etapas aprovadas · {state.report.blockers.length} bloqueio(s).</p><ul>{state.report.steps.map((step) => <li key={step.key}>{step.key}: {step.status} — {step.meaning}</li>)}</ul></div>}
  </section>
}
