import { loadOperatorWorkspace } from '../../../../lib/operator-workspace.mjs'
import MetaValidationPanel from '../validation-panel.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default async function MetaValidationPage({ searchParams }) {
  const params = await searchParams
  const tenantId = typeof params?.tenantId === 'string' ? params.tenantId : ''
  const connectionId = typeof params?.connectionId === 'string' ? params.connectionId : ''
  const workspace = await loadOperatorWorkspace({ requestedTenantId: tenantId })
  const selectedTenant = workspace.kind === 'ready' ? workspace.selectedTenant : null
  const validScope = selectedTenant?.tenantId === tenantId && UUID.test(connectionId)

  return <main>
    <header className="topbar">
      <a className="brand" href="/" aria-label="Contexto Ads — início">
        <span className="brand-mark">C</span>
        <span><strong>Contexto Ads</strong><small>Central Operacional</small></span>
      </a>
      <div className="topbar-actions"><a href="/integrations/meta">Integração Meta</a><a href="/">Painel</a><div className="environment"><span /> Ambiente controlado</div></div>
    </header>
    <section className="integration-shell">
      <div className="integration-copy">
        <span className="eyebrow">OAuth concluído</span>
        <h1>Agora vamos provar a leitura.</h1>
        <p>A credencial permanece criptografada no backend. O navegador recebe apenas o resultado sanitizado de cada verificação.</p>
      </div>
      {validScope
        ? <MetaValidationPanel tenantId={tenantId} connectionId={connectionId} />
        : <section className="panel integration-card"><h2>Validação indisponível</h2><p className="form-error">A empresa ou a conexão não correspondem ao seu acesso autorizado.</p></section>}
    </section>
  </main>
}
