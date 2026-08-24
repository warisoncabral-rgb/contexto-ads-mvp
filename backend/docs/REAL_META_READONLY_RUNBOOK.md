# Runbook — primeiro smoke real Meta (somente leitura)

Este runbook prepara o ambiente para o primeiro teste real sem habilitar escrita externa.

## 1. Pré-condições

- PostgreSQL acessível pelo backend.
- `CREDENTIAL_VAULT_PROVIDER=postgres`.
- chave mestra do cofre com 32 bytes, mantida somente no ambiente protegido da hospedagem.
- app Meta real com App ID e App Secret.
- redirect OAuth exatamente igual ao configurado no app Meta; em produção deve usar HTTPS.
- identidade bootstrap do operador configurada com sujeito e apenas o digest SHA-256 do token.
- permissões Meta de leitura necessárias ao fluxo real aprovadas para o app/usuário aplicável.

## 2. Gate local de configuração

Execute no ambiente que hospedará o backend:

```bash
cd backend
npm run preflight:real-meta-env
```

O comando nunca imprime valores de segredo e não faz chamadas externas. `readOnlyEnvironmentReady=true` significa apenas que a configuração local mínima está estruturalmente presente.

Ele **não** significa que OAuth funcionou, que permissões Meta foram concedidas ou que escrita está autorizada.

## 3. Ordem do smoke real

1. iniciar uma conexão Meta para um tenant autorizado;
2. iniciar OAuth para a conexão;
3. concluir o callback usando o `state` emitido pelo backend;
4. confirmar que a conexão ficou `connected` sem expor `credentialRef` ao navegador;
5. executar descoberta de ativos;
6. validar capacidades/permissões reais;
7. ler uma conta de anúncios que tenha sido descoberta no mesmo tenant;
8. executar o smoke orquestrado de leitura e preservar o relatório persistido.

## 4. Critérios de aprovação

O smoke só é aprovado quando identidade, OAuth, cofre, descoberta, capacidades e leitura da conta funcionarem no tenant correto e as evidências persistidas forem coerentes.

Qualquer falha interrompe o fluxo. Não substituir evidência ausente por dado manual ou simulado.

## 5. Limite absoluto

Este runbook termina antes de qualquer criação ou alteração na Meta. O adapter de escrita continua ausente e o protocolo controlado de escrita permanece um gate posterior, separado, com autorização curta, Kill Switch e objetos obrigatoriamente `PAUSED`.
