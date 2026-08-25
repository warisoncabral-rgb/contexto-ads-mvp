import { loadOperationalReadiness } from '../lib/operational-readiness.mjs'
import { loadOperatorWorkspace } from '../lib/operator-workspace.mjs'
import { loadPlanApproval } from '../lib/plan-approval.mjs'
import { loadLatestCreative } from '../lib/creative-media-center.mjs'
import PlanApprovalPanel from './plan-approval-panel'
import CreativeMediaCenter from './creative-media-center'
import { loadExecutorWorkspace } from '../lib/executor-preflight.mjs'
import ExecutorPreflightPanel from './executor-preflight-panel'
import { loadOperationalTimeline } from '../lib/operational-timeline.mjs'
import OperationalTimeline from './operational-timeline'
import { loadSelectedExecutionTarget } from '../lib/meta-execution-target.mjs'
import MetaExecutionTargetPanel from './meta-execution-target-panel'

const phases = [
  ['campaignPreparation', 'Campanha'],
  ['metaEnvironmentValidation', 'Ambiente Meta'],
  ['creativeApproval', 'Criativo'],
  ['humanPlanApproval', 'Aprovação'],
  ['executorValidation', 'Executor'],
  ['publication', 'Publicação'],
  ['activation', 'Ativação'],
  ['delivery', 'Entrega'],
]

const ownerLabels = {
  system: 'Sistema',
  operator: 'Operador',
  meta_environment: 'Ambiente Meta',
}

const phaseLabels = {
  complete: 'Concluído',
  incomplete: 'Incompleto',
  pending: 'Pendente',
  not_started: 'Não iniciado',
}

function shortId(value) {
  return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : '—'
}

function money(currency, minor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
  }).format(minor / 100)
}

function EmptyState({ result }) {
  const copy = {
    empty: {
      eyebrow: 'Consulta segura',
      title: 'Carregue uma decisão operacional',
      text: 'Informe os identificadores do cliente e do plano. A central não cria dados de demonstração e só exibe evidências persistidas pelo backend.',
    },
    invalid: {
      eyebrow: 'Dados inválidos',
      title: 'Revise os identificadores',
      text: result.message,
    },
    configuration_required: {
      eyebrow: 'Configuração necessária',
      title: 'Conecte a central ao backend',
      text: 'Defina a URL do backend e a credencial server-side do operador. Nenhuma consulta externa foi realizada.',
    },
    not_found: {
      eyebrow: 'Sem evidência',
      title: 'Nenhuma decisão foi encontrada',
      text: 'Gere uma decisão de prontidão para este plano antes de tentar acompanhá-lo pela central.',
    },
    unavailable: {
      eyebrow: 'Backend indisponível',
      title: 'Não foi possível confirmar o estado',
      text: 'A central manteve o comportamento fail-closed. Tente novamente quando o backend estiver acessível.',
    },
    access_denied: {
      eyebrow: 'Acesso protegido',
      title: 'Não foi possível autenticar o operador',
      text: 'A credencial não foi aceita. Nenhum cliente ou plano foi exposto.',
    },
    no_tenants: {
      eyebrow: 'Acesso autenticado',
      title: 'Nenhum cliente está associado ao operador',
      text: 'Crie uma associação ativa antes de abrir uma operação. A central não concede acesso automaticamente.',
    },
    invalid_selection: {
      eyebrow: 'Seleção protegida',
      title: 'Cliente ou plano fora do acesso permitido',
      text: 'A seleção não pertence ao espaço autorizado deste operador e foi recusada.',
    },
    no_plans: {
      eyebrow: 'Cliente selecionado',
      title: 'Nenhuma campanha preparada ainda',
      text: 'Cadastre o contexto da primeira campanha para gerar um plano rastreável e iniciar o fluxo operacional.',
    },
  }[result.kind]

  return (
    <section className="empty-state" aria-live="polite">
      <span className="eyebrow">{copy.eyebrow}</span>
      <h2>{copy.title}</h2>
      <p>{copy.text}</p>
      <div className="empty-boundary">
        <span className="status-dot" />
        Nenhuma publicação, ativação ou entrega foi inferida.
      </div>
    </section>
  )
}

