# OAuth Return Flow

## Objetivo
Depois de a Meta concluir o OAuth no callback do backend, retornar o navegador à Central sem aceitar qualquer destino controlado por request.

## Fluxo
1. A Central inicia OAuth em perfil `read_only`.
2. A Meta retorna exclusivamente a `META_OAUTH_REDIRECT_URI` do backend.
3. O backend consome o `state` de uso único e troca o code.
4. A credencial é persistida no cofre e a conexão vira `connected`.
5. O callback monta o destino usando somente `CONTEXT_ADS_FRONTEND_BASE_URL` configurado no servidor.
6. O navegador recebe HTTP 303 para `/connections?oauth=connected&connectionId=...`.
7. A Central pode então executar o smoke somente leitura.

## Segurança
- nenhum parâmetro `returnTo`, `redirect` ou origem enviado pelo browser é aceito;
- produção exige HTTPS no frontend;
- HTTP é aceito somente para localhost/loopback em desenvolvimento;
- usuário/senha, query e fragment na base configurada são recusados;
- callback continua protegido pelo `state` OAuth de uso único;
- esse retorno não autoriza escrita, publicação, ativação ou entrega.
