'use client'

import { useActionState } from 'react'
import { runMetaReadOnlySmoke } from './actions'
import { deriveMetaSmokeEvidencePacket, formatMetaSmokeEvidencePacket } from '../../lib/meta-smoke-evidence.mjs'

export default function MetaSmokeForm({ tenantId, initialConnectionId = '' }) {
  const [state, action, pending] = useActionState(runMetaReadOnlySmoke, {})
  const packet = state?.report ? deriveMetaSmokeEvidencePacket(state.report) : null
  return <section className="preparation-form">
    <h2>Validar conexão real</h2>
    <p>Depois de concluir o callback OAuth, execute identidade → descoberta → capacidades → leitura de conta.</p>
    <form action={action}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <label>Connection ID<input name="connectionId" required defaultValue={initialConnectionId} placeholder="UUID retornado pelo callback" /></label>
      <button type="submit" disabled={pending}>{pending ? 'Validando…' : 'Executar smoke somente leitura'}</button>
    </form>
    {state?.error && <p role="alert">{state.error}</p>}
    {packet && <div role="status">
      <strong>{packet.passed ? 'Smoke aprovado' : 'Smoke bloqueado'}</strong>
      <p>{packet.entries.filter((step) => step.status === 'passed').length}/4 etapas aprovadas · {packet.blockers.length} bloqueio(s) · {packet.evidenceReferenceCount} referência(s) de evidência.</p>
      <ul>{packet.entries.map((step) => <li key={step.key}><strong>{step.key}: {step.status}</strong> — {step.meaning}<br /><small>{step.evidenceRefs.length ? step.evidenceRefs.join(' · ') : 'Sem referência vinculada'}{step.observedAt ? ` · observado ${step.observedAt}` : ''}</small></li>)}</ul>
      <details><summary>Pacote sanitizado para revisão</summary><pre>{formatMetaSmokeEvidencePacket(packet)}</pre></details>
      <p><small>Este pacote prova somente o resultado do smoke de leitura. Não comprova suficiência para escrita e não abre o gate de execução.</small></p>
    </div>}
  </section>
}
