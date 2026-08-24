import { startMetaAuthorization } from '../../actions.js'
import { loadOperatorWorkspace } from '../../../lib/operator-workspace.mjs'

const ERRORS = {
  tenant: 'Selecione uma empresa válida.',
  configuration: 'O painel ainda não recebeu a configuração segura do ambiente.',
  backend: 'O backend não respondeu a tempo. Tente novamente para acordar o ambiente de teste.',
  access: 'Seu acesso não permite configurar a integração desta empresa.',
  oauth: 'A configuração Meta ainda não está completa no servidor.',
  response: 'A resposta de autorização foi recusada por segurança.',
}

export default async function MetaIntegrationPage({ searchParams }) {
  const params = await searchParams
  const requestedTenantId = typeof params?.tenantId === 'string' ? params.tenantId : ''
  const workspace = await loadOperatorWorkspace({ requestedTenantId })
  const tenants = workspace.kind === 'ready' ? workspace.tenants : []
  const selectedTenantId = tenants.some((tenant) => tenant.tenantId === requestedTenantId)
    ? requestedTenantId : tenants[0]?.tenantId ?? ''
  const error = typeof params?.error === 'string' ? ERRORS[params.error] : ''

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Contexto Ads — início">
          <span className="brand-mark">C</span>
          <span><strong>Contexto Ads</strong><small>Central Operacional</small></span>
        </a>
        <div className="topbar-actions"><a href="/">Painel</a><a href="/work-queue">Fila diária</a><div className="environment"><span /> Ambiente controlado</div></div>
      </header>

      <section className="integration-shell">
        <div className="integration-copy">
          <span className="eyebrow">Integração oficial</span>
          <h1>Conectar a Meta com controle.</h1>
          <p>O acesso solicitado nesta validação é somente de leitura. Autorizar não cria campanha, não publica anúncio e não movimenta orçamento.</p>
        </div>

        <section className="panel integration-card">
          <span className="eyebrow">Teste OAuth</span>
          <h2>Autorizar conta Meta</h2>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {tenants.length ? (
            <form action={startMetaAuthorization}>
              <label htmlFor="tenantId">Empresa</label>
              <select id="tenantId" name="tenantId" defaultValue={selectedTenantId}>
                {tenants.map((tenant) => <option key={tenant.tenantId} value={tenant.tenantId}>{tenant.displayName}</option>)}
              </select>
              <button className="primary-button" type="submit">Continuar para a Meta</button>
            </form>
          ) : <p className="empty-copy">Nenhuma empresa autorizada está disponível neste ambiente.</p>}
          <div className="integration-guardrails">
            <strong>O que este teste comprova</strong>
            <ul>
              <li>Retorno HTTPS correto da Meta.</li>
              <li>State único, curto e consumido uma vez.</li>
              <li>Token guardado criptografado no cofre.</li>
              <li>Descoberta posterior somente de contas autorizadas.</li>
            </ul>
          </div>
        </section>
      </section>
    </main>
  )
}
