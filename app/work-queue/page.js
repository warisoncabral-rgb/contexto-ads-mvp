import { loadOperatorWorkQueue } from '../../lib/operator-work-queue.mjs'

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

export default async function WorkQueuePage({ searchParams }) {
  const result = await loadOperatorWorkQueue()
  if (result.kind !== 'ready') return <State kind={result.kind} />
  const params = await searchParams
  const filter = allowedFilters.has(params?.owner) ? params.owner : 'all'
  const { queue } = result
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
      <div className="portfolio-boundary">Fila e mudanças derivadas de evidências persistidas. Nenhuma tarefa foi marcada como concluída por inferência e nenhuma ação externa foi executada.</div>
    </main>
  </>
}
