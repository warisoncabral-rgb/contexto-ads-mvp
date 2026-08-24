import { loadOperatorWorkQueue } from '../../lib/operator-work-queue.mjs'
import { deriveOperatorDailyBrief } from '../../lib/operator-daily-brief.mjs'
import { deriveOperatorDecisionAgenda } from '../../lib/operator-decision-agenda.mjs'
import { deriveOperatorHumanActionEvidence } from '../../lib/operator-human-action-evidence.mjs'
import { deriveOperatorReviewPackets } from '../../lib/operator-review-packets.mjs'

const ownerLabels = { operator: 'Operador', system: 'Sistema', meta_environment: 'Ambiente Meta' }
const priorityLabels = { critical: 'Crítica', high: 'Alta', normal: 'Normal' }
const sourceLabels = { campaign_plans: 'Campanhas e planos', operational_readiness: 'Prontidão',
  execution_lifecycle: 'Ciclo de execução', delivery_metrics: 'Métricas de entrega' }
const sourceStatusLabels = { included: 'Incluída', deferred: 'Adiada', ignored: 'Ignorada' }
const changeLabels = { entered: 'Entrou', worsened: 'Piorou', improved: 'Melhorou',
  unchanged: 'Sem mudança', resolved: 'Resolvido' }
const allowedFilters = new Set(['all', 'operator', 'system', 'meta_environment'])

function State({ kind }) {
  const copy = { configuration_required: ['Conecte a central', 'O backend seguro ainda não está configurado.'],
    access_denied: ['Acesso protegido', 'A credencial não autorizou a leitura das pendências.'],
    unavailable: ['Fila não confirmada', 'A central recusou dados incompletos e não inferiu nenhuma tarefa.'] }[kind]
  return <main className="portfolio-state"><span className="eyebrow">Central diária segura</span><h1>{copy[0]}</h1><p>{copy[1]}</p><a href="/">Voltar à central</a></main>
}

function AgendaLane({ label, items }) {
  return <article><span>{label}</span><strong>{items.length}</strong>{items.slice(0, 2).map((item) => <small key={item.workItemId}>{item.tenantDisplayName} · {priorityLabels[item.priority]}</small>)}</article>
}

