# Status de implementação

## Concluído nesta fundação
- Stack e estrutura modular inicial.
- Contratos TypeScript: CampaignContext, ExecutionPlan, ExecutionRecord, Approval, AuditEvent, Capability Registry, MetaConnection e ReadinessSnapshot.
- Porta `MetaAdapterPort` somente leitura.
- Adapter Meta em modo fail-closed: não executa nada sem configuração real.
- Endpoint inicial `POST /v1/meta/connections/start`.
- Diagnóstico dinâmico de prontidão para configuração, cofre, OAuth, ativos e capacidades.
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
- Validação de capacidades via `/me/permissions`, cruzada com ativos descobertos e persistida atomicamente.
- Smoke test orquestrado e fail-closed: identidade → descoberta → capacidades → leitura de conta.
- Evidências tenant-scoped persistidas para snapshots de prontidão e relatórios de smoke test aprovados ou bloqueados.
- Contexto de campanha versionado e imutável, com fatos rastreáveis, hash semântico e isolamento por tenant.
- Validação fail-closed do contexto: dados críticos ausentes viram bloqueios acionáveis e nunca são inferidos silenciosamente.
- Numeração concorrente de versões serializada no PostgreSQL.
- Gerador determinístico de planos lógicos vinculado a uma versão exata do Campaign Context.
- Teto financeiro, riscos, regras aplicadas e justificativas persistidos no próprio plano.
- Idempotência concorrente: a mesma entrada produz e recupera um único plano imutável.
- Objetos lógicos nascem pausados e nenhum plano permite ou executa escrita externa.
- Aprovação humana idempotente vinculada a hash, versão, escopo e teto financeiro exatos.
- Aprovações expiram em 24 horas e são invalidadas quando o plano mais recente muda.
- Aprovação, rejeição, revogação, expiração e invalidação possuem eventos de auditoria.
- Transição de aprovação e auditoria são atômicas: nenhuma decisão fica sem evidência.
- Vínculo do plano aceita somente conta Meta descoberta para a conexão e tenant corretos.
- Mudança do alvo gera novo hash e invalida imediatamente aprovações anteriores.
- Dry-run persistido valida grafo, alvo, capacidades, aprovação, criativo e trava externa.
- Sequência de operações é calculada por dependências e sempre registrada com `willExecute: false`.
- Pacote criativo imutável e versionado, vinculado ao plano e protegido por hash SHA-256.
- Textos, CTA, alegações e mídias são validados por contrato; cada alegação exige referências de origem e cada mídia exige digest próprio.
- Checklist humano cobre fontes, fidelidade visual, área segura, campos obrigatórios e aprimoramentos automáticos.
- Nova versão criativa gera imediatamente um novo plano bloqueado e invalida aprovações anteriores.
- Aprovação criativa aceita somente a versão e o hash mais recentes e produz outro plano imutável ainda em A0.
- O dry-run compara o plano com o pacote criativo aprovado mais recente, impedindo reuso de conteúdo antigo.
- Decisão operacional consolidada refaz o dry-run seguro antes de responder e traduz evidências para linguagem simples.
- Estados de preparação, ambiente Meta, criativo, aprovação, executor, publicação, ativação e entrega são separados explicitamente.
- Cada decisão segue “decisão, por quê e base”, informa o teto financeiro e aponta uma única próxima ação priorizada.
- Decisões semanticamente idênticas são idempotentes, persistidas e auditadas atomicamente.
- Mesmo com todos os controles internos aprovados, o estado máximo é `ready_for_executor_validation`; nunca “publicado”, “ativo” ou “entregando”.
- Manifesto de execução imutável transforma a simulação aprovada em operações ordenadas, pausadas e individualmente identificadas.
- Cada efeito futuro possui chave idempotente, fingerprint da requisição, pré-condições obrigatórias e dependências explícitas.
- Resultado externo incerto bloqueia retries até reconciliação; falha parcial interrompe dependentes e preserva evidências.
- Compensações nunca são automáticas sem política e autorização específicas, e o estado observado na Meta será a fonte de verdade.
- O manifesto permanece `prepared_gate_closed`: aprovação específica de execução, validação real de escrita, adapter e Kill Switch ainda são requisitos ausentes.
- Autorização humana de execução separada da aprovação do plano, vinculada ao ID/hash exatos do manifesto e com validade de apenas 15 minutos.
- Aprovar a autorização não abre o gate: o contrato mantém `effectiveExecutionPermission: false` até todos os demais controles passarem.
- Preflight persistido e idempotente registra controles aprovados e bloqueadores sem criar `ExecutionRecord` ou iniciar tentativa externa.
- Autorização expirada ou referente a manifesto substituído é invalidada fail-closed, com auditoria atômica.

## Próximo bloco interno sem dependência externa
1. Implementar Kill Switch persistente e auditado por tenant e campanha, com ausência tratada como bloqueio.
2. Integrar seu estado ao preflight sem criar uma tentativa externa.
3. Manter o adapter de escrita ausente até validação Meta real e liberação explícita de todos os gates.

## Próximos itens que dependem de ambiente real
1. Criar o app Meta real, registrar o redirect OAuth e habilitar `ads_read` e `pages_show_list`.
2. Validar permissões e App Review aplicáveis ao caso multi-cliente.
3. Guardar a chave mestra do cofre nas configurações protegidas da hospedagem.
4. Acionar o smoke test automatizado e guardar o relatório de aprovação.

## Evolução opcional do cofre
O PostgreSQL criptografado desbloqueia o MVP sem Google Cloud. A porta
`CredentialVaultPort` permanece independente do provedor, permitindo migrar
posteriormente para Google Secret Manager ou outro cofre gerenciado sem alterar
o fluxo OAuth ou os serviços de negócio.

## Trava de segurança
Nenhuma função de criação, alteração, pausa, ativação ou publicação na Meta foi implementada nesta fundação.
