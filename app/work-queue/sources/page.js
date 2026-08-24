import { loadOperatorWorkQueue } from '../../../lib/operator-work-queue.mjs'
import { deriveOperatorSourceCoverage } from '../../../lib/operator-source-coverage.mjs'

const labels = { campaign_plans: 'Campanhas e planos', operational_readiness: 'Prontidão', execution_lifecycle: 'Ciclo de execução', delivery_metrics: 'Métricas de entrega' }

function State({ kind }) {
  const copy = { configuration_required: ['Conecte a central', 'O backend seguro ainda não está configurado.'], access_denied: ['Acesso protegido', 'A credencial não autorizou a leitura das fontes.'], unavailable: ['Cobertura não confirmada', 'A central recusou dados incompletos e não inferiu cobertura.'] }[kind]
  return <main className="portfolio-state"><span className="eyebrow">Cobertura segura</span><h1>{copy[0]}</h1><p>{copy[1]}</p><a href="/work-queue">Voltar à fila</a></main>
}

export default async function SourceCoveragePage() {
  const result = await loadOperatorWorkQueue()
  if (result.kind !== 'ready') return <State kind={result.kind} />
  const coverage = deriveOperatorSourceCoverage(result.queue)
  return <>
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">C</span><span><strong>Contexto Ads</strong><small>Cobertura das fontes</small></span></a><div className="environment"><span />Somente leitura</div></header>
    <main className="work-shell">
      <section className="work-hero"><div><span className="eyebrow">Transparência multi-tenant</span><h1>Cobertura apurada em todos os checkpoints.</h1><p>Nenhum cliente é usado como representante global. Estados incluído, adiado e ignorado são contados separadamente para cada fonte.</p></div><a href="/work-queue">Voltar à fila</a></section>
      <section className="work-metrics"><article><span>Clientes</span><strong>{coverage.summary.tenantCount}</strong></article><article><span>Com fonte adiada</span><strong>{coverage.summary.tenantsWithDeferredCount}</strong></article><article><span>Com fonte ignorada</span><strong>{coverage.summary.tenantsWithIgnoredCount}</strong></article><article><span>Fontes com status misto</span><strong>{coverage.summary.mixedSourceStatusCount}</strong></article></section>
      <section className="work-list"><div className="section-heading"><div><span className="eyebrow">Por fonte</span><h2>Cobertura real entre clientes</h2></div><small>Todos os snapshots atuais</small></div>{coverage.sources.map((source) => <article className="work-item" key={source.source}><div className="work-item-head"><div><span>{source.uniformStatus ? `Status uniforme: ${source.uniformStatus}` : 'Status varia por cliente'}</span><h3>{labels[source.source]}</h3></div></div><p>Incluída em {source.includedCount} · Adiada em {source.deferredCount} · Ignorada em {source.ignoredCount} · Total {source.tenantCount}</p></article>)}</section>
      <div className="portfolio-boundary">Cobertura derivada de todos os snapshots autorizados. Nenhuma disponibilidade de fonte foi inferida e nenhum cliente foi usado como proxy global.</div>
    </main>
  </>
}
