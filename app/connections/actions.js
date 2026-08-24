'use server'

import { redirect } from 'next/navigation'
import { validConnectionStart, validOAuthStart, validReadOnlySmokeReport } from '../../lib/meta-connection-setup.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function backendConfig() {
  const apiBaseUrl = process.env.CONTEXT_ADS_API_BASE_URL
  const operatorToken = process.env.CONTEXT_ADS_OPERATOR_TOKEN
  if (!apiBaseUrl || !operatorToken) return null
  return { base: apiBaseUrl.replace(/\/$/, ''), headers: {
    accept: 'application/json', authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json',
  } }
}

export async function beginMetaConnection(_previousState, formData) {
  const tenantId = String(formData.get('tenantId') ?? '')
  if (!UUID.test(tenantId)) return { error: 'Selecione um cliente autorizado.' }
  const config = backendConfig()
  if (!config) return { error: 'A central não está conectada ao backend seguro.' }

  let startResponse
  try {
    startResponse = await fetch(`${config.base}/v1/meta/connections/start`, {
      method: 'POST', headers: config.headers, body: JSON.stringify({ tenantId }), cache: 'no-store',
      signal: globalThis.AbortSignal.timeout(8000),
    })
  } catch { return { error: 'Não foi possível iniciar a conexão. Nenhuma autorização foi aberta.' } }
  if (startResponse.status === 401 || startResponse.status === 403) return { error: 'Seu acesso não permite configurar este cliente.' }
  if (!startResponse.ok) return { error: 'O backend recusou o início da conexão com segurança.' }
  let connection
  try { connection = await startResponse.json() } catch { return { error: 'O backend não confirmou a conexão.' } }
  if (!validConnectionStart(connection, tenantId)) return { error: 'A confirmação da conexão ficou inconsistente.' }

  let oauthResponse
  try {
    oauthResponse = await fetch(`${config.base}/v1/meta/connections/${encodeURIComponent(connection.connectionId)}/oauth/start`, {
      method: 'POST', headers: config.headers, body: JSON.stringify({ tenantId, scopeProfile: 'read_only' }), cache: 'no-store',
      signal: globalThis.AbortSignal.timeout(8000),
    })
  } catch { return { error: 'A conexão foi criada, mas o OAuth não pôde ser iniciado.' } }
  if (!oauthResponse.ok) return { error: 'O OAuth Meta não está pronto neste ambiente.' }
  let oauth
  try { oauth = await oauthResponse.json() } catch { return { error: 'O backend não confirmou o OAuth.' } }
  if (!validOAuthStart(oauth, connection.connectionId)) return { error: 'A autorização OAuth retornada foi recusada por segurança.' }
  redirect(oauth.authorizationUrl)
}

export async function runMetaReadOnlySmoke(_previousState, formData) {
  const tenantId = String(formData.get('tenantId') ?? '')
  const connectionId = String(formData.get('connectionId') ?? '')
  if (!UUID.test(tenantId) || !UUID.test(connectionId)) return { error: 'Informe uma conexão Meta válida.' }
  const config = backendConfig()
  if (!config) return { error: 'A central não está conectada ao backend seguro.' }
  let response
  try {
    response = await fetch(`${config.base}/v1/readiness/${encodeURIComponent(connectionId)}/smoke-test`, {
      method: 'POST', headers: config.headers, body: JSON.stringify({ tenantId }), cache: 'no-store',
      signal: globalThis.AbortSignal.timeout(20000),
    })
  } catch { return { error: 'O smoke test não pôde ser executado. Nenhum resultado foi assumido.' } }
  if (response.status === 401 || response.status === 403) return { error: 'Seu acesso não permite validar esta conexão.' }
  if (!response.ok) return { error: 'O smoke test foi bloqueado pelo backend.' }
  let report
  try { report = await response.json() } catch { return { error: 'O backend não retornou um relatório válido.' } }
  if (!validReadOnlySmokeReport(report, tenantId, connectionId)) return { error: 'O relatório de smoke foi recusado por inconsistência.' }
  return { report }
}
