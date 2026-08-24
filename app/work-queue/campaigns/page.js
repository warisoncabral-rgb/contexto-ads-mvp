import { loadOperatorWorkQueue } from '../../../lib/operator-work-queue.mjs'
import { deriveOperatorCampaignPulse } from '../../../lib/operator-campaign-pulse.mjs'

function State({ kind }) {
  const copy = { configuration_required: ['Conecte a central', 'O backend seguro ainda não está configurado.'],
    access_denied: ['Acesso protegido', 'A credencial não autorizou a leitura por campanha.'],
    unavailable: ['Pulso não confirmado', 'A central recusou dados incompletos e não inferiu estado de campanha.'] }[kind]
  return <main className="portfolio-state"><span className="eyebrow">Pulso de campanhas</span><h1>{copy[0]}</h1><p>{copy[1]}</p><a href="/work-queue/overview">Voltar à central</a></main>
}

export default async function CampaignPulsePage() {
  const result = await loadOperatorWorkQueue()
  if (result.kind !== 'ready') return <State kind={result.kind} />
  const pulse = deriveOperatorCampaignPulse(result.queue)
  return <>
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">C</span><span><strong>Contexto Ads</strong><small>Campanhas</small></span></a><div className="environment"><span />Somente leitura</div></header>
    <main className="work-shell">
      <section className="work-hero"><div><span className="eyebrow">Pulso por campanha</span><h1>Trabalho atual sem confundir pendência com desempenho.</h1><p>A visão agrupa somente bloqueios e mudanças comprovadas. Nenhuma performance, tendência ou score de risco é inferido.</p></div><a href="/work-queue/overview">Central de comando</a></section>
      <section className="work-metrics"><article><span>Campanhas com trabalho</span><strong>{pulse.summary.campaignCount}</strong></article><article><span>Com críticas</span><strong>{pulse.summary.campaignsWithCriticalCount}</strong></article><article><span>Entraram/pioraram</span><strong>{pulse.summary.campaignsWithEnteredOrWorsenedCount}</strong></article></section>
      <section className="work-list"><div className="section-heading"><div><span className="eyebrow">Campanhas comprovadas</span><h2>{pulse.campaigns.length} campanha(s)</h2></div><small>Sem métrica de entrega</small></div>
        {pulse.campaigns.map((campaign) => <article className={`work-item ${campaign.criticalCount ? 'work-critical' : campaign.highCount ? 'work-high' : ''}`} key={`${campaign.tenantId}:${campaign.campaignId}`}><div className="work-item-head"><div><span>{campaign.criticalCount} crítica(s) · {campaign.enteredOrWorsenedCount} entrou/piorou</span><h3>{campaign.tenantDisplayName}</h3><small>Campanha {campaign.campaignId.slice(0, 8)}</small></div><a href={`/?tenantId=${campaign.tenantId}&executionPlanId=${campaign.executionPlanIds[0]}`}>Abrir operação →</a></div><div className="work-next"><span>Responsabilidade atual</span><strong>Operador {campaign.operatorCount} · Sistema {campaign.systemCount} · Ambiente Meta {campaign.metaEnvironmentCount}</strong></div><p>{campaign.pendingCount} pendência(s) · {campaign.improvedCount} melhorada(s) · {campaign.resolvedCount} resolvida(s) no contexto comparável.</p></article>)}
      </section>
      <div className="portfolio-boundary">Pulso derivado somente da fila validada. Nenhum desempenho, tendência, score de risco, conclusão ou autorização foi inferido.</div>
    </main>
  </>
}
