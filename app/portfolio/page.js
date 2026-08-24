import { loadOperatorPortfolio } from '../../lib/operator-portfolio.mjs'

const labels = {
  blocked: 'Bloqueada', action_required: 'Ação necessária',
  not_evaluated: 'Aguardando cálculo', ready_for_executor_validation: 'Pronta para executor',
}
const roleLabels = { owner: 'Proprietário', operator: 'Operador', viewer: 'Leitura' }

function money(currency, minor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(minor / 100)
}

function State({ kind }) {
  const copy = {
    configuration_required: ['Conecte a central', 'O backend e a credencial server-side ainda não estão configurados.'],
    access_denied: ['Acesso protegido', 'A credencial não autorizou a leitura do portfólio.'],
    unavailable: ['Estado não confirmado', 'O painel recusou dados incompletos e preservou o comportamento fail-closed.'],
  }[kind]
  return <main className="portfolio-state"><span className="eyebrow">Portfólio seguro</span><h1>{copy[0]}</h1><p>{copy[1]}</p><a href="/">Voltar à central</a></main>
}

export default async function PortfolioPage() {
  const result = await loadOperatorPortfolio()
  if (result.kind !== 'ready') return <State kind={result.kind} />
  const { portfolio } = result
  const metrics = [
    ['Clientes autorizados', portfolio.summary.authorizedTenantCount],
    ['Campanhas', portfolio.summary.campaignCount],
    ['Bloqueadas', portfolio.summary.blockedCount],
    ['Ação necessária', portfolio.summary.actionRequiredCount],
    ['Prontas', portfolio.summary.readyCount],
  ]
  return <>
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">C</span><span><strong>Contexto Ads</strong><small>Central operacional</small></span></a><div className="environment"><span />Portfólio somente leitura</div></header>
    <main className="portfolio-shell">
      <section className="portfolio-hero"><div><span className="eyebrow">Visão executiva</span><h1>Prioridade clara entre clientes e campanhas.</h1><p>A fila reúne somente operações às quais você possui acesso e mostra uma próxima ação verificável por campanha.</p></div><div className="portfolio-links"><a href="/work-queue">Abrir fila diária</a><a href="/">Operação detalhada</a></div></section>
      <section className="portfolio-metrics">{metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
      <section className="portfolio-list">
        <div className="section-heading"><div><span className="eyebrow">Fila priorizada</span><h2>Bloqueios primeiro</h2></div><small>Atualizado em {new Date(portfolio.generatedAt).toLocaleString('pt-BR')}</small></div>
        {!portfolio.items.length && <div className="portfolio-empty">Nenhuma campanha preparada nos clientes autorizados.</div>}
        {portfolio.items.map((item) => <article className={`portfolio-item portfolio-${item.readinessStatus}`} key={item.executionPlanId}>
          <div className="portfolio-item-head"><div><span className="portfolio-status">{labels[item.readinessStatus]}</span><h3>{item.tenantDisplayName}</h3><small>{roleLabels[item.role]} · campanha {item.campaignId.slice(0, 8)}</small></div><strong>{money(item.currency, item.maximumPlannedSpendMinor)}</strong></div>
          <p>{item.headline}</p><div className="portfolio-action"><span>Próxima ação</span><strong>{item.nextAction}</strong></div>
          <footer><span>{item.blockerCount} bloqueio(s)</span><time>{new Date(item.updatedAt).toLocaleString('pt-BR')}</time><a href={`/?tenantId=${item.tenantId}&executionPlanId=${item.executionPlanId}`}>Abrir campanha →</a></footer>
        </article>)}
      </section>
      <div className="portfolio-boundary">Nenhuma campanha foi publicada, ativada ou alterada por esta visualização.</div>
    </main>
  </>
}