function WorkspaceSelector({ workspace }) {
  const roleLabels = { owner: 'Proprietário', operator: 'Operador', viewer: 'Leitura' }
  const statusLabels = {
    draft: 'Rascunho', pending: 'Pendente', blocked: 'Bloqueado',
    ready_for_approval: 'Pronto para aprovação', approved: 'Aprovado', executing: 'Em execução',
  }
  return (
    <div className="lookup-form">
      <form className="selector-group" method="get">
        <label>Cliente autorizado
          <select name="tenantId" defaultValue={workspace.selectedTenant.tenantId}>
            {workspace.access.tenants.map((tenant) => (
              <option value={tenant.tenantId} key={tenant.tenantId}>
                {tenant.displayName} · {roleLabels[tenant.role]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Carregar cliente</button>
      </form>
      <form className="selector-group" method="get">
        <input type="hidden" name="tenantId" value={workspace.selectedTenant.tenantId} />
        <label>Campanha / plano mais recente
          <select name="executionPlanId" defaultValue={workspace.selectedPlan?.executionPlanId ?? ''}>
            {!workspace.plans.length && <option value="">Nenhum plano disponível</option>}
            {workspace.plans.map((plan) => (
              <option value={plan.executionPlanId} key={plan.executionPlanId}>
                Campanha {shortId(plan.campaignId)} · {statusLabels[plan.status]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!workspace.plans.length}>Abrir operação</button>
      </form>
      <small className="credential-note">Acesso verificado no servidor · credencial nunca enviada ao navegador</small>
      <a className="prepare-link" href={`/campaigns?tenantId=${workspace.selectedTenant.tenantId}`}>
        Preparar campanhas e resolver pendências
      </a>
    </div>
  )
}

function DecisionDashboard({ decision, workspace, approvalResult, creativeResult, executorResult, timelineResult, targetResult }) {
  const statusLabel = {
    blocked: 'Bloqueado',
    action_required: 'Ação necessária',
    ready_for_executor_validation: 'Pronto para validar executor',
  }[decision.status]

  return (
    <>
      <section className="decision-hero">
        <div>
          <span className={`status-pill status-${decision.status}`}>{statusLabel}</span>
          <h2>{decision.headline}</h2>
          <p>{decision.plainLanguageSummary}</p>
        </div>
        <div className="identity-card">
          <span>Plano</span>
          <strong title={decision.executionPlanId}>{shortId(decision.executionPlanId)}</strong>
          <small title={decision.decisionHash}>Decisão {shortId(decision.decisionHash)}</small>
        </div>
      </section>

      <section className="truth-strip" aria-label="Estado externo confirmado">
        <div><span>Publicada</span><strong>Não</strong></div>
        <div><span>Ativa</span><strong>Não</strong></div>
        <div><span>Entregando</span><strong>Não</strong></div>
        <div><span>Escrita externa</span><strong>Bloqueada</strong></div>
      </section>

      <section className="phase-section">
        <div className="section-heading">
          <div><span className="eyebrow">Fluxo de execução</span><h3>Progresso real da campanha</h3></div>
          <small>Atualizado em {new Date(decision.generatedAt).toLocaleString('pt-BR')}</small>
        </div>
        <div className="phase-grid">
          {phases.map(([key, label], index) => {
            const value = decision.progress[key]
            return (
              <div className={`phase phase-${value}`} key={key}>
                <span className="phase-number">{String(index + 1).padStart(2, '0')}</span>
                <strong>{label}</strong>
                <small>{phaseLabels[value]}</small>
              </div>
            )
          })}
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel blockers-panel">
          <div className="section-heading">
            <div><span className="eyebrow">Centro de pendências</span><h3>O que impede o avanço</h3></div>
            <span className="count-badge">{decision.blockers.length}</span>
          </div>
          {decision.blockers.length ? (
            <div className="blocker-list">
              {decision.blockers.map((blocker) => (
                <article className="blocker" key={`${blocker.code}-${blocker.owner}`}>
                  <div className="blocker-topline">
                    <span>{ownerLabels[blocker.owner]}</span>
                    <small>{blocker.evidenceRefs.length} evidência(s)</small>
                  </div>
                  <h4>{blocker.meaning}</h4>
                  <p><strong>Próxima ação:</strong> {blocker.nextAction}</p>
                </article>
              ))}
            </div>
          ) : <p className="clear-message">Nenhum bloqueador interno registrado.</p>}
        </section>

        <aside className="side-stack">
          <section className="panel action-panel">
            <span className="eyebrow">Próxima ação priorizada</span>
            <h3>{decision.nextAction}</h3>
            <p>A central apresenta uma única ação por vez para reduzir erro operacional.</p>
          </section>
          <section className="panel money-panel">
            <span className="eyebrow">Limite financeiro aprovado</span>
            <strong>{money(
              decision.financialScope.currency,
              decision.financialScope.maximumPlannedSpendMinor,
            )}</strong>
            <p>{decision.financialScope.calculation}</p>
            <div className="autonomy-row">
              <span>Autonomia {decision.autonomy.level}</span>
              <span>{decision.autonomy.humanApprovalRequired ? 'Aprovação humana obrigatória' : 'Autonomia delegada'}</span>
            </div>
          </section>
        </aside>
      </div>

      <section className="panel basis-panel">
        <div className="section-heading">
          <div><span className="eyebrow">Transparência</span><h3>Decisão, motivo e base</h3></div>
        </div>
        <div className="basis-grid">
          {decision.decisionBasis.map((basis, index) => (
            <article key={`${basis.decision}-${index}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h4>{basis.decision}</h4>
              <p>{basis.why}</p>
              <small>{basis.evidenceRefs.length} referência(s) de evidência</small>
            </article>
          ))}
        </div>
      </section>
      <MetaExecutionTargetPanel plan={workspace.selectedPlan} role={workspace.selectedTenant.role} result={targetResult} />
      <PlanApprovalPanel plan={workspace.selectedPlan} role={workspace.selectedTenant.role} approvalResult={approvalResult} />
      <CreativeMediaCenter plan={workspace.selectedPlan} role={workspace.selectedTenant.role} result={creativeResult} />
      <ExecutorPreflightPanel plan={workspace.selectedPlan} role={workspace.selectedTenant.role} approvalResult={approvalResult} result={executorResult} />
      <OperationalTimeline result={timelineResult} />
    </>
  )
}

export default async function Page({ searchParams }) {
  const params = await searchParams
  const tenantId = typeof params?.tenantId === 'string' ? params.tenantId : ''
  const executionPlanId = typeof params?.executionPlanId === 'string'
    ? params.executionPlanId : ''
  const approvalId = typeof params?.approvalId === 'string' ? params.approvalId : ''
  const executionAuthorizationId = typeof params?.executionAuthorizationId === 'string'
    ? params.executionAuthorizationId : ''
  const workspace = await loadOperatorWorkspace({
    requestedTenantId: tenantId,
    requestedExecutionPlanId: executionPlanId,
  })
  const result = workspace.kind === 'ready' && workspace.selectedPlan
    ? await loadOperationalReadiness({
      tenantId: workspace.selectedTenant.tenantId,
      executionPlanId: workspace.selectedPlan.executionPlanId,
    })
    : workspace.kind === 'ready'
      ? { kind: 'no_plans' }
      : workspace
  const approvalResult = workspace.kind === 'ready' && workspace.selectedPlan
    ? await loadPlanApproval({ approvalId, plan: workspace.selectedPlan,
      apiBaseUrl: process.env.CONTEXT_ADS_API_BASE_URL,
      operatorToken: process.env.CONTEXT_ADS_OPERATOR_TOKEN })
    : { kind: 'none' }
  const creativeResult = workspace.kind === 'ready' && workspace.selectedPlan
    ? await loadLatestCreative({ plan: workspace.selectedPlan,
      apiBaseUrl: process.env.CONTEXT_ADS_API_BASE_URL,
      operatorToken: process.env.CONTEXT_ADS_OPERATOR_TOKEN })
    : { kind: 'none' }
  const executorResult = workspace.kind === 'ready' && workspace.selectedPlan
    ? await loadExecutorWorkspace({ plan: workspace.selectedPlan, executionAuthorizationId,
      apiBaseUrl: process.env.CONTEXT_ADS_API_BASE_URL,
      operatorToken: process.env.CONTEXT_ADS_OPERATOR_TOKEN })
    : { kind: 'none' }
  const timelineResult = workspace.kind === 'ready' && workspace.selectedPlan
    ? await loadOperationalTimeline({ plan: workspace.selectedPlan,
      apiBaseUrl: process.env.CONTEXT_ADS_API_BASE_URL,
      operatorToken: process.env.CONTEXT_ADS_OPERATOR_TOKEN })
    : { kind: 'none' }
  const targetResult = workspace.kind === 'ready' && workspace.selectedPlan
    ? await loadSelectedExecutionTarget({ tenantId: workspace.selectedTenant.tenantId })
    : { kind: 'unavailable' }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Contexto Ads — início">
          <span className="brand-mark">C</span>
          <span><strong>Contexto Ads</strong><small>Central Operacional</small></span>
        </a>
        <div className="topbar-actions"><a href="/integrations/meta">Integração Meta</a><a href="/work-queue">Fila diária</a><a href="/portfolio">Visão de portfólio</a><div className="environment"><span /> Ambiente controlado</div></div>
      </header>

      <section className="workspace-intro">
        <div>
          <span className="eyebrow">Visão do operador</span>
          <h1>Clareza para decidir.<br />Controle para executar.</h1>
          <p>Acompanhe o estado comprovado de cada campanha, entenda os bloqueios e avance somente quando todos os controles estiverem satisfeitos.</p>
        </div>
        {workspace.kind === 'ready'
          ? <WorkspaceSelector workspace={workspace} />
          : <div className="access-summary"><span className="eyebrow">Acesso seguro</span><strong>Seleção indisponível</strong><small>A central preservou os dados dos clientes.</small></div>}
      </section>

      <div className="content-shell">
        {result.kind === 'ready'
          ? <DecisionDashboard decision={result.decision} workspace={workspace} approvalResult={approvalResult} creativeResult={creativeResult} executorResult={executorResult} timelineResult={timelineResult} targetResult={targetResult} />
          : <EmptyState result={result} />}
      </div>

      <footer>
        <span>Contexto Ads</span>
        <p>Automação responsável com evidência, aprovação e rastreabilidade.</p>
      </footer>
    </main>
  )
}
