# Checklist de evidências — smoke Meta somente leitura

Registrar apenas referências sanitizadas; nunca copiar tokens, App Secret, chave mestra ou `credentialRef` bruto.

- [ ] preflight local de ambiente aprovado
- [ ] tenant e membership usados no teste registrados
- [ ] connectionId persistido no tenant correto
- [ ] OAuth `state` consumido uma única vez
- [ ] callback concluiu a conexão
- [ ] token foi persistido somente pelo cofre
- [ ] identidade `/me` validada
- [ ] contas de anúncio descobertas
- [ ] páginas descobertas quando aplicável
- [ ] permissões/capacidades lidas da Meta
- [ ] conta de anúncio lida pertence ao snapshot descoberto
- [ ] `appsecret_proof` usado nas leituras autenticadas
- [ ] relatório de smoke persistido
- [ ] nenhum segredo apareceu em resposta, log ou evidência
- [ ] nenhuma escrita, publicação, ativação ou entrega foi executada

## Resultado permitido

- `PASS`: todas as evidências acima foram observadas no ambiente real.
- `BLOCKED`: qualquer evidência está ausente, inconsistente ou não verificável.

Não existe resultado parcial que autorize avançar para escrita.
