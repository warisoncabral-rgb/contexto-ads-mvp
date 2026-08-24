import { loadMetaConnectionSetup } from '../../lib/meta-connection-setup.mjs'
import MetaConnectionForm from './meta-connection-form'

const copy = {
  configuration_required: ['Configuração necessária', 'Conecte a Central ao backend seguro antes de iniciar OAuth.'],
  access_denied: ['Acesso recusado', 'A credencial do operador não foi aceita.'],
  no_configurable_tenants: ['Nenhum cliente configurável', 'A conexão Meta exige membership owner com permissão de configuração.'],
  invalid_selection: ['Cliente recusado', 'O cliente selecionado não pertence ao seu escopo de configuração.'],
  unavailable: ['Backend indisponível', 'Nenhuma autorização foi iniciada.'],
}

export default async function ConnectionsPage({ searchParams }) {
  const params = await searchParams
  const requestedTenantId = typeof params?.tenantId === 'string' ? params.tenantId : ''
  const setup = await loadMetaConnectionSetup(requestedTenantId)
  if (setup.kind !== 'ready') {
    const [title, detail] = copy[setup.kind] ?? copy.unavailable
    return <main className="portfolio-state"><span className="eyebrow">Conexão Meta</span><h1>{title}</h1><p>{detail}</p><a href="/">Voltar à central</a></main>
  }
  return <><header className="topbar"><a className="brand" href="/"><span className="brand-mark">C</span><span><strong>Contexto Ads</strong><small>Conexão Meta</small></span></a><a href="/work-queue/overview">Central de comando</a></header><main className="work-shell">
    <section className="work-hero"><div><span className="eyebrow">Primeiro gate real</span><h1>Conectar {setup.selectedTenant.displayName} em modo somente leitura.</h1><p>O OAuth será iniciado pelo servidor e a credencial nunca será enviada ao navegador.</p></div></section>
    <nav className="campaign-nav" aria-label="Clientes configuráveis">{setup.tenants.map((tenant) => <a className={tenant.tenantId === setup.selectedTenant.tenantId ? 'active' : ''} key={tenant.tenantId} href={`/connections?tenantId=${tenant.tenantId}`}>{tenant.displayName}</a>)}</nav>
    <MetaConnectionForm tenantId={setup.selectedTenant.tenantId} />
    <div className="portfolio-boundary">Esta etapa apenas abre o consentimento OAuth de leitura. Publicação, ativação, entrega e escrita externa continuam bloqueadas.</div>
  </main></>
}