export default async function WorkQueuePage({ searchParams }) {
  const result = await loadOperatorWorkQueue()
  if (result.kind !== 'ready') return <State kind={result.kind} />
  const params = await searchParams
  const filter = allowedFilters.has(params?.owner) ? params.owner : 'all'
  const { queue } = result
  const brief = deriveOperatorDailyBrief(queue)
  const agenda = deriveOperatorDecisionAgenda(queue)
  const evidenceView = deriveOperatorHumanActionEvidence(queue)
  const reviewPackets = deriveOperatorReviewPackets(queue)
  const items = filter === 'all' ? queue.items : queue.items.filter((item) => item.owner === filter)
  const tabs = [['all', 'Todas'], ['operator', 'Operador'], ['system', 'Sistema'], ['meta_environment', 'Ambiente Meta']]
  const comparisons = queue.snapshots.map((snapshot) => snapshot.comparison)
  const changes = comparisons.flatMap((comparison) => comparison.changes)
  const changeCounts = Object.fromEntries(Object.keys(changeLabels)
    .map((kind) => [kind, changes.filter((change) => change.kind === kind).length]))
  const baselines = comparisons.filter((comparison) => comparison.baselineAvailable).length
  return <>
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">C</span><span><strong>Contexto Ads</strong><small>Central operacional</small></span></a><div className="environment"><span />Fila somente leitura</div></header>
    <main className="work-shell">
      <section className="work-hero"><div><span className="eyebrow">Trabalho diário</span><h1>Uma fila objetiva para fazer o que importa agora.</h1><p>Cada item nasce da prontidão atual e conserva responsável, evidência e ação recomendada. Nenhum prazo ou conclusão é inventado.</p></div><a href="/portfolio">Ver portfólio</a></section>
      <section className="daily-brief">
        <div className="section-heading"><div><span className="eyebrow">Resumo operacional</span><h2>{brief.headline}</h2></div><small>Derivado somente da fila validada</small></div>
        <div className="daily-brief-metrics"><article><span>Críticas</span><strong>{brief.summary.criticalCount}</strong></article><article><span>Entraram ou pioraram</span><strong>{brief.summary.enteredOrWorsenedCount}</strong></article><article><span>Resolvidas</span><strong>{brief.summary.resolvedCount}</strong></article><article><span>Melhoraram</span><strong>{brief.summary.improvedCount}</strong></article></div>
        {brief.baselineMissingCount > 0 && <p className="change-baseline">{brief.baselineMissingCount} cliente(s) ainda não possuem checkpoint anterior; nenhuma mudança foi fabricada para eles.</p>}
        {brief.attention.length > 0 && <div className="daily-brief-focus"><span>Prioridade agora</span>{brief.attention.map((item) => <a href={`/?tenantId=${item.tenantId}&executionPlanId=${item.executionPlanId}`} key={item.workItemId}><strong>{item.tenantDisplayName}</strong><small>{priorityLabels[item.priority]} · {ownerLabels[item.owner]} · {item.blockerCode}</small><p>{item.nextAction}</p></a>)}</div>}
      </section>
      <section className="daily-brief">
        <div className="section-heading"><div><span className="eyebrow">Agenda por responsabilidade</span><h2>{agenda.headline}</h2></div><small>Sem inferir tipo de decisão humana</small></div>
        <div className="work-metrics"><AgendaLane label="Operador" items={agenda.lanes.operator} /><AgendaLane label="Sistema" items={agenda.lanes.system} /><AgendaLane label="Ambiente Meta" items={agenda.lanes.metaEnvironment} /><article><span>Humanas críticas</span><strong>{agenda.summary.criticalOperatorCount}</strong><small>Somente owner=operator</small></article><article><span>Humanas altas</span><strong>{agenda.summary.highOperatorCount}</strong><small>Somente owner=operator</small></article></div>
        {agenda.lanes.operator.length > 0 && <div className="daily-brief-focus"><span>Ações humanas comprovadas</span>{agenda.lanes.operator.map((item) => <a href={`/?tenantId=${item.tenantId}&executionPlanId=${item.executionPlanId}`} key={item.workItemId}><strong>{item.tenantDisplayName}</strong><small>{priorityLabels[item.priority]} · {item.blockerCode}</small><p>{item.nextAction}</p></a>)}</div>}
      </section>
      <section className="daily-brief">
        <div className="section-heading"><div><span className="eyebrow">Evidência para revisão humana</span><h2>{evidenceView.headline}</h2></div><small>Presença de referência ≠ suficiência</small></div>
        <div className="work-metrics"><article><span>Com referência</span><strong>{evidenceView.operator.withEvidenceCount}</strong><small>Não implica prontidão</small></article><article><span>Sem referência</span><strong>{evidenceView.operator.withoutEvidenceCount}</strong><small>Contrato atual</small></article><article><span>Fora do operador</span><strong>{evidenceView.outsideHumanControlCount}</strong><small>Sistema ou Meta</small></article><article><span>Prontidão inferida</span><strong>Não</strong><small>Fail-closed</small></article><article><span>Autorização inferida</span><strong>Não</strong><small>Fail-closed</small></article></div>
        {evidenceView.operator.withoutEvidence.length > 0 && <div className="daily-brief-focus"><span>Ações do operador sem referência vinculada</span>{evidenceView.operator.withoutEvidence.map((item) => <a href={`/?tenantId=${item.tenantId}&executionPlanId=${item.executionPlanId}`} key={item.workItemId}><strong>{item.tenantDisplayName}</strong><small>{priorityLabels[item.priority]} · {item.blockerCode}</small><p>{item.nextAction}</p></a>)}</div>}
      </section>
      <section className="daily-brief">
        <div className="section-heading"><div><span className="eyebrow">Pacotes de revisão</span><h2>{reviewPackets.totalCount} ação(ões) do operador consolidadas para revisão.</h2></div><small>{reviewPackets.withChangeContextCount} com contexto de mudança</small></div>
        {reviewPackets.packets.length > 0 && <div className="daily-brief-focus"><span>Contexto reunido sem inferir suficiência</span>{reviewPackets.packets.map((packet) => <a href={`/?tenantId=${packet.tenantId}&executionPlanId=${packet.executionPlanId}`} key={packet.workItemId}><strong>{packet.tenantDisplayName}</strong><small>{priorityLabels[packet.priority]} · {packet.blockerCode} · {packet.evidenceRefCount} referência(s)</small><p>{packet.nextAction}</p><small>{packet.baselineAvailable ? (packet.changeKind ? `Mudança: ${changeLabels[packet.changeKind]}` : 'Baseline disponível; sem mudança específica vinculada') : 'Sem baseline anterior'}</small></a>)}</div>}
      </section>
      <section className="work-metrics"><article><span>Pendências</span><strong>{queue.summary.pendingItemCount}</strong></article><article><span>Críticas</span><strong>{queue.summary.criticalCount}</strong></article><article><span>Do operador</span><strong>{queue.summary.operatorCount}</strong></article><article><span>Do sistema</span><strong>{queue.summary.systemCount}</strong></article><article><span>Ambiente Meta</span><strong>{queue.summary.metaEnvironmentCount}</strong></article></section>
      <nav className="work-tabs" aria-label="Filtrar responsável">{tabs.map(([key, label]) => <a className={filter === key ? 'active' : ''} href={key === 'all' ? '/work-queue' : `/work-queue?owner=${key}`} key={key}>{label}</a>)}</nav>
      <section className="change-panel">
        <div className="section-heading"><div><span className="eyebrow">Mudanças comprovadas</span><h2>O que mudou desde o checkpoint anterior</h2></div><small>{baselines}/{queue.snapshots.length} cliente(s) com baseline anterior</small></div>
        <div className="change-metrics">{Object.entries(changeLabels).map(([kind, label]) => <article key={kind}><span className={`change-${kind}`}>{label}</span><strong>{changeCounts[kind]}</strong></article>)}</div>
        {baselines < queue.snapshots.length && <p className="change-baseline">Clientes sem checkpoint anterior são declarados sem baseline; nenhuma entrada, melhora, piora ou resolução é inferida para eles.</p>}
        {changes.length > 0 && <div className="change-list">{changes.filter((change) => change.kind !== 'unchanged').map((change) => <article key={`${change.tenantId}:${change.workItemId}:${change.kind}`}><div><span className={`change-${change.kind}`}>{changeLabels[change.kind]}</span><strong>{change.tenantDisplayName}</strong><small>{change.blockerCode} · {change.previousQueueDate} → {change.currentQueueDate}</small></div><p>{change.meaning}</p><small>{change.previousPriority ? priorityLabels[change.previousPriority] : 'Ausente'} → {change.currentPriority ? priorityLabels[change.currentPriority] : 'Ausente'}</small></article>)}</div>}
      </section>
      <section className="source-coverage"><div className="section-heading"><div><span className="eyebrow">Transparência das fontes</span><h2>O que entrou no cálculo</h2></div><small>{queue.snapshots.length} checkpoint(s) diário(s) · UTC</small></div><div>{queue.snapshots[0]?.sourceDecisions.map((decision) => <article key={decision.source}><span className={`source-${decision.status}`}>{sourceStatusLabels[decision.status]}</span><strong>{sourceLabels[decision.source]}</strong><p>{decision.reason}</p></article>)}</div></section>
      <section className="work-list">
        <div className="section-heading"><div><span className="eyebrow">Fila comprovada</span><h2>{items.length} item(ns) neste recorte</h2></div><small>Atualizado em {new Date(queue.generatedAt).toLocaleString('pt-BR')}</small></div>
        {!items.length && <div className="portfolio-empty">Nenhuma pendência para este responsável.</div>}
        {items.map((item) => <article className={`work-item work-${item.priority}`} key={item.workItemId}>
          <div className="work-item-head"><div><span>{priorityLabels[item.priority]} · {ownerLabels[item.owner]}</span><h3>{item.tenantDisplayName}</h3><small>Campanha {item.campaignId.slice(0, 8)} · {item.blockerCode}</small></div><a href={`/?tenantId=${item.tenantId}&executionPlanId=${item.executionPlanId}`}>Abrir operação →</a></div>
          <p>{item.meaning}</p><div className="work-next"><span>Próxima ação recomendada</span><strong>{item.nextAction}</strong></div>
          <details><summary>{item.evidenceRefs.length} evidência(s) vinculada(s)</summary>{item.evidenceRefs.map((ref) => <code key={ref}>{ref}</code>)}</details>
        </article>)}
      </section>
      <div className="portfolio-boundary">Fila, mudanças, resumo, agenda, evidências e pacotes de revisão derivados do contrato validado. Nenhuma suficiência, prontidão, autorização ou conclusão foi inferida; nenhuma notificação foi enviada e nenhuma ação externa foi executada.</div>
    </main>
  </>
}
