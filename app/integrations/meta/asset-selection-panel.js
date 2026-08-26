'use client'

import { useActionState } from 'react'
import { selectMetaAssets } from '../../actions.js'

const typeLabels = {
  business: 'Portfólio empresarial',
  ad_account: 'Conta de anúncios',
  facebook_page: 'Página do Facebook',
  instagram_account: 'Conta do Instagram',
  whatsapp: 'WhatsApp',
}

export default function MetaAssetSelectionPanel({ tenantId, connectionId, assets }) {
  const [state, action, pending] = useActionState(selectMetaAssets, {
    error: '', selectedAssets: [],
  })
  const groups = Object.entries(assets.reduce((result, asset) => ({
    ...result,
    [asset.assetType]: [...(result[asset.assetType] || []), asset],
  }), {}))
  const confirmed = state.selectedAssets.length > 0

  return <section className="panel meta-assets-card">
    <span className="eyebrow">Vínculo interno seguro</span>
    <h2>{confirmed ? 'Ativos vinculados.' : 'Selecionar ativos da Rosa VIP'}</h2>
    <p>A seleção grava somente quais ativos descobertos o sistema poderá usar como alvo. Nada será alterado na Meta.</p>
    {assets.length === 0
      ? <p className="empty-copy">Execute primeiro a validação somente leitura para descobrir os ativos disponíveis.</p>
      : <form action={action}>
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="connectionId" value={connectionId} />
        <div className="meta-asset-groups">{groups.map(([assetType, options]) =>
          <fieldset key={assetType}>
            <legend>{typeLabels[assetType]}</legend>
            {options.map((asset, index) => <label key={asset.externalId}>
              <input
                type="radio"
                name={`asset_${assetType}`}
                value={asset.externalId}
                required={assetType === 'ad_account'}
                defaultChecked={asset.selected || (!options.some((item) => item.selected) && options.length === 1 && index === 0)}
              />
              <span><strong>{asset.displayName || typeLabels[assetType]}</strong><small>{asset.externalId}</small></span>
            </label>)}
            {assetType !== 'ad_account' && <label>
              <input
                type="radio"
                name={`asset_${assetType}`}
                value=""
                defaultChecked={!options.some((item) => item.selected) && options.length > 1}
              />
              <span><strong>Não vincular agora</strong><small>Este tipo poderá ser escolhido depois.</small></span>
            </label>}
          </fieldset>)}</div>
        <button className="primary-button" disabled={pending}>
          {pending ? 'Confirmando vínculo…' : confirmed ? 'Atualizar seleção' : 'Confirmar ativos selecionados'}
        </button>
      </form>}
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    {confirmed && <p className="asset-selection-success" role="status">
      Seleção confirmada. Nenhuma campanha foi criada e nenhuma alteração foi feita na Meta.
    </p>}
  </section>
}
