import { loadOperatorWorkQueue } from '../../../lib/operator-work-queue.mjs'
import { deriveOperatorChangeDistribution } from '../../../lib/operator-change-distribution.mjs'

const labels={entered:'Entrou',worsened:'Piorou',improved:'Melhorou',unchanged:'Sem mudança',resolved:'Resolvido'}
export default async function WorkQueueChangesPage(){
  const result=await loadOperatorWorkQueue()
  if(result.kind!=='ready') return <main className="portfolio-state"><span className="eyebrow">Mudanças</span><h1>Dados não confirmados.</h1><a href="/work-queue/overview">Voltar à central</a></main>
  const view=deriveOperatorChangeDistribution(result.queue)
  return <><header className="topbar"><a className="brand" href="/"><span className="brand-mark">C</span><span><strong>Contexto Ads</strong><small>Distribuição de mudanças</small></span></a><div className="environment"><span />Somente leitura</div></header><main className="work-shell"><section className="work-hero"><div><span className="eyebrow">Comparações persistidas</span><h1>Como as mudanças comprovadas estão distribuídas.</h1><p>As contagens abaixo descrevem apenas comparações existentes; não representam tendência futura nem desempenho de mídia.</p></div><a href="/work-queue/overview">Central de comando</a></section><section className="work-metrics">{view.distribution.map((entry)=><article key={entry.kind}><span>{labels[entry.kind]}</span><strong>{entry.count}</strong></article>)}</section><div className="portfolio-boundary">{view.comparableTenantCount} cliente(s) com baseline · {view.missingBaselineCount} sem baseline. Nenhuma tendência foi inferida.</div></main></>
}
