import { loadOperatorWorkQueue } from '../../../lib/operator-work-queue.mjs'
import { deriveOperatorDataRecency } from '../../../lib/operator-data-recency.mjs'

const format = (value) => value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'UTC' }) + ' UTC' : 'Sem registro'

function State({ kind }) {
  const copy = { configuration_required: ['Conecte a central', 'O backend seguro ainda não está configurado.'], access_denied: ['Acesso protegido', 'A credencial não autorizou a leitura dos tempos operacionais.'], unavailable: ['Tempos não confirmados', 'A central recusou dados incompletos e não inferiu atualidade.'] }[kind]
  return <main className="portfolio-state"><span className="eyebrow">Recência segura</span><h1>{copy[0]}</h1><p>{copy[1]}</p><a href="/work-queue">Voltar à fila</a></main>
}

export default async function RecencyPage() {
  const result = await loadOperatorWorkQueue()
  if (result.kind !== 'ready') return <State kind={result.kind} />
  const recency = deriveOperatorDataRecency(result.queue)
  return <>
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">C</span><span><strong>Contexto Ads</strong><small>Tempos operacionais</small></span></a><div className="environment"><span />Somente leitura</div></header>
    <main className="work-shell">
      <section className="work-hero"><div><span className="eyebrow">Recência dos dados</span><h1>Quando cada evidência operacional foi observada.</h1><p>Os horários são exibidos como persistidos. O sistema não inventa um limite para chamar dados de recentes ou desatualizados.</p></div><a href="/work-queue">Voltar à fila</a></section>
      <section className="work-metrics"><article><span>Fila gerada</span><strong>{format(recency.queueGeneratedAt)}</strong></article><article><span>Item mais antigo</span><strong>{format(recency.oldestItemObservedAt)}</strong></article><article><span>Item mais novo</span><strong>{format(recency.newestItemObservedAt)}</strong></article><article><span>Snapshot mais antigo</span><strong>{format(recency.oldestSnapshotGeneratedAt)}</strong></article></section>
      <section className="work-list"><div className="section-heading"><div><span className="eyebrow">Por cliente</span><h2>{recency.tenants.length} checkpoint(s) atuais</h2></div><small>Sem classificação artificial de stale/fresh</small></div>{recency.tenants.map((tenant) => <article className="work-item" key={tenant.tenantId}><div className="work-item-head"><div><span>Data operacional {tenant.queueDate}</span><h3>{tenant.tenantId.slice(0, 8)}</h3><small>Snapshot: {format(tenant.snapshotGeneratedAt)}</small></div></div><p>{tenant.itemObservedAt.length ? `${tenant.itemObservedAt.length} observação(ões): ${format(tenant.itemObservedAt[0])} → ${format(tenant.itemObservedAt.at(-1))}` : 'Nenhuma pendência atual observada para este cliente.'}</p></article>)}</section>
      <div className="portfolio-boundary">Horários reportados sem inferir frescor, atraso, SLA ou prazo operacional.</div>
    </main>
  </>
}
