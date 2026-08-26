'use client'

import { useActionState } from 'react'
import { changeCreativePackage } from './actions'

function Hidden({ plan, action }) {
  return <>{['tenantId', 'campaignId', 'executionPlanId'].map((key) =>
    <input key={key} type="hidden" name={key} value={plan[key]} />)}
  <input type="hidden" name="creativeAction" value={action} /></>
}

function VariantFields({ index }) {
  const suffix = index === 1 ? '' : `_${index}`
  const required = index === 1
  return <fieldset className="creative-variant">
    <legend>Anúncio {index}{required ? ' · obrigatório' : ' · variação adicional'}</legend>
    <label className="wide">Texto principal
      <textarea name={`primaryText${suffix}`} required={required} maxLength="2200" />
    </label>
    <label>Título<input name={`headline${suffix}`} required={required} maxLength="255" /></label>
    <label>Descrição opcional<input name={`description${suffix}`} maxLength="500" /></label>
    <label>CTA<select name={`callToAction${suffix}`} defaultValue={required ? 'SEND_WHATSAPP_MESSAGE' : ''}>
      {!required && <option value="">Não usar esta variação</option>}
      <option value="SEND_WHATSAPP_MESSAGE">Enviar mensagem no WhatsApp</option>
      <option value="LEARN_MORE">Saiba mais</option><option value="SHOP_NOW">Comprar agora</option>
      <option value="SIGN_UP">Cadastre-se</option><option value="CONTACT_US">Fale conosco</option>
    </select></label>
    <label>Tipo da mídia<select name={`mimeType${suffix}`} defaultValue={required ? 'image/jpeg' : ''}>
      {!required && <option value="">Selecione ao preencher</option>}
      <option value="image/jpeg">Imagem JPEG</option><option value="image/png">Imagem PNG</option>
      <option value="video/mp4">Vídeo MP4</option></select></label>
    <label className="wide">Referência segura da mídia
      <input name={`storageRef${suffix}`} required={required} placeholder={`media/tenant/campaign/anuncio-${index}`} />
    </label>
    <label className="wide">SHA-256 do arquivo
      <input name={`sha256${suffix}`} required={required} pattern="[0-9a-f]{64}" placeholder="64 caracteres hexadecimais" />
    </label>
    <label>Largura em pixels<input name={`width${suffix}`} type="number" min="1" required={required} /></label>
    <label>Altura em pixels<input name={`height${suffix}`} type="number" min="1" required={required} /></label>
  </fieldset>
}

export default function CreativeMediaCenter({ plan, role, result }) {
  const [state, formAction, pending] = useActionState(changeCreativePackage, { error: '' })
  const creative = result.kind === 'ready' ? result.creativePackage : null
  const canEdit = ['owner', 'operator'].includes(role), canApprove = role === 'owner'
  return <section className="panel creative-center">
    <div className="section-heading"><div><span className="eyebrow">Central de Mídias</span>
      <h3>Conteúdo criativo versionado</h3></div>{creative &&
      <span className={`status-pill status-${creative.status}`}>v{creative.version} · {creative.status === 'approved' ? 'Aprovado' : 'Em revisão'}</span>}</div>
    <p className="creative-boundary">Cada texto é pareado pela ordem com uma mídia. Tudo permanece interno e pausado; esta etapa não envia arquivos nem acessa a Meta.</p>
    {creative && <div className="creative-variant-summary">
      {creative.copies.map((copy, index) => <article key={copy.copyId}>
        <span>Anúncio {index + 1}</span><strong>{copy.headline}</strong><p>{copy.primaryText}</p>
        <small>{creative.assets[index]?.mimeType} · {creative.assets[index]?.width}×{creative.assets[index]?.height}</small>
      </article>)}
      <div className="creative-hash"><span>Hash criativo</span>
        <strong title={creative.contentHash}>{creative.contentHash.slice(0, 12)}…{creative.contentHash.slice(-8)}</strong></div>
    </div>}
    {creative?.validationIssues.length > 0 && <div className="form-error">Pendências: {creative.validationIssues.join(' · ')}</div>}
    {creative?.status === 'needs_review' && canApprove && creative.validationIssues.length === 0 &&
      <form action={formAction} className="creative-approve-form"><Hidden plan={plan} action="approve" />
        <input type="hidden" name="version" value={creative.version} />
        <input type="hidden" name="contentHash" value={creative.contentHash} />
        <button disabled={pending}>Aprovar este hash criativo</button></form>}
    {canEdit && <details className="creative-form-shell" open={!creative}>
      <summary>{creative ? 'Criar nova versão' : 'Cadastrar criativos da campanha'}</summary>
      <form action={formAction} className="creative-form creative-variants-form">
        <Hidden plan={plan} action="create" />
        {[1, 2, 3].map((index) => <VariantFields key={index} index={index} />)}
        <label className="wide">Alegação opcional<input name="claimText" placeholder="Ex.: pedido mínimo de R$ 500" /></label>
        <label className="wide">Fonte da alegação<input name="claimSource" placeholder="Ex.: campaign_context:offer" /></label>
        <fieldset className="wide creative-checklist"><legend>Checklist obrigatório para aprovação</legend>
          {[['claimsVerifiedAgainstSources','Alegações conferidas com as fontes'],['visualFidelityReviewed','Fidelidade visual revisada'],['safeAreaReviewed','Área segura revisada'],['requiredFieldsReviewed','Campos obrigatórios revisados'],['automaticEnhancementsReviewed','Melhorias automáticas revisadas']].map(([name,label]) =>
            <label key={name}><input type="checkbox" name={name} />{label}</label>)}</fieldset>
        <button className="wide" disabled={pending}>{pending ? 'Salvando versão…' : 'Salvar pacote com até 3 anúncios'}</button>
      </form></details>}
    {!canEdit && <p className="readonly-note">Seu papel permite acompanhar, mas não alterar o criativo.</p>}
    {state.error && <div className="form-error" role="alert">{state.error}</div>}
  </section>
}
