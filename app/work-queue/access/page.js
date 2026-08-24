import { loadOperatorWorkQueue } from '../../../lib/operator-work-queue.mjs'
import { deriveOperatorRoleCoverage } from '../../../lib/operator-role-coverage.mjs'

const labels = { owner: 'Proprietário', operator: 'Operador', viewer: 'Visualizador' }

export default async function RoleCoveragePage() {
  const result = await loadOperatorWorkQueue()
  if (result.kind !== 'ready') return <main className="portfolio-state"><span className="eyebrow">Escopo de acesso</span><h1>Dados não confirmados.</h1><a href="/work-queue/overview">Voltar à central</a></main>
  const view = deriveOperatorRoleCoverage(result.queue)
  return <><header className="topbar"><a className="brand" href="/"><span className="brand-mark">C</span><span><strong>Contexto Ads</strong><small>Escopo de acesso</small></span></a><div className="environment"><span />Somente leitura</div></header><main className="work-shell">
    <section className="work-hero"><div><span className="eyebrow">Papéis representados</span><h1>Qual papel de membership está associado ao trabalho atual.</h1><p>Esta visão apenas lê o papel já presente na fila autorizada. Ela não deriva permissões nem amplia autorização.</p></div><a href="/work-queue/overview">Central de comando</a></section>
    <section className="work-list">{view.coverage.map((entry) => <article className="work-item" key={entry.role}><div className="work-item-head"><div><span>{entry.tenantCount} cliente(s)</span><h3>{labels[entry.role]}</h3><small>{entry.workItemCount} pendência(s) · {entry.criticalCount} crítica(s)</small></div></div><p>Responsável pela pendência: operador {entry.operatorOwnedCount} · sistema {entry.systemOwnedCount} · ambiente Meta {entry.metaEnvironmentOwnedCount}.</p></article>)}</section>
    <div className="portfolio-boundary">O papel é exibido como dado de membership já autorizado. Nenhuma permissão adicional ou capacidade de ação foi inferida.</div>
  </main></>
}
