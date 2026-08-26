'use client'

import { useActionState } from 'react'
import { changeExecutorControl, requestMetaAdsManagement,
  validateMetaExecutionCapabilities } from './actions'

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

function CapabilityValidationForm({ plan, approvalId }) {
  const [state, formAction, pending] = useActionState(
    validateMetaExecutionCapabilities,
    { error: '' },
  )
  return <form action={formAction} className="executor-action-form">
    {['tenantId', 'campaignId', 'executionPlanId', 'connectionId', 'planHash']
      .map((key) => <input key={key} type="hidden" name={key} value={plan[key]} />)}
    <input type="hidden" name="approvalId" value={approvalId} />
    <button disabled={pending}>
      {pending ? 'Conferindo sem escrever…' : 'Validar capacidades sem alterar permissões'}
    </button>
    {state.error && <small className="form-error" role="alert">{state.error}</small>}
  </form>
}

function PermissionAuthorizationForm({ plan }) {
  return <form action={requestMetaAdsManagement} className="executor-action-form">
    <input type="hidden" name="tenantId" value={plan.tenantId} />
    <input type="hidden" name="connectionId" value={plan.connectionId} />
    <p className="readonly-note">A Meta solicitará somente a permissão adicional autorizada. Isso não publica, ativa nem inicia gasto.</p>
    <button>Autorizar ads_management na Meta</button>
  </form>
}

