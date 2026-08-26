export const metadata = {
  title: 'Política de Privacidade — Contexto Ads',
  description: 'Política de privacidade do aplicativo Contexto Ads.',
}

export default function PrivacyPolicyPage() {
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
        <span className="eyebrow">Transparência e proteção de dados</span>
        <h1>Política de Privacidade</h1>
        <p className="legal-updated">Última atualização: 26 de agosto de 2026</p>

        <p>
          O Contexto Ads é uma ferramenta de apoio à preparação, validação e operação
          controlada de campanhas publicitárias. Esta política explica quais dados são
          tratados, para quais finalidades e quais controles estão disponíveis ao usuário.
        </p>

        <h2>1. Dados tratados</h2>
        <p>Quando o usuário conecta uma conta da Meta, o Contexto Ads pode tratar:</p>
        <ul>
          <li>identificadores da conta e do usuário autorizado;</li>
          <li>identificadores de contas de anúncios, Páginas e ativos do WhatsApp selecionados;</li>
          <li>permissões concedidas ao aplicativo e estado da conexão;</li>
          <li>configurações, aprovações e registros de auditoria das campanhas;</li>
          <li>credenciais de acesso necessárias à integração, armazenadas somente no servidor.</li>
        </ul>

        <h2>2. Finalidades</h2>
        <p>Os dados são utilizados para:</p>
        <ul>
          <li>autenticar o usuário e conectar os ativos selecionados;</li>
          <li>preparar, validar e executar ações publicitárias expressamente autorizadas;</li>
          <li>manter objetos e campanhas nos estados definidos pelo usuário;</li>
          <li>registrar evidências, decisões e eventos de segurança;</li>
          <li>prevenir duplicações, acessos indevidos e ações não autorizadas.</li>
        </ul>

        <h2>3. Compartilhamento e infraestrutura</h2>
        <p>
          Os dados são enviados à Meta somente quando necessário para as funções autorizadas
          pelo usuário. A infraestrutura de hospedagem e banco de dados pode processar dados
          exclusivamente para manter o serviço disponível e seguro. O Contexto Ads não vende
          dados pessoais.
        </p>

        <h2>4. Segurança e retenção</h2>
        <p>
          Credenciais não são exibidas no navegador e permanecem protegidas no servidor.
          Registros operacionais são mantidos pelo período necessário à segurança,
          rastreabilidade e cumprimento de obrigações aplicáveis. Dados e credenciais podem
          ser eliminados quando a conexão é encerrada ou após solicitação válida do titular,
          ressalvadas obrigações legais de conservação.
        </p>

        <h2>5. Direitos e exclusão de dados</h2>
        <p>
          O usuário pode solicitar acesso, correção, desconexão ou exclusão de seus dados.
          Consulte as <a href="/data-deletion">instruções de exclusão de dados</a> ou envie a
          solicitação para <a href="mailto:warisoncrabal@gmail.com">warisoncrabal@gmail.com</a>.
        </p>

        <h2>6. Contato</h2>
        <p>
          Dúvidas sobre esta política ou sobre o tratamento de dados podem ser enviadas para
          <a href="mailto:warisoncrabal@gmail.com"> warisoncrabal@gmail.com</a>.
        </p>
      </article>
    </main>
  )
}
