import { loadOperatorWorkQueue } from '../../../lib/operator-work-queue.mjs'
import { deriveOperatorEvidenceReferenceMap } from '../../../lib/operator-evidence-reference-map.mjs'

function State({ kind }) {
  const copy = { configuration_required: ['Conecte a central', 'O backend seguro ainda não está configurado.'],
    access_denied: ['Acesso protegido', 'A credencial não autorizou a leitura das referências.'],
    unavailable: ['Referências não confirmadas', 'A central recusou dados incompletos e não inferiu evidências.'] }[kind]
  return <main className="portfolio-state"><span className="eyebrow">Mapa de referências</span><h1>{copy[0]}</h1><p>{copy[1]}</p><a href="/work-queue/overview">Voltar à central</a></main>
}

export default async function EvidenceReferencePage() {
  const result = await loadOperatorWorkQueue()
  if (result.kind !== 'ready') return <State kind={result.kind} />
  const map = deriveOperatorEvidenceReferenceMap(result.queue)
  return <>
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">C</span><span><strong>Contexto Ads</strong><small>Referências de evidência</small></span></a><div className="environment"><span />Somente leitura</div></header>
    <main className="work-shell">
      <section className="work-hero"><div><span className="eyebrow">Mapa sintático</span><h1>Como as referências vinculadas estão distribuídas.</h1><p>O prefixo antes de “:” é tratado apenas como namespace textual. Ele não prova validade, suficiência ou qualidade da evidência.</p></div><a href="/work-queue/overview">Central de comando</a></section>
      <section className="work-metrics"><article><span>Referências</span><strong>{map.summary.referenceCount}</strong></article><article><span>Namespaces</span><strong>{map.summary.namespaceCount}</strong></article><article><span>Sem namespace explícito</span><strong>{map.summary.unscopedReferenceCount}</strong></article></section>
      <section className="work-list"><div className="section-heading"><div><span className="eyebrow">Distribuição</span><h2>{map.namespaces.length} grupo(s) sintático(s)</h2></div><small>Não é validação de evidência</small></div>
        {map.namespaces.map((entry) => <article className="work-item" key={entry.namespace}><div className="work-item-head"><div><span>{entry.referenceCount} referência(s)</span><h3>{entry.namespace === 'unscoped' ? 'Sem namespace explícito' : entry.namespace}</h3><small>{entry.workItemCount} item(ns) · {entry.tenantCount} cliente(s)</small></div></div><p>Responsáveis presentes: {entry.owners.join(', ') || 'nenhum'}.</p></article>)}
      </section>
      <div className="portfolio-boundary">Agrupamento puramente sintático. Nenhuma validade, suficiência, autenticidade ou autorização foi inferida a partir do texto das referências.</div>
    </main>
  </>
}
