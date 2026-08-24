import { loadOperatorWorkQueue } from '../../../lib/operator-work-queue.mjs'
import { deriveOperatorObservabilityGaps } from '../../../lib/operator-observability-gaps.mjs'

const sourceLabels = { campaign_plans: 'Campanhas e planos', operational_readiness: 'Prontidão', execution_lifecycle: 'Ciclo de execução', delivery_metrics: 'Métricas de entrega' }
const kindLabels = { missing_baseline: 'Baseline ausente', source_deferred: 'Fonte adiada', source_ignored: 'Fonte ignorada' }

function State({ kind }) {
  const copy = { configuration_required: ['Conecte a central', 'O backend seguro ainda não está configurado.'], access_denied: ['Acesso protegido', 'A credencial não autorizou a leitura das lacunas.'], unavailable: ['Lacunas não confirmadas', 'A central recusou dados incompletos e não inferiu ausência.'] }[kind]
  return <main className="portfolio-state"><span className="eyebrow">Observabilidade segura</span><h1>{copy[0]}</h1><p>{copy[1]}</p><a href="/work-queue">Voltar à fila</a></main>
}

export default async function GapsPage() {
  const result = await loadOperatorWorkQueue()
  if (result.kind !== 'ready') return <State kind={result.kind} />
  const view = deriveOperatorObservabilityGaps(result.queue)
  return <>
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">C</span><span><strong>Contexto Ads</strong><small>Lacunas de observabilidade</small></span></a><div className="environment"><span />Somente leitura</div></header>
    <main className="work-shell">
      <section className="work-hero"><div><span className="eyebrow">O que ainda não é observado</span><h1>Lacunas explícitas, sem preencher o vazio com suposições.</h1><p>Somente baseline ausente e fontes persistidas como adiadas ou ignoradas aparecem aqui. Isso não é convertido em score de risco.</p></div><a href="/work-queue">Voltar à fila</a></section>
      <section className="work-metrics"><article><span>Lacunas explícitas</span><strong>{view.summary.totalGapCount}</strong></article><article><span>Clientes afetados</span><strong>{view.summary.tenantCount}</strong></article><article><span>Sem baseline</span><strong>{view.summary.missingBaselineCount}</strong></article><article><span>Fontes adiadas</span><strong>{view.summary.deferredSourceCount}</strong></article><article><span>Fontes ignoradas</span><strong>{view.summary.ignoredSourceCount}</strong></article></section>
      <section className="work-list"><div className="section-heading"><div><span className="eyebrow">Cobertura ausente</span><h2>{view.gaps.length} registro(s) explícitos</h2></div><small>Sem simulação de dados</small></div>{view.gaps.map((gap, index) => <article className="work-item" key={`${gap.tenantId}:${gap.kind}:${gap.source ?? index}`}><div className="work-item-head"><div><span>{kindLabels[gap.kind]}</span><h3>{gap.tenantId.slice(0, 8)}</h3><small>{gap.source ? sourceLabels[gap.source] : 'Comparação histórica'}</small></div></div><p>{gap.reason}</p></article>)}</section>
      <div className="portfolio-boundary">Lacunas derivadas apenas de ausência explicitamente persistida. Nenhum risco de negócio, métrica ou conclusão foi inferido.</div>
    </main>
  </>
}
