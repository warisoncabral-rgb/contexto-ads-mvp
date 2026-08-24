'use client'

import { useActionState } from 'react'
import { changeExecutorControl } from './actions'

function ControlForm({ plan, manifest, authorization, approvalId = '', action, label, children }) {
  const [state, formAction, pending] = useActionState(changeExecutorControl, { error: '' })
  return <form action={formAction} className="executor-action-form">
    {['tenantId', 'campaignId', 'executionPlanId', 'planHash'].map((key) => <input key={key} type="hidden" name={key} value={plan[key]} />)}
    <input type="hidden" name="executionManifestId" value={manifest?.executionManifestId ?? ''} />
    <input type="hidden" name="manifestHash" value={manifest?.manifestHash ?? ''} />
    <input type="hidden" name="executionAuthorizationId" value={authorization?.executionAuthorizationId ?? ''} />
    <input type="hidden" name="approvalId" value={approvalId} />
    <input type="hidden" name="executorAction" value={action} />
    {children}<button disabled={pending}>{pending ? 'Validando…' : label}</button>
    {state.error && <small className="form-error" role="alert">{state.error}</small>}
    {state.preflight && <PreflightResult value={state.preflight} />}
  </form>
}

function PreflightResult({ value }) {
  return <div className="preflight-result"><strong>Diagnóstico concluído antes de qualquer tentativa</strong>
    <div className="preflight-checks">{value.checks.map((check) => <div key={check.key} className={`check-${check.status}`}><span>{check.status === 'passed' ? 'Passou' : 'Bloqueado'}</span><p>{check.meaning}</p></div>)}</div>
    <p><strong>Próxima ação:</strong> {value.nextAction}</p></div>
}

export default function ExecutorPreflightPanel({ plan, role, approvalResult, result }) {
  const manifest = result.kind === 'ready' ? result.manifest : null
  const authorization = result.kind === 'ready' ? result.authorization : null
  const approvedPlan = approvalResult.kind === 'ready' && approvalResult.approval.status === 'approved'
  const approvalId = approvalResult.kind === 'ready' ? approvalResult.approval.approvalId : ''
  const canPrepare = ['owner', 'operator'].includes(role), canDecide = role === 'owner'
  const labels = { pending: 'Aguardando proprietário', approved: 'Aprovada por 15 minutos', rejected: 'Rejeitada', revoked: 'Revogada', expired: 'Expirada', invalidated: 'Invalidada' }
  return <section className="panel executor-panel">
    <div className="section-heading"><div><span className="eyebrow">Validação do executor</span><h3>Preflight antes de qualquer tentativa</h3></div><span className="status-pill status-blocked">Gate fechado</span></div>
    <p className="executor-boundary">Esta central prepara e diagnostica. Mesmo com autorização humana, nenhuma publicação, ativação, entrega ou escrita externa é iniciada.</p>
    {!manifest && <div className="executor-empty"><p>O manifesto transforma o plano aprovado em operações ordenadas, pausadas e idempotentes.</p>{canPrepare && approvedPlan
      ? <ControlForm plan={plan} approvalId={approvalId} action="prepare_manifest" label="Preparar manifesto do plano" />
      : <p className="readonly-note">A aprovação válida deste plano é necessária antes de preparar o manifesto.</p>}</div>}
    {manifest && <><div className="executor-facts"><div><span>Manifesto</span><strong>{manifest.manifestHash.slice(0, 12)}…</strong></div><div><span>Operações</span><strong>{manifest.operations.length}</strong></div><div><span>Estado pretendido</span><strong>PAUSED</strong></div><div><span>Executável</span><strong>Não</strong></div></div>
      <div className="operation-list">{manifest.operations.map((operation) => <div key={operation.operationKey}><span>{operation.order}</span><strong>{operation.action} · {operation.objectType}</strong><small>Não iniciada · execução bloqueada</small></div>)}</div>
      {!authorization && canPrepare && <ControlForm plan={plan} manifest={manifest} approvalId={approvalId} action="request_authorization" label="Solicitar autorização curta" />}
      {authorization && <div className="authorization-box"><div><span>Autorização específica</span><strong>{labels[authorization.status]}</strong><small>Expira em {new Date(authorization.expiresAt).toLocaleString('pt-BR')}</small></div>
        {authorization.status === 'pending' && canDecide && <div className="executor-decisions"><ControlForm plan={plan} manifest={manifest} authorization={authorization} approvalId={approvalId} action="approve" label="Aprovar criação pausada" /><ControlForm plan={plan} manifest={manifest} authorization={authorization} approvalId={approvalId} action="reject" label="Rejeitar"><input name="reason" required minLength="3" placeholder="Motivo objetivo" /></ControlForm></div>}
        {authorization.status === 'approved' && <><div className="safety-controls"><div><span>Kill Switch tenant</span><strong>{result.killSwitch?.tenant.status ?? 'missing'}</strong></div><div><span>Kill Switch campanha</span><strong>{result.killSwitch?.campaign.status ?? 'missing'}</strong></div><div><span>Protocolo real</span><strong>{result.protocol ? 'Preparado' : 'Ausente'}</strong></div></div>
          {canDecide && <><div className="executor-decisions">{['tenant', 'campaign'].map((scope) => { const current = result.killSwitch?.[scope]?.status; const desired = current === 'released' ? 'engaged' : 'released'; return <ControlForm key={scope} plan={plan} manifest={manifest} authorization={authorization} approvalId={approvalId} action="change_switch" label={`${desired === 'released' ? 'Liberar' : 'Acionar'} trava ${scope === 'tenant' ? 'do cliente' : 'da campanha'}`}><input type="hidden" name="scope" value={scope} /><input type="hidden" name="status" value={desired} /><input name="reason" required minLength="3" placeholder="Motivo da mudança" /></ControlForm> })}</div>{!result.protocol && <ControlForm plan={plan} manifest={manifest} authorization={authorization} approvalId={approvalId} action="prepare_protocol" label="Preparar protocolo controlado" />}</>}
          {canPrepare && <ControlForm plan={plan} manifest={manifest} authorization={authorization} approvalId={approvalId} action="preflight" label="Executar diagnóstico fail-closed" />}
          {canDecide && <ControlForm plan={plan} manifest={manifest} authorization={authorization} approvalId={approvalId} action="revoke" label="Revogar autorização"><input name="reason" required minLength="3" placeholder="Motivo da revogação" /></ControlForm>}</>}
      </div>}</>}
    {!canPrepare && <p className="readonly-note">Seu papel permite acompanhar as evidências, mas não alterar o controle de execução.</p>}
  </section>
}
