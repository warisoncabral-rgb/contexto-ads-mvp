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

## 1. Criar o Blueprint no Render

1. Conectar o repositório ao Render.
2. Criar um Blueprint a partir do `render.yaml`.
3. Confirmar o provisionamento sem informar segredos manualmente.

O Render gera `OPERATOR_BOOTSTRAP_TOKEN` com 256 bits na API e referencia esse
mesmo valor no painel como `CONTEXT_ADS_OPERATOR_TOKEN`. O backend deriva o
SHA-256 somente em memória antes da comparação em tempo constante. O valor não
entra no Git, no PostgreSQL, nas respostas ou na auditoria.

A API deriva automaticamente seu callback HTTPS do hostname público fornecido pelo Render. Após o primeiro deploy, copiar o endereço exibido pela API e acrescentar:

```text
/v1/meta/oauth/callback
```

Exemplo estrutural:

```text
https://<hostname-real-da-api>/v1/meta/oauth/callback
```

## 2. Configurar a Meta

No aplicativo Meta usado para o teste:

1. Ativar o produto de Login aplicável ao fluxo.
2. Cadastrar a URL acima exatamente em **Valid OAuth Redirect URIs**.
3. Adicionar `META_APP_ID` e `META_APP_SECRET` somente ao ambiente do serviço
   `contexto-ads-validation-api` no Render.
4. Manter a mesma versão da Graph API configurada no ambiente.
5. Confirmar que o usuário do teste possui acesso ao app e aos ativos que serão apenas lidos.

O endereço precisa coincidir exatamente com o enviado no início do OAuth. Não adicionar barra final, parâmetros ou outro subdomínio.

## 3. Executar a prova

1. Abrir `https://<hostname-real-do-painel>/integrations/meta`.
2. Selecionar **Rosa VIP Calçados**.
3. Clicar em **Continuar para a Meta**.
4. Autorizar as permissões de leitura.
5. Confirmar que o callback responde `status: connected` e um `connectionId`.
6. Voltar ao painel e executar a descoberta somente leitura.

## Critérios de aprovação

- Healthcheck da API responde com banco alcançável.
- Migrações 001–020 aparecem como verificadas no log de inicialização.
- URL de autorização aponta somente para `https://www.facebook.com`.
- Callback aceita o `state` uma vez e rejeita repetição.
- Banco não contém access token em texto puro.
- Conexão muda para `connected` somente após troca real do código e gravação no cofre.
- Nenhuma chamada de escrita, publicação ou alteração de orçamento é executada.

## Evidência hospedada concluída em 25/08/2026

- OAuth real concluído após a correção de concorrência do `state`.
- Smoke test somente leitura aprovado nas quatro etapas.
- Conta de anúncios `Warison Cabral` selecionada internamente.
- Contexto Rosa VIP atualizado para Leads → WhatsApp, Recife e Natal,
  R$ 10/dia por 30 dias, teto máximo de R$ 300.
- Plano A0 gerado com objetos pausados e escrita externa bloqueada.
- O fluxo não cria, publica, ativa ou entrega anúncios.

## Gate seguinte

O pacote criativo v2 e o plano com teto de R$ 300 foram aprovados em 26/08/2026.
O painel agora oferece uma validação de capacidades para execução que consulta
somente `/me/permissions` e o snapshot interno de ativos. Ela não solicita escopos,
não muda permissões e não realiza escrita externa.

O manifesto permanece indisponível enquanto `ads_management`, a conta de anúncios e
os ativos selecionados para Click-to-WhatsApp não tiverem evidência suficiente. A
criação controlada na Meta continua fora deste ambiente até autorização humana
específica para qualquer mudança de permissão e para qualquer tentativa externa.
