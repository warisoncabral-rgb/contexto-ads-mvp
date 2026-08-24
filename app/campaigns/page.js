import CampaignContextForm from './campaign-context-form'
import { loadCampaignPreparation } from '../../lib/campaign-preparation.mjs'

const stateCopy = {
  configuration_required: ['Configuração necessária', 'Conecte a central ao backend seguro.'],
  access_denied: ['Acesso protegido', 'A credencial não permite consultar campanhas.'],
  no_tenants: ['Nenhum cliente associado', 'Associe um cliente ativo ao operador.'],
  invalid_selection: ['Seleção recusada', 'A campanha ou o cliente não pertence ao seu acesso.'],
  unavailable: ['Backend indisponível', 'O sistema preservou o progresso e não assumiu nenhum dado.'],
}

function PreparationUnavailable({ kind }) {
  const [title, text] = stateCopy[kind] ?? stateCopy.unavailable
  return <section className="preparation-state"><span className="eyebrow">Falha segura</span><h1>{title}</h1><p>{text}</p><a href="/">Voltar à central</a></section>
}

export default async function CampaignsPage({ searchParams }) {
  const params = await searchParams
  const tenantId = typeof params?.tenantId === 'string' ? params.tenantId : ''
  const campaignId = typeof params?.campaignId === 'string' ? params.campaignId : ''
  const preparation = await loadCampaignPreparation({
    requestedTenantId: tenantId,
    requestedCampaignId: campaignId,
  })
  if (preparation.kind !== 'ready') return <main><PreparationUnavailable kind={preparation.kind} /></main>

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark">C</span><span><strong>Contexto Ads</strong><small>Preparação guiada</small></span></a>
        <a className="back-link" href={`/?tenantId=${preparation.selectedTenant.tenantId}`}>Voltar à central</a>
      </header>
      <section className="preparation-hero">
        <div><span className="eyebrow">Cliente autorizado</span><h1>{preparation.selectedTenant.displayName}</h1><p>Organize os fatos da campanha e transforme lacunas em tarefas objetivas.</p></div>
        <nav className="campaign-nav" aria-label="Campanhas em preparação">
          <a className={!campaignId ? 'active' : ''} href={`/campaigns?tenantId=${preparation.selectedTenant.tenantId}`}>+ Nova campanha</a>
          {preparation.contexts.map((context) => (
            <a className={campaignId === context.campaignId ? 'active' : ''} key={context.campaignId} href={`/campaigns?tenantId=${preparation.selectedTenant.tenantId}&campaignId=${context.campaignId}`}>
              <strong>{context.facts.businessName?.value || 'Campanha sem nome'}</strong>
              <small>{context.status === 'ready_for_generation' ? 'Contexto completo' : `${context.validationIssues.length} pendência(s)`}</small>
            </a>
          ))}
        </nav>
      </section>
      {params?.saved === '1' && <div className="save-confirmation" role="status">Progresso salvo, versionado e auditado.</div>}
      <section className="preparation-shell">
        <CampaignContextForm
          tenantId={preparation.selectedTenant.tenantId}
          context={preparation.selectedContext}
          canEdit={preparation.canEdit}
        />
      </section>
      <footer><span>Contexto Ads</span><p>Preparação sem adivinhação, com histórico e controle humano.</p></footer>
    </main>
  )
}
