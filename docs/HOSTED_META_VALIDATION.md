# Validação hospedada do OAuth Meta

Este ambiente existe para comprovar o fluxo real **Connect → OAuth → Vault → Discover**, sem publicar campanhas e sem habilitar escrita externa.

## Arquitetura do teste

- Painel Next.js em HTTPS.
- API NestJS em HTTPS.
- PostgreSQL 18 privado, com migrações verificadas por checksum.
- Token Meta criptografado com AES-256-GCM; a chave do cofre fica somente no ambiente da API.
- Rotas que iniciam OAuth e descoberta protegidas por identidade e membership do operador.
- Callback OAuth público apenas para receber o retorno da Meta, com `state` curto, único e consumido uma vez.

O `render.yaml` provisiona os três recursos no Render. O plano gratuito é adequado somente para esta validação inicial: serviços podem entrar em repouso e o banco gratuito expira depois de 30 dias.

## 1. Gerar o par de acesso do operador

Execute uma única vez, em ambiente local seguro:

```bash
npm run deployment:secrets
```

O comando produz dois valores relacionados:

- `CONTEXT_ADS_OPERATOR_TOKEN`: informar somente ao serviço `contexto-ads-validation-panel`.
- `OPERATOR_BOOTSTRAP_TOKEN_SHA256`: informar somente ao serviço `contexto-ads-validation-api`.

Não salvar esses valores no Git, em documentos ou em mensagens.

## 2. Criar o Blueprint no Render

1. Conectar o repositório ao Render.
2. Criar um Blueprint a partir do `render.yaml`.
3. Informar os quatro campos protegidos solicitados:
   - `META_APP_ID` da API.
   - `META_APP_SECRET` da API.
   - `OPERATOR_BOOTSTRAP_TOKEN_SHA256` da API.
   - `CONTEXT_ADS_OPERATOR_TOKEN` do painel.
4. Confirmar o provisionamento.

A API deriva automaticamente seu callback HTTPS do hostname público fornecido pelo Render. Após o primeiro deploy, copiar o endereço exibido pela API e acrescentar:

```text
/v1/meta/oauth/callback
```

Exemplo estrutural:

```text
https://<hostname-real-da-api>/v1/meta/oauth/callback
```

## 3. Configurar a Meta

No aplicativo Meta usado para o teste:

1. Ativar o produto de Login aplicável ao fluxo.
2. Cadastrar a URL acima exatamente em **Valid OAuth Redirect URIs**.
3. Manter a mesma versão da Graph API configurada no ambiente.
4. Confirmar que o usuário do teste possui acesso ao app e aos ativos que serão apenas lidos.

O endereço precisa coincidir exatamente com o enviado no início do OAuth. Não adicionar barra final, parâmetros ou outro subdomínio.

## 4. Executar a prova

1. Abrir `https://<hostname-real-do-painel>/integrations/meta`.
2. Selecionar **Rosa VIP Calçados**.
3. Clicar em **Continuar para a Meta**.
4. Autorizar as permissões de leitura.
5. Confirmar que o callback responde `status: connected` e um `connectionId`.
6. Voltar ao painel e executar a descoberta somente leitura.

## Critérios de aprovação

- Healthcheck da API responde com banco alcançável.
- Migrações 001–019 aparecem como verificadas no log de inicialização.
- URL de autorização aponta somente para `https://www.facebook.com`.
- Callback aceita o `state` uma vez e rejeita repetição.
- Banco não contém access token em texto puro.
- Conexão muda para `connected` somente após troca real do código e gravação no cofre.
- Nenhuma chamada de escrita, publicação ou alteração de orçamento é executada.
