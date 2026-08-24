'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { saveCampaignContext } from '../actions'

const fieldLabels = {
  businessName: 'Nome do negócio',
  offer: 'Produto ou serviço',
  objective: 'Objetivo',
  audience: 'Público',
  destination: 'Destino',
  geography: 'Localização',
  budget: 'Orçamento',
  durationDays: 'Duração',
}

function SubmitButton({ isUpdate }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Salvando com segurança…' : isUpdate ? 'Salvar nova versão' : 'Salvar progresso'}
    </button>
  )
}

function value(context, field) {
  return context?.facts?.[field]?.value ?? ''
}

export default function CampaignContextForm({ tenantId, context, canEdit }) {
  const [state, action] = useActionState(saveCampaignContext, { error: '', values: {} })
  const budget = value(context, 'budget')
  const defaults = state.values ?? {}
  const input = (field) => defaults[field] ?? value(context, field)

  return (
    <div className="preparation-layout">
      <form className="campaign-form" action={action}>
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="campaignId" value={context?.campaignId ?? ''} />
        <div className="form-heading">
          <div>
            <span className="eyebrow">Contexto confirmado pelo operador</span>
            <h2>{context ? 'Atualizar preparação' : 'Preparar nova campanha'}</h2>
          </div>
          {context && <span className="version-badge">Versão {context.version}</span>}
        </div>
        <p className="form-intro">Preencha somente o que você sabe. Campos vazios viram tarefas claras; o sistema não inventa respostas.</p>
        {state.error && <div className="form-error" role="alert">{state.error}</div>}
        <div className="form-grid">
          <label>Nome do negócio
            <input name="businessName" maxLength="160" defaultValue={input('businessName')} disabled={!canEdit} />
          </label>
          <label>Objetivo principal
            <select name="objective" defaultValue={input('objective')} disabled={!canEdit}>
              <option value="">Selecione</option>
              <option value="awareness">Reconhecimento</option>
              <option value="traffic">Tráfego</option>
              <option value="engagement">Engajamento</option>
              <option value="leads">Conversas e contatos</option>
              <option value="app_promotion">Instalações do aplicativo</option>
              <option value="sales">Vendas</option>
            </select>
          </label>
          <label className="wide">O que será anunciado
            <textarea name="offer" maxLength="2000" rows="4" defaultValue={input('offer')} disabled={!canEdit} />
          </label>
          <label className="wide">Para quem é a campanha
            <textarea name="audience" maxLength="2000" rows="4" defaultValue={input('audience')} disabled={!canEdit} />
          </label>
          <label>Destino da pessoa interessada
            <select name="destination" defaultValue={input('destination')} disabled={!canEdit}>
              <option value="">Selecione</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="website">Site</option>
              <option value="messenger">Messenger</option>
              <option value="instant_form">Formulário</option>
              <option value="phone">Telefone</option>
              <option value="physical_location">Local físico</option>
              <option value="app">Aplicativo</option>
              <option value="other">Outro</option>
            </select>
          </label>
          <label>Onde anunciar
            <input name="geography" maxLength="500" defaultValue={input('geography')} placeholder="Ex.: Recife e região" disabled={!canEdit} />
          </label>
          <label>Tipo de orçamento
            <select name="budgetMode" defaultValue={defaults.budgetMode ?? budget?.mode ?? ''} disabled={!canEdit}>
              <option value="">Selecione</option>
              <option value="daily">Por dia</option>
              <option value="lifetime">Total da campanha</option>
            </select>
          </label>
          <label>Valor em reais
            <input name="budgetAmount" inputMode="decimal" defaultValue={defaults.budgetAmount ?? (budget ? (budget.amountMinor / 100).toFixed(2).replace('.', ',') : '')} placeholder="Ex.: 12,00" disabled={!canEdit} />
          </label>
          <label>Duração em dias
            <input name="durationDays" inputMode="numeric" defaultValue={input('durationDays')} placeholder="Ex.: 7" disabled={!canEdit} />
          </label>
        </div>
        {canEdit
          ? <SubmitButton isUpdate={Boolean(context)} />
          : <div className="readonly-note">Seu papel permite consultar, mas não alterar a preparação.</div>}
        <small className="form-boundary">Salvar cria uma versão interna. Não publica, ativa nem entrega anúncios.</small>
      </form>

      <aside className="task-panel">
        <span className="eyebrow">Tarefas da preparação</span>
        <h3>{context?.validationIssues?.length
          ? `${context.validationIssues.length} informação(ões) pendente(s)`
          : context ? 'Contexto completo' : 'Comece com o que já sabe'}</h3>
        {context?.validationIssues?.length ? (
          <ol>
            {context.validationIssues.map((issue) => (
              <li key={issue.field}>
                <strong>{fieldLabels[issue.field]}</strong>
                <span>{issue.nextAction}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p>{context
            ? 'Todos os fatos obrigatórios foram informados. O próximo bloco poderá gerar o plano lógico para revisão.'
            : 'Você pode salvar um rascunho incompleto. A central mostrará exatamente o que falta.'}</p>
        )}
      </aside>
    </div>
  )
}
