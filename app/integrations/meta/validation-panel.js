'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { runMetaReadOnlyValidation } from '../../actions.js'

const labels = {
  identity: 'Identidade Meta',
  asset_discovery: 'Contas e ativos',
  capability_validation: 'Permissões de leitura',
  ad_account_read: 'Leitura da conta de anúncios',
}

export default function MetaValidationPanel({ tenantId, connectionId }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(runMetaReadOnlyValidation, {
    error: '',
    report: null,
  })
  const report = state.report
  useEffect(() => {
    if (report?.passed) router.refresh()
  }, [report?.passed, router])

  return <section className="panel meta-validation-card">
    <span className="eyebrow">Validação real somente leitura</span>
    <h2>{report ? (report.passed ? 'Conexão comprovada.' : 'Validação concluída com pendências.') : 'Comprovar a conexão Meta'}</h2>
    <p>Esta operação consulta identidade, contas, ativos e permissões. Não cria campanha, não publica anúncio e não movimenta orçamento.</p>
    {(!report || !report.passed) && <form action={action}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="connectionId" value={connectionId} />
      <button className="primary-button" disabled={pending}>
        {pending ? 'Validando com a Meta…' : report ? 'Tentar novamente' : 'Executar validação somente leitura'}
      </button>
    </form>}
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    {report && <div className="meta-validation-result" aria-live="polite">
      <strong className={report.passed ? 'validation-passed' : 'validation-blocked'}>
        {report.passed ? 'Teste aprovado' : 'Ação adicional necessária'}
      </strong>
      <div className="meta-validation-steps">{report.steps.map((step) =>
        <article key={step.key}>
          <span>{step.status === 'passed' ? 'Passou' : 'Bloqueado'}</span>
          <strong>{labels[step.key]}</strong>
          <p>{step.meaning}</p>
        </article>)}</div>
      {report.blockers.length > 0 && <p className="validation-blockers">
        O sistema interrompeu com segurança: {report.blockers.join(', ')}.
      </p>}
      <small>Nenhuma escrita externa foi autorizada ou executada.</small>
    </div>}
  </section>
}
