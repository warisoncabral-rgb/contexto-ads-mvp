'use client'

import { useActionState } from 'react'
import { beginMetaConnection } from './actions'

export default function MetaConnectionForm({ tenantId }) {
  const [state, action, pending] = useActionState(beginMetaConnection, {})
  return <form action={action} className="preparation-form">
    <input type="hidden" name="tenantId" value={tenantId} />
    <div className="portfolio-boundary">O primeiro fluxo solicita somente public_profile, ads_read e pages_show_list. Nenhuma escrita é autorizada.</div>
    {state?.error && <p role="alert">{state.error}</p>}
    <button type="submit" disabled={pending}>{pending ? 'Preparando OAuth…' : 'Conectar Meta em modo leitura'}</button>
  </form>
}
