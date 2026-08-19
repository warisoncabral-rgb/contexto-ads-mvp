# Status de implementação

## Concluído nesta fundação
- Stack e estrutura modular inicial.
- Contratos TypeScript: ExecutionPlan, ExecutionRecord, Approval, AuditEvent, Capability Registry, MetaConnection e ReadinessSnapshot.
- Porta `MetaAdapterPort` somente leitura.
- Adapter Meta em modo fail-closed: não executa nada sem configuração real.
- Endpoint inicial `POST /v1/meta/connections/start`.
- Endpoint de prontidão `GET /v1/readiness/:connectionId?tenantId=...`.
- Migração PostgreSQL inicial para conexão, bindings, capabilities, auditoria e prontidão.
- Separação explícita de credenciais via `CredentialVaultPort`.

## Próximos itens que dependem de ambiente real
1. Criar o app Meta real e definir o fluxo oficial de OAuth/onboarding.
2. Validar permissões e App Review aplicáveis ao caso multi-cliente.
3. Implementar um Credential Vault real no provedor de hospedagem escolhido.
4. Implementar persistência PostgreSQL concreta dos repositórios.
5. Implementar `discoverAssets`, `validateCapabilities` e `readAdAccount` contra a Graph/Marketing API vigente.
6. Rodar o primeiro teste real somente leitura.

## Trava de segurança
Nenhuma função de criação, alteração, pausa, ativação ou publicação na Meta foi implementada nesta fundação.
