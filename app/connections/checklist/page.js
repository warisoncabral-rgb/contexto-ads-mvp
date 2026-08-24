import { summarizeRealMetaSetupChecklist } from '../../../lib/real-meta-setup-checklist.mjs'

export default function RealMetaChecklistPage() {
  const checklist = summarizeRealMetaSetupChecklist()
  return <><header className="topbar"><a className="brand" href="/"><span className="brand-mark">C</span><span><strong>Contexto Ads</strong><small>Checklist Meta real</small></span></a><a href="/connections">Conexão Meta</a></header><main className="work-shell">
    <section className="work-hero"><div><span className="eyebrow">Preparação externa</span><h1>O que precisa existir para executar o primeiro smoke real.</h1><p>Esta lista não contém segredos e separa o teste somente leitura da futura validação controlada de escrita.</p></div></section>
    <section><h2>Obrigatório para o smoke somente leitura</h2><div className="work-list">{checklist.readOnlySmoke.map((item) => <article className="work-item" key={item.key}><div className="work-item-head"><div><h3>{item.title}</h3></div></div><p>{item.detail}</p></article>)}</div></section>
    <section><h2>Somente depois do smoke aprovado</h2><div className="work-list">{checklist.controlledWriteLater.map((item) => <article className="work-item" key={item.key}><div className="work-item-head"><div><h3>{item.title}</h3></div></div><p>{item.detail}</p></article>)}</div></section>
    <div className="portfolio-boundary">`ads_management` não é requisito do primeiro smoke. Esta página não armazena credenciais e não habilita escrita externa.</div>
  </main></>
}