export default function ExecutorPreflightPanel({ plan, role, approvalResult, result, decision }) {
  const manifest = result.kind === 'ready' ? result.manifest : null
  const authorization = result.kind === 'ready' ? result.authorization : null
  const approvedPlan = approvalResult.kind === 'ready' && approvalResult.approval.status === 'approved'
  const approvalId = approvalResult.kind === 'ready' ? approvalResult.approval.approvalId : ''
  const canOperate = ['owner', 'operator'].includes(role), canDecide = role === 'owner'
  const readinessReady = decision.status === 'ready_for_executor_validation'
  const canPrepare = canOperate && readinessReady
  const canValidateCapabilities = canOperate && approvedPlan && !readinessReady
    && Boolean(plan.connectionId)
    && decision.blockers.some((blocker) => blocker.code === 'write_capabilities')
  const needsAdsManagement = canValidateCapabilities && decision.blockers.some((blocker) =>
    blocker.code === 'write_capabilities' && blocker.nextAction?.includes('ads_management'))
  const labels = { pending: 'Aguardando proprietário', approved: 'Aprovada por 15 minutos', rejected: 'Rejeitada', revoked: 'Revogada', expired: 'Expirada', invalidated: 'Invalidada' }
  const protocolReady = result.protocol?.status === 'prepared_external_validation_required'
  const switchesReleased = result.killSwitch?.tenant.status === 'released'
    && result.killSwitch?.campaign.status === 'released'
  return <section className="panel executor-panel">
    <div className="section-heading"><div><span className="eyebrow">Validação do executor</span><h3>Preflight antes de qualquer tentativa</h3></div><span className="status-pill status-blocked">Gate fechado</span></div>
    <p className="executor-boundary">Esta central prepara e diagnostica. Mesmo com autorização humana, nenhuma publicação, ativação, entrega ou escrita externa é iniciada.</p>
    {!manifest && <div className="executor-empty"><p>O manifesto transforma o plano aprovado em operações ordenadas, pausadas e idempotentes.</p>{canPrepare && approvedPlan
      ? <ControlForm plan={plan} approvalId={approvalId} action="prepare_manifest" label="Preparar manifesto do plano" />
      : canValidateCapabilities
        ? <><p className="readonly-note">A aprovação está concluída. Falta comprovar as permissões e os ativos exigidos.</p>
          {needsAdsManagement
            ? <><PermissionAuthorizationForm plan={plan} />
              <p className="readonly-note">Se a autorização já foi concluída na Meta, atualize agora as evidências antes de solicitar novamente.</p>
              <CapabilityValidationForm plan={plan} approvalId={approvalId} /></>
            : <CapabilityValidationForm plan={plan} approvalId={approvalId} />}</>
        : <p className="readonly-note">A aprovação válida e todos os controles de prontidão são necessários antes de preparar o manifesto.</p>}</div>}
    {manifest && <><div className="executor-facts"><div><span>Manifesto</span><strong>{manifest.manifestHash.slice(0, 12)}…</strong></div><div><span>Operações</span><strong>{manifest.operations.length}</strong></div><div><span>Estado pretendido</span><strong>PAUSED</strong></div><div><span>Executável</span><strong>Não</strong></div></div>
      <div className="operation-list">{manifest.operations.map((operation) => { const observed = result.protocol?.execution?.operations?.find((item) => item.operationKey === operation.operationKey); return <div key={operation.operationKey}><span>{operation.order}</span><strong>{operation.action} · {operation.objectType}</strong><small>{observed ? `${observed.status}${observed.externalObjectId ? ` · Meta ${observed.externalObjectId}` : ''}` : 'Não iniciada · execução bloqueada'}</small></div> })}</div>
      {!authorization && canPrepare && <ControlForm plan={plan} manifest={manifest} approvalId={approvalId} action="request_authorization" label="Solicitar autorização curta" />}
      {authorization && <div className="authorization-box"><div><span>Autorização específica</span><strong>{labels[authorization.status]}</strong><small>Expira em {new Date(authorization.expiresAt).toLocaleString('pt-BR')}</small></div>
        {authorization.status === 'pending' && canDecide && <div className="executor-decisions"><ControlForm plan={plan} manifest={manifest} authorization={authorization} approvalId={approvalId} action="approve" label="Aprovar criação pausada" /><ControlForm plan={plan} manifest={manifest} authorization={authorization} approvalId={approvalId} action="reject" label="Rejeitar"><input name="reason" required minLength="3" placeholder="Motivo objetivo" /></ControlForm></div>}
        {authorization.status === 'approved' && <><div className="safety-controls"><div><span>Kill Switch tenant</span><strong>{result.killSwitch?.tenant.status ?? 'missing'}</strong></div><div><span>Kill Switch campanha</span><strong>{result.killSwitch?.campaign.status ?? 'missing'}</strong></div><div><span>Protocolo real</span><strong>{result.protocol ? 'Preparado' : 'Ausente'}</strong></div></div>
          {canDecide && <><div className="executor-decisions">{['tenant', 'campaign'].map((scope) => { const current = result.killSwitch?.[scope]?.status; const desired = current === 'released' ? 'engaged' : 'released'; return <ControlForm key={scope} plan={plan} manifest={manifest} authorization={authorization} approvalId={approvalId} action="change_switch" label={`${desired === 'released' ? 'Liberar' : 'Acionar'} trava ${scope === 'tenant' ? 'do cliente' : 'da campanha'}`}><input type="hidden" name="scope" value={scope} /><input type="hidden" name="status" value={desired} /><input name="reason" required minLength="3" placeholder="Motivo da mudança" /></ControlForm> })}</div>{!result.protocol && <ControlForm plan={plan} manifest={manifest} authorization={authorization} approvalId={approvalId} action="prepare_protocol" label="Preparar protocolo controlado" />}</>}
          {canPrepare && result.protocol?.status !== 'external_validation_succeeded' && <ControlForm plan={plan} manifest={manifest} authorization={authorization} approvalId={approvalId} action="preflight" label="Executar diagnóstico fail-closed" />}
          {canDecide && protocolReady && switchesReleased && <ControlForm plan={plan} manifest={manifest} authorization={authorization} approvalId={approvalId} action="execute_paused" label="Criar objetos pausados na Meta" />}
          {result.protocol?.status === 'external_validation_succeeded' && <p className="readonly-note">Executor real validado: objetos criados e reconciliados em estado pausado.</p>}
          {result.protocol?.status === 'external_validation_failed' && <p className="form-error">A execução foi interrompida e a trava da campanha foi acionada para reconciliação.</p>}
          {canDecide && <ControlForm plan={plan} manifest={manifest} authorization={authorization} approvalId={approvalId} action="revoke" label="Revogar autorização"><input name="reason" required minLength="3" placeholder="Motivo da revogação" /></ControlForm>}</>}
      </div>}</>}
    {!canOperate && <p className="readonly-note">Seu papel permite acompanhar as evidências, mas não alterar o controle de execução.</p>}
  </section>
}
