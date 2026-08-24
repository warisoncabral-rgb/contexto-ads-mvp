# Auditoria de prontidão para produção

Data de referência: 2026-08-24

## Escopo auditado

Esta auditoria considera o release candidate cumulativo que contém a pilha de produto iniciada no PR #25 e estendida até o PR #73. O objetivo é separar claramente prontidão interna, integração no branch principal e validações que dependem de ambiente externo real.

## Estado interno comprovado

- Fluxos de contexto, plano, criativo, aprovação, prontidão, manifesto, autorização curta, preflight, Kill Switch e protocolo de validação estão modelados e protegidos por identidade/membership.
- Central Operacional, portfólio, fila diária, snapshots, mudanças e visões de observabilidade são derivadas de estado persistido e permanecem fail-closed.
- PostgreSQL é a opção de cofre funcional para o MVP; Google Secret Manager permanece opcional e desacoplado pela porta de cofre.
- Nenhuma publicação, ativação, entrega ou escrita Meta está habilitada pelo release candidate.
- O adapter de escrita real continua ausente por decisão de segurança.

## Gates de integração

### G1 — Release candidate cumulativo
Status: em validação.

O release candidate deve ser comparado diretamente com `main` para executar os workflows de frontend e backend/PostgreSQL sobre o conjunto cumulativo, em vez de depender apenas dos checks isolados dos PRs empilhados.

### G2 — Frontend
Requisitos:
- `npm ci`
- `npm test`
- `npm run build`

### G3 — Backend + PostgreSQL 18
Requisitos:
- migrações completas, incluindo 017, 018 e 019;
- `npm ci`
- `npm test`
- `npm run build`

### G4 — Integração no branch principal
Status: bloqueado até decisão humana de merge.

Todos os PRs empilhados permanecem draft. Nenhum check verde equivale a autorização para merge automático.

## Gates externos ainda obrigatórios

### E1 — Ambiente Meta real
- criar/configurar app Meta real;
- registrar redirect OAuth real;
- comprovar permissões de leitura necessárias;
- validar `ads_management` somente no momento do protocolo controlado de escrita;
- confirmar App Review aplicável ao modelo multi-cliente.

### E2 — Segredos de produção
- definir chave mestra do cofre PostgreSQL em configuração protegida da hospedagem;
- nunca persistir a chave mestra no Git ou no banco;
- Google Secret Manager pode ser validado posteriormente, mas não bloqueia o MVP baseado no cofre PostgreSQL.

### E3 — Smoke real somente leitura
Executar identidade → descoberta → capacidades → leitura de conta e persistir o relatório de evidência aprovado.

### E4 — Primeiro teste controlado de escrita
Somente depois de E1–E3 e de autorização humana específica:
- usar o protocolo persistido;
- limitar o teste aos objetos previstos e `PAUSED`;
- coletar as onze evidências reais;
- reconciliar estado observado antes de qualquer retry;
- comprovar entrega zero;
- não ativar campanha nem aumentar orçamento.

## O que não deve ser feito nesta fase

- não habilitar escrita Meta antes dos gates externos;
- não transformar aprovação de plano em autorização de execução;
- não transformar autorização curta em permissão efetiva isoladamente;
- não simular métricas ou evidências externas;
- não fazer merge automático da pilha;
- não considerar checks isolados dos PRs empilhados como substitutos do CI cumulativo contra `main`.

## Critério de saída

O software pode ser considerado internamente pronto para a etapa de validação externa quando o release candidate cumulativo passar simultaneamente nos workflows de frontend e backend/PostgreSQL contra `main`.

Prontidão de produção com execução Meta exige, além disso, E1–E4 concluídos com evidência real. Até lá, o estado correto permanece: produto operacional interno validado, execução externa bloqueada.
