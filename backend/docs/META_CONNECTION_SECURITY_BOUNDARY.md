# Limite de segurança da conexão Meta

Antes do primeiro teste real, todas as rotas que iniciam ou consultam uma conexão Meta e a rota que inicia OAuth devem exigir autenticação do operador e membership `owner` ativa no tenant solicitado.

O callback OAuth permanece público por necessidade do protocolo, mas continua protegido pelo `state` de uso único e pelo vínculo persistido entre tenant e conexão.

A autorização desta fronteira permite somente configurar e ler a conexão. Ela não autoriza publicação, ativação, entrega ou escrita na Meta.
