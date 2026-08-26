export const metadata = {
  title: 'Exclusão de Dados — Contexto Ads',
  description: 'Instruções para solicitar a exclusão de dados do Contexto Ads.',
}

export default function DataDeletionPage() {
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">C</span>
          <span><strong>Contexto Ads</strong><small>Central operacional</small></span>
        </a>
        <div className="environment"><span /> Documento público</div>
      </header>

      <article className="legal-page">
        <span className="eyebrow">Controle do usuário</span>
        <h1>Exclusão de Dados</h1>
        <p className="legal-updated">Última atualização: 26 de agosto de 2026</p>

        <p>
          Para solicitar a exclusão dos dados associados à sua conexão com o Contexto Ads,
          envie um e-mail para <a href="mailto:warisoncrabal@gmail.com">warisoncrabal@gmail.com</a>
          com o assunto <strong>“Exclusão de dados — Contexto Ads”</strong>.
        </p>

        <h2>Inclua na solicitação</h2>
        <ul>
          <li>seu nome;</li>
          <li>o e-mail utilizado na conexão;</li>
          <li>o nome da empresa ou conta de anúncios vinculada;</li>
          <li>uma descrição breve do que deseja excluir.</li>
        </ul>

        <h2>O que acontece depois</h2>
        <p>
          A identidade e a legitimidade da solicitação serão verificadas antes da exclusão.
          Após a confirmação, as credenciais da integração serão revogadas e os dados
          vinculados serão eliminados ou anonimizados, ressalvados registros que precisem ser
          preservados por obrigação legal, segurança ou prevenção a fraude.
        </p>

        <p><a href="/privacy">Voltar para a Política de Privacidade</a></p>
      </article>
    </main>
  )
}
