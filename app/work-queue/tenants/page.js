import { loadOperatorWorkQueue } from '../../../lib/operator-work-queue.mjs'
import { deriveOperatorTenantDailyPulse } from '../../../lib/operator-tenant-daily-pulse.mjs'

function State({ kind }) {
  const copy = { configuration_required: ['Conecte a central', 'O backend seguro ainda não está configurado.'],
    access_denied: ['Acesso protegido', 'A credencial não autorizou a leitura do pulso por cliente.'],
    unavailable: ['Pulso não confirmado', 'A central recusou dados incompletos e não inferiu estado por cliente.'] }[kind]
  return <main className="portfolio-state"><span className="eyebrow">Pulso diário seguro</span><h1>{copy[0]}</h1><p>{copy[1]}</p><a href="/work-queue">Voltar à fila</a></main>
}

export default async function TenantDailyPulsePage() {
  const result = await loadOperatorWorkQueue()
  if (result.kind !== 'ready') return <State kind={result.kind} />
  const pulse = deriveOperatorTenantDailyPulse(result.queue)
  return <>
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">C</span><span><strong>Contexto Ads</strong><small>Pulso por cliente</small></span></a><div className="environment"><span />Somente leitura</div></header>
    <main className="work-shell">
      <section className="work-hero"><div><span className="eyebrow">Pulso diário por cliente</span><h1>Onde a atenção operacional está concentrada.</h1><p>Clientes são ordenados por fatos atuais: pendências críticas, entradas ou pioras comprovadas e volume de pendências. Nenhum score de risco é inventado.</p></div><a href="/work-queue">Voltar à fila</a></section>
      <section className="work-metrics"><article><span>Clientes com pendência</span><strong>{pulse.summary.tenantCount}</strong></article><article><span>Com críticas</span><strong>{pulse.summary.tenantsWithCriticalCount}</strong></article><article><span>Com entrada/piora</span><strong>{pulse.summary.tenantsWithNewRiskCount}</strong></article><article><span>Sem baseline</span><strong>{pulse.summary.tenantsWithoutBaselineCount}</strong></article></section>
      <section className="work-list">
        <div className="section-heading"><div><span className="eyebrow">Prioridade por fatos</span><h2>{pulse.tenants.length} cliente(s) com trabalho atual</h2></div><small>Sem score sintético</small></div>
        {pulse.tenants.map((tenant) => <article className={`work-item ${tenant.criticalCount ? 'work-critical' : tenant.highCount ? 'work-high' : ''}`} key={tenant.tenantId}>
          <div className="work-item-head"><div><span>{tenant.criticalCount} crítica(s) · {tenant.enteredOrWorsenedCount} entrou/piorou</span><h3>{tenant.tenantDisplayName}</h3><small>{tenant.baselineAvailable ? `Baseline ${tenant.previousQueueDate}` : 'Sem baseline anterior'}</small></div><a href={`/work-queue?tenant=${tenant.tenantId}`}>Ver fila →</a></div>
          <div className="work-next"><span>Responsabilidade atual</span><strong>Operador {tenant.operatorCount} · Sistema {tenant.systemCount} · Ambiente Meta {tenant.metaEnvironmentCount}</strong></div>
          <p>{tenant.pendingCount} pendência(s) atuais · {tenant.resolvedCount} resolvida(s) · {tenant.improvedCount} melhorada(s) desde o baseline disponível.</p>
        </article>)}
      </section>
      <div className="portfolio-boundary">Pulso derivado somente da fila validada e das comparações persistidas. Nenhum score de risco, prazo, conclusão ou autorização foi inferido.</div>
    </main>
  </>
}
