# Perfis de escopo OAuth Meta

O fluxo usa privilégio mínimo por padrão.

## `read_only`

Escopos solicitados: `public_profile`, `ads_read`, `pages_show_list`.

É o único perfil necessário para o primeiro smoke real de conexão, descoberta, capacidades e leitura.

## `controlled_write_validation`

Adiciona `ads_management` aos escopos de leitura. Esse perfil existe somente para a etapa posterior de validação controlada de criação pausada.

Solicitar `ads_management` **não** autoriza escrita. O adapter de escrita continua ausente e os gates de manifesto, autorização curta, preflight, Kill Switch, protocolo e evidências reais continuam independentes.

O perfil elevado deve ser solicitado explicitamente por um `owner` autenticado; nunca é usado como default.
