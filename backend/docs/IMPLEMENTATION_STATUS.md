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
- Kill Switch versionado e imutável por tenant e campanha, com mudanças serializadas e auditoria na mesma transação.
- Ausência de estado em qualquer escopo bloqueia fail-closed; switch do tenant acionado prevalece sobre toda campanha.
- Solicitações concorrentes para o mesmo estado retornam uma única versão e não duplicam auditoria.
- O preflight usa evidências exatas dos dois switches; mesmo ambos liberados, validação Meta e adapter continuam bloqueando a tentativa.
- Protocolo de validação controlada imutável e tenant-scoped, vinculado ao manifesto e hashes exatos.
- O protocolo limita o primeiro teste ao conjunto exato de operações pausadas, proíbe ativação, entrega, aumento de orçamento, concorrência e retry automático.
- Onze evidências reais são obrigatórias, incluindo permissão, fingerprints, respostas sanitizadas, IDs externos, estado pausado observado, reconciliação e entrega zero.
- Preparar o protocolo gera auditoria atômica e evidencia o preflight, mas não valida escrita, não cria `ExecutionRecord` e não habilita o adapter.
- Contrato de identidade do operador independente de provedor e adapter bootstrap sem dependência cloud, configurado somente por sujeito e digest SHA-256.
- Perfis de tenant e memberships persistentes com papéis `owner`, `operator` e `viewer`; somente dois estados ativos produzem acesso.
- Endpoint de seleção retorna apenas tenants associados ao sujeito autenticado, deriva permissões do papel e audita cada leitura antes de responder.
- Autenticação ausente, credencial inválida, tenant suspenso, membership revogada ou falha de auditoria bloqueiam fail-closed.
- Central Operacional integrada ao acesso autenticado com credencial exclusiva do servidor, nunca exposta ao navegador.
- Seleção de cliente deriva somente das memberships retornadas pelo backend; UUID manual deixou de ser necessário.
- Endpoint tenant-scoped retorna o plano mais recente de cada campanha somente após revalidar a membership e audita a leitura.
- A interface valida o contrato e recusa respostas cruzadas entre tenants, credenciais rejeitadas ou fronteiras externas inconsistentes.
- A decisão operacional exibida usa rota autenticada de ponta a ponta; conhecer UUIDs não permite contornar a membership.
- Fluxo guiado permite criar rascunhos de campanha, salvar progresso parcial e retomar pela versão mais recente.
- A Central Operacional localiza a conta de anúncios previamente selecionada no snapshot Meta e a vincula ao plano sem digitação de IDs, sem expor o cofre e sem qualquer escrita externa.
- O vínculo do alvo gera um novo plano imutável e torna conexão/conta visíveis no resumo autenticado; respostas cruzadas, seleção ausente ou múltipla são recusadas fail-closed.
- Lacunas do contexto viram tarefas em linguagem operacional; fatos ausentes continuam sem inferência automática.
- Criação e atualização de contexto exigem `manage_campaign_preparation`; papel `viewer` permanece estritamente leitura.
- Versão do contexto e auditoria do operador são persistidas atomicamente na mesma transação PostgreSQL.
- Endpoints públicos de contexto foram retirados; seleção, leitura e gravação passam pelo limite autenticado do operador.
- Contexto completo recebe uma revisão explícita de fatos e teto financeiro antes da geração do plano lógico.
- Geração de plano exige membership e permissão de preparação; a rota pública anterior foi removida.
- Plano idempotente e auditoria de geração são persistidos atomicamente, sem duplicar evidência em repetição concorrente.
- A interface recusa plano cruzado, versão diferente, objetos ativos ou qualquer alegação de escrita externa.
- Resultado apresentado permanece `draft`, A0, com aprovação humana obrigatória, riscos bloqueantes e objetos `PAUSED`.
- Manifesto, autorização curta, preflight, Kill Switch e protocolo de validação de escrita agora são acessíveis somente pela fachada autenticada do operador.
- A identidade usada em solicitações e decisões do executor é derivada do token server-side; campos de autoria enviados pelo cliente foram eliminados dessas rotas.
- Operadores podem preparar e solicitar validação, proprietários decidem autorizações e controlam switches/protocolos, e viewers permanecem somente leitura.
- As rotas internas públicas do controle de execução foram removidas; conhecer UUIDs não contorna membership nem isolamento por tenant.
- Linha do tempo operacional tenant-scoped consolida somente eventos críticos realmente persistidos e vinculados aos objetos da campanha.
- A resposta de histórico é sanitizada por contrato: não expõe ator identificável, estados JSON brutos, erros internos ou credenciais.
- Marcos de contexto, plano, criativo, aprovação, prontidão, executor e segurança são traduzidos para linguagem operacional sem inferir publicação ou entrega.

## Bloco interno de validação controlada concluído
1. O contrato do primeiro teste de criação pausada está persistido e auditável.
2. Evidências mínimas, limites e políticas de falha estão definidos em código.
3. O adapter permanece ausente até ambiente real, autorização curta e todos os gates comprovados.

## Próximo bloco interno de produto
1. Cadastrar e aprovar o primeiro pacote criativo real da Rosa VIP com referência de mídia e digest verificável.
2. Concluir a descoberta/vinculação da Página, Instagram e WhatsApp exigidos pelo destino, sem ampliar permissões silenciosamente.
3. Preparar o manifesto e o protocolo controlado da primeira campanha, mantendo toda escrita Meta desligada até o gate humano e a validação real.

## Próximos itens que dependem de ambiente real
1. Criar o app Meta real, registrar o redirect OAuth e habilitar `ads_read` e `pages_show_list`.
2. Validar permissões e App Review aplicáveis ao caso multi-cliente.
3. Guardar a chave mestra do cofre nas configurações protegidas da hospedagem.
4. Acionar o smoke test automatizado e guardar o relatório de aprovação.
5. Executar o protocolo de criação controlada com todos os objetos em `PAUSED`, coletar as onze evidências e reconciliar o estado observado antes de qualquer retry.

## Evolução opcional do cofre
O PostgreSQL criptografado desbloqueia o MVP sem Google Cloud. A porta
`CredentialVaultPort` permanece independente do provedor, permitindo migrar
posteriormente para Google Secret Manager ou outro cofre gerenciado sem alterar
o fluxo OAuth ou os serviços de negócio.

## Trava de segurança
Nenhuma função de criação, alteração, pausa, ativação ou publicação na Meta foi implementada nesta fundação.
