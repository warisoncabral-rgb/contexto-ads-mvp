# ADR-001 — Stack inicial

## Decisão
- Runtime: Node.js 24 LTS.
- Linguagem: TypeScript.
- Backend: NestJS em modular monolith.
- Banco: PostgreSQL 18.
- Cliente SQL inicial: node-postgres (`pg`).
- Integrações externas: adapters isolados.
- Segredos: interface `CredentialVaultPort`; provedor real será escolhido no deploy.

## Por quê
A arquitetura exige módulos claros, contratos fortes, multi-tenant, auditoria e integração assíncrona progressiva. Um modular monolith reduz complexidade operacional no início sem impedir extração futura de serviços.

## Não adotado agora
- Microservices: prematuro para a Fase 1.
- Redis/queue: só entra quando o Orchestrator assíncrono exigir.
- Frontend: fora do primeiro vertical; primeiro provar leitura segura da Meta.
- Escrita na Meta: bloqueada nesta fase.
