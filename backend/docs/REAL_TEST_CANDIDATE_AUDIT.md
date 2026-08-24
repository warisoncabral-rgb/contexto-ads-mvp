# Auditoria do candidato ao primeiro teste real

## Escopo interno concluído

- release candidate cumulativo validado contra `main`;
- configuração do ambiente real verificável sem expor segredos;
- conexão Meta, OAuth start, capacidades, readiness e smoke protegidos por autenticação + membership owner;
- callback OAuth continua state-bound e de uso único;
- OAuth de primeiro teste permanece `read_only` por default;
- `ads_management` existe somente em perfil explícito de validação controlada e não autoriza escrita;
- Central possui fluxo para iniciar conexão real e executar o smoke de quatro etapas;
- escrita/publicação/ativação/entrega permanecem desabilitadas.

## O que ainda depende de ambiente real

1. App Meta real e redirect HTTPS configurados.
2. App ID/App Secret presentes somente no ambiente protegido.
3. Permissões read-only aplicáveis concedidas ao usuário/app do teste.
4. PostgreSQL e chave mestra do cofre configurados na hospedagem.
5. Token bootstrap do operador e membership owner do tenant de teste.
6. Execução de `npm run preflight:real-meta-env` no ambiente real.
7. Consentimento OAuth real.
8. Smoke real de identidade → descoberta → capacidades → leitura de conta.

## Gate posterior, não incluído no primeiro teste

A criação controlada em `PAUSED` exige outra fase: `ads_management`, adapter mínimo de escrita, manifesto exato, autorização curta, preflight, Kill Switch, protocolo de onze evidências e reconciliação. Nenhum desses requisitos é dispensado por um smoke read-only aprovado.
