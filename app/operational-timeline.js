const CATEGORY = { context: 'Contexto', plan: 'Plano', creative: 'Criativo', approval: 'Decisão humana', readiness: 'Prontidão', executor: 'Executor', safety: 'Segurança' }
const RESULT = { success: 'Concluído', failure: 'Falhou', blocked: 'Bloqueado', partial: 'Parcial', info: 'Registrado' }

export default function OperationalTimeline({ result }) {
  return <section className="panel timeline-panel">
    <div className="section-heading"><div><span className="eyebrow">Histórico imutável</span><h3>Linha do tempo operacional</h3></div>{result.kind === 'ready' && <span className="count-badge">{result.timeline.items.length}</span>}</div>
    <p className="timeline-boundary">Mostra somente marcos críticos sanitizados. Credenciais, estados brutos e detalhes técnicos sensíveis nunca aparecem aqui.</p>
    {result.kind !== 'ready' && <p className="readonly-note">O histórico não pôde ser confirmado agora. Nenhum estado foi inferido.</p>}
    {result.kind === 'ready' && (result.timeline.items.length ? <div className="timeline-list">{result.timeline.items.map((item) => <article key={item.auditEventId} className={`timeline-item timeline-${item.result}`}><div className="timeline-marker" /><div><div className="timeline-meta"><span>{CATEGORY[item.category]}</span><span>{RESULT[item.result]}</span><time>{new Date(item.createdAt).toLocaleString('pt-BR')}</time></div><h4>{item.title}</h4><p>{item.detail}</p><small>{item.actor} · evidência {item.evidenceRef}</small></div></article>)}</div>
      : <p className="clear-message">Nenhum marco crítico foi registrado para esta campanha ainda.</p>)}
  </section>
}
