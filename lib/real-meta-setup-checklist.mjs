export const realMetaSetupChecklist = [
  { phase: 'read_only_smoke', key: 'backend_public_https', title: 'Backend público em HTTPS', detail: 'Disponibilizar o callback OAuth do backend em uma URL HTTPS estável.' },
  { phase: 'read_only_smoke', key: 'frontend_public_https', title: 'Central pública em HTTPS', detail: 'Configurar CONTEXT_ADS_FRONTEND_BASE_URL para o retorno seguro do callback.' },
  { phase: 'read_only_smoke', key: 'postgres', title: 'PostgreSQL persistente', detail: 'Aplicar as migrações e usar um banco persistente para conexões, auditoria e snapshots.' },
  { phase: 'read_only_smoke', key: 'vault', title: 'Cofre PostgreSQL e chave mestra', detail: 'Usar CREDENTIAL_VAULT_PROVIDER=postgres e manter a chave mestra apenas nas configurações protegidas da hospedagem.' },
  { phase: 'read_only_smoke', key: 'meta_app', title: 'App Meta real', detail: 'Criar o app e configurar META_APP_ID e META_APP_SECRET no ambiente protegido.' },
  { phase: 'read_only_smoke', key: 'oauth_redirect', title: 'Redirect OAuth exato', detail: 'Cadastrar na Meta a mesma META_OAUTH_REDIRECT_URI HTTPS usada pelo backend.' },
  { phase: 'read_only_smoke', key: 'read_permissions', title: 'Permissões de leitura', detail: 'Autorizar public_profile, ads_read e pages_show_list para o primeiro smoke.' },
  { phase: 'read_only_smoke', key: 'operator_identity', title: 'Identidade do operador', detail: 'Configurar subject e digest SHA-256 do token bootstrap, sem armazenar o token em texto puro.' },
  { phase: 'read_only_smoke', key: 'tenant_membership', title: 'Membership owner ativa', detail: 'Associar o operador ao tenant de teste com papel owner e configure_tenant.' },
  { phase: 'controlled_write_later', key: 'ads_management', title: 'ads_management', detail: 'Solicitar somente quando o smoke de leitura estiver aprovado e a validação de escrita for explicitamente iniciada.' },
  { phase: 'controlled_write_later', key: 'write_adapter', title: 'Adapter mínimo de escrita', detail: 'Implementar somente após a validação do ambiente de leitura e manter criação obrigatoriamente em PAUSED.' },
]

export function summarizeRealMetaSetupChecklist() {
  return {
    readOnlySmoke: realMetaSetupChecklist.filter((item) => item.phase === 'read_only_smoke'),
    controlledWriteLater: realMetaSetupChecklist.filter((item) => item.phase === 'controlled_write_later'),
    boundaries: {
      adsManagementRequiredForReadOnlySmoke: false,
      externalWriteEnabled: false,
      realCredentialsStoredInChecklist: false,
    },
  }
}
