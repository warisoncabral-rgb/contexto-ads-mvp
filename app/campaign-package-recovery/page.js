export const dynamic = 'force-dynamic'

const PACKAGE_ID = '849547ce-645e-4c7b-a844-451182253fe6'

async function recoverPackage() {
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  const boundaries = {
    publication_authorized: false,
    external_writes_allowed: false,
    external_writes_performed: false,
    meta_write_performed: false,
  }

  if (!apiBaseUrl || !operatorToken) {
    return {
      action_status: 'CONFIGURATION_REQUIRED',
      error: 'Server-side API configuration is unavailable',
      boundaries,
    }
  }

  const url = `${apiBaseUrl.replace(/\/$/, '')}/v1/operator/campaign-packages/v1/${PACKAGE_ID}/action-status`
  let lastFailure = null

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${operatorToken}`,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(45000),
      })
      const text = await response.text()
      let payload
      try {
        payload = JSON.parse(text)
      } catch {
        payload = {
          action_status: 'INVALID_RESPONSE',
          http_status: response.status,
          error: text.slice(0, 500),
          boundaries,
        }
      }

      return {
        ...payload,
        recovery_transport: 'render_server_side',
        recovery_attempt: attempt,
        checked_at: new Date().toISOString(),
        boundaries: { ...boundaries, ...(payload?.boundaries ?? {}) },
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'Request failed'
    }
  }

  return {
    action_status: 'UNAVAILABLE',
    error: lastFailure,
    recovery_transport: 'render_server_side',
    recovery_attempt: 3,
    checked_at: new Date().toISOString(),
    boundaries,
  }
}

export default async function CampaignPackageRecoveryPage() {
  const result = await recoverPackage()

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Contexto Ads — início">
          <span className="brand-mark">C</span>
          <span><strong>Contexto Ads</strong><small>Recuperação segura</small></span>
        </a>
        <div className="topbar-actions">
          <a href="/campaign-package-recovery">Atualizar status</a>
          <a href="/">Voltar à central</a>
          <div className="environment"><span /> Somente leitura</div>
        </div>
      </header>

      <section className="workspace-intro">
        <div>
          <span className="eyebrow">Contorno server-side</span>
          <h1>Status do pacote canônico</h1>
          <p>Consulta executada pelo servidor do painel, sem passar pelo transporte de GPT Actions.</p>
        </div>
        <div className="access-summary">
          <span className="eyebrow">Resultado</span>
          <strong>{String(result.action_status ?? 'UNKNOWN')}</strong>
          <small>Pacote {PACKAGE_ID}</small>
        </div>
      </section>

      <div className="content-shell">
        <section className="panel basis-panel" aria-live="polite">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Retorno exato</span>
              <h3>Evidência do backend</h3>
            </div>
          </div>
          <pre style={{ overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </section>

        <section className="truth-strip" aria-label="Limites de segurança">
          <div><span>Publicação autorizada</span><strong>Não</strong></div>
          <div><span>Escrita externa</span><strong>Bloqueada</strong></div>
          <div><span>Escrita realizada</span><strong>Não</strong></div>
          <div><span>Escrita Meta</span><strong>Não</strong></div>
        </section>
      </div>

      <footer>
        <span>Contexto Ads</span>
        <p>Consulta somente leitura; nenhuma submissão ou operação Meta é executada.</p>
      </footer>
    </main>
  )
}
