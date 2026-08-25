'use client'

import { useActionState } from 'react'
import { bindSelectedExecutionTarget } from './actions'

export default function MetaExecutionTargetPanel({ plan, role, result }) {
  const [state, action, pending] = useActionState(bindSelectedExecutionTarget, { error: '' })
  const canBind = ['owner', 'operator'].includes(role)
  const alreadyBound = plan.connectionId && plan.adAccountId
  const target = result.kind === 'ready' ? result.target : null
  return <section className="panel target-panel">
    <div className="section-heading"><div><span className="eyebrow">Destino de execução</span>
      <h3>Conta de anúncios vinculada</h3></div>
      <span className={`status-pill status-${alreadyBound ? 'approved' : 'blocked'}`}>
        {alreadyBound ? 'Vinculada' : 'Pendente'}
      </span></div>
    {alreadyBound
      ? <div className="target-summary"><span>Conta selecionada</span><strong>{plan.adAccountId}</strong>
        <small>O vínculo pertence ao hash atual do plano. Nenhuma escrita foi realizada.</small></div>
      : target
        ? <><div className="target-summary"><span>Ativo confirmado na integração Meta</span>
          <strong>{target.displayName || target.adAccountId}</strong><small>{target.adAccountId}</small></div>
          {canBind && <form action={action} className="executor-action-form">
            {['tenantId', 'campaignId', 'executionPlanId'].map((key) =>
              <input key={key} type="hidden" name={key} value={plan[key]} />)}
            <input type="hidden" name="connectionId" value={target.connectionId} />
            <input type="hidden" name="adAccountId" value={target.adAccountId} />
            <button disabled={pending}>{pending ? 'Vinculando com segurança…' : 'Vincular conta selecionada ao plano'}</button>
          </form>}</>
        : <p className="readonly-note">Selecione uma conta na integração Meta antes de vincular o plano.</p>}
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    <p className="creative-boundary">Este vínculo somente prepara o alvo interno. Não cria campanha, não publica e não movimenta orçamento.</p>
  </section>
}
