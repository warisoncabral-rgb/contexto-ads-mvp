'use client'

import { useActionState } from 'react'
import { changePlanApproval } from './actions'

function ActionForm({ plan, approval, decision, label, reason = false }) {
  const [state, action, pending] = useActionState(changePlanApproval, { error: '' })
  return <form action={action} className="approval-action-form">
    {['tenantId', 'campaignId', 'executionPlanId', 'planHash', 'currency'].map((key) => <input key={key} type="hidden" name={key} value={plan[key]} />)}
    <input type="hidden" name="maximumPlannedSpendMinor" value={plan.maximumPlannedSpendMinor} />
    <input type="hidden" name="approvalId" value={approval?.approvalId ?? ''} />
    <input type="hidden" name="decision" value={decision} />
    {reason && <input name="reason" minLength="3" maxLength="1000" required placeholder="Motivo objetivo da decisão" />}
    <button disabled={pending} type="submit">{pending ? 'Registrando…' : label}</button>
    {state.error && <small className="form-error" role="alert">{state.error}</small>}
  </form>
}

export default function PlanApprovalPanel({ plan, role, approvalResult }) {
  const approval = approvalResult.kind === 'ready' ? approvalResult.approval : null
  const canRequest = ['owner', 'operator'].includes(role)
  const canDecide = role === 'owner'
  const labels = { pending: 'Aguardando decisão', approved: 'Aprovado', rejected: 'Rejeitado', expired: 'Expirado', revoked: 'Revogado', invalidated: 'Invalidado' }
  return <section className="panel approval-panel">
    <div className="section-heading"><div><span className="eyebrow">Decisão humana protegida</span><h3>Revisão do plano exato</h3></div>{approval && <span className={`status-pill status-${approval.status}`}>{labels[approval.status]}</span>}</div>
    <div className="approval-facts">
      <div><span>Hash do plano</span><strong title={plan.planHash}>{plan.planHash.slice(0, 12)}…{plan.planHash.slice(-8)}</strong></div>
      <div><span>Teto máximo</span><strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: plan.currency }).format(plan.maximumPlannedSpendMinor / 100)}</strong></div>
      <div><span>Versão</span><strong>{plan.planVersion}</strong></div>
      <div><span>Escrita externa</span><strong>Bloqueada</strong></div>
    </div>
    <p className="approval-explanation">A decisão vale somente para este hash e este teto. Qualquer mudança material invalida a aprovação automaticamente. Aprovar não publica nem ativa a campanha.</p>
    {!approval && canRequest && <ActionForm plan={plan} decision="request" label="Solicitar aprovação deste plano" />}
    {!approval && !canRequest && <p className="readonly-note">Seu papel permite revisar, mas não solicitar aprovação.</p>}
    {approval && <div className="approval-evidence"><span>Solicitada por <strong>{approval.requestedBy}</strong></span>{approval.approvedBy && <span>Decidida por <strong>{approval.approvedBy}</strong></span>}<span>Escopo com {approval.scope.length} travas verificáveis</span></div>}
    {approval?.status === 'pending' && canDecide && <div className="approval-actions"><ActionForm plan={plan} approval={approval} decision="approve" label="Aprovar hash e teto" /><ActionForm plan={plan} approval={approval} decision="reject" label="Rejeitar plano" reason /></div>}
    {approval?.status === 'approved' && canDecide && <ActionForm plan={plan} approval={approval} decision="revoke" label="Revogar aprovação" reason />}
  </section>
}
