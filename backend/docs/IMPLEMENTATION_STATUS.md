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
- Cofre PostgreSQL com AES-256-GCM, isolamento por tenant e revogação lógica.
- CI com PostgreSQL 18 real para migrações, concorrência OAuth e cofre criptografado.
- Persistência transacional de snapshots de ativos com isolamento por tenant no serviço e no banco.
- Endpoints preparados para descobrir e listar ativos sem expor `credentialRef`.
- Capability Registry persistente, transacional e protegido por tenant no banco.
- Endpoint tenant-scoped para consultar evidências de capacidade.
- Cliente Graph somente leitura para validar identidade, descobrir contas de anúncio e páginas e ler dados básicos de conta.
- Tokens resolvidos pelo cofre por tenant, enviados apenas no header e protegidos com `appsecret_proof`.
- Endpoint tenant-scoped que lê somente contas de anúncio presentes no snapshot de descoberta da conexão.

## Próximos itens que dependem de ambiente real
1. Criar o app Meta real, registrar o redirect OAuth e habilitar `ads_read` e `pages_show_list`.
2. Validar permissões e App Review aplicáveis ao caso multi-cliente.
3. Guardar a chave mestra do cofre nas configurações protegidas da hospedagem.
4. Ligar evidências reais ao `validateCapabilities` contra a versão vigente.
5. Rodar o primeiro teste real somente leitura.

## Evolução opcional do cofre
O PostgreSQL criptografado desbloqueia o MVP sem Google Cloud. A porta
`CredentialVaultPort` permanece independente do provedor, permitindo migrar
posteriormente para Google Secret Manager ou outro cofre gerenciado sem alterar
o fluxo OAuth ou os serviços de negócio.

## Trava de segurança
Nenhuma função de criação, alteração, pausa, ativação ou publicação na Meta foi implementada nesta fundação.
