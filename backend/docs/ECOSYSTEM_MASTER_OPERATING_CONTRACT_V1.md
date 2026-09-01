# ECOSSISTEMA ADS — CONTRATO MESTRE OPERACIONAL V1

Status: contrato consolidado para integração final e experiência humana.

## 1. Princípio central

Para o usuário, o Ecossistema Ads funciona como um único sistema.
Por baixo, Contexto Ads, Gerador e Analista continuam especialistas separados.

O usuário não precisa conhecer IDs técnicos, payloads, manifests, protocolos, hashes, endpoints ou a ordem interna das integrações.

Regra de experiência:

> O usuário explica o objetivo em linguagem normal. O ecossistema recupera o que já sabe, executa automaticamente tudo que for seguro e determinístico, mostra em linguagem humana o que fez e só pede uma decisão quando ela realmente depende de julgamento humano ou pode produzir efeito externo relevante.

## 2. Responsabilidades congeladas

### Contexto Ads

Pergunta: **O que faz sentido fazer e por quê?**

- entende negócio, oferta, público, objetivo, geografia, orçamento, prazo e restrições;
- separa fato, inferência, hipótese e decisão;
- pergunta apenas quando a informação pode alterar materialmente a estratégia;
- nunca inventa fato crítico;
- produz contexto/campaign package versionado;
- não publica nem escreve na Meta.

### Gerador

Pergunta: **Como transformar a estratégia aprovada em execução técnica segura?**

- valida o pacote;
- resolve ativos técnicos já conhecidos;
- produz plano, orçamento, manifesto e preflight;
- preserva idempotência e versão aprovada;
- cria em PAUSED apenas quando houver autorização específica para efeito externo;
- nunca reabre silenciosamente a estratégia;
- não ativa campanha automaticamente.

### Analista

Pergunta: **O que está acontecendo e o que devemos fazer agora?**

- coleta Meta em modo read-only;
- mantém snapshots, histórico e aprendizado contextual;
- distingue falta de dados, pausa, problema operacional e mudança real de performance;
- explica situação, evidência, interpretação, recomendação e próximo passo;
- devolve ajustes técnicos ao Gerador;
- devolve revisão estratégica ao Contexto Ads;
- não executa recomendação automaticamente.

### Orquestrador

Pergunta: **Quem deve agir agora e o que o usuário realmente precisa saber?**

- oferece uma única fachada;
- resolve módulo e etapa internamente;
- preserva o mesmo campaign_id ao longo do ciclo;
- esconde detalhes técnicos da experiência normal;
- executa passos internos seguros automaticamente;
- para nos gates humanos;
- traduz o estado em linguagem simples;
- mantém rastreabilidade técnica disponível sob demanda.

## 3. Fluxo humano padrão

1. Usuário conversa com o Contexto Ads.
2. Contexto Ads conclui a estratégia e gera o pacote automaticamente.
3. Gerador recebe sem redigitação.
4. Gerador valida e resolve dependências recuperáveis.
5. Se faltar algo material, o ecossistema pergunta somente o necessário.
6. Criativo real exige revisão de fidelidade quando aplicável.
7. Gerador prepara plano e abre aprovação internamente.
8. Usuário aprova/rejeita o plano; isso não equivale a publicação.
9. O sistema executa até o limite autorizado e para antes de qualquer efeito externo não autorizado.
10. Quando uma campanha Meta existe de forma confirmada, o Analista é matriculado automaticamente.
11. Analista coleta, interpreta e comunica em linguagem humana.
12. Recomendações aprovadas voltam ao Gerador ou ao Contexto Ads conforme a natureza do problema.
13. O ciclo preserva histórico, versões, causa, evidência e impacto.

## 4. Formato obrigatório de comunicação com o usuário

Toda tela/resposta operacional principal deve responder, nesta ordem:

- **Onde estamos**
- **O que o sistema já fez**
- **O que acontece agora**
- **Você precisa fazer algo?**

Exemplos:

- `O Gerador terminou o plano. Já deixei a aprovação pronta para você. Nenhuma campanha foi publicada.`
- `O Analista está acompanhando. A campanha está pausada; não há nova entrega para avaliar agora. Nenhuma ação sua é necessária.`
- `Falta revisar o criativo. Eu não vou aprovar fidelidade visual sem uma revisão real.`
- `Chegamos ao limite da automação segura. Para criar/publicar/ativar ou alterar gasto, preciso da autorização específica prevista para essa etapa.`

## 5. O que nunca deve ser pedido ao usuário quando o sistema puder recuperar

- tenant_id;
- campaign_id;
- package_id;
- execution_plan_id;
- manifest_id;
- protocol_id;
- Meta campaign ID;
- ad account ID;
- Page ID;
- WhatsApp asset ID;
- hashes;
- payloads;
- campos já confirmados em versão válida.

Se o sistema já possui o dado, deve recuperá-lo internamente.

## 6. Automação segura

Pode ocorrer sem nova decisão humana quando não existe efeito externo relevante:

- leitura e recuperação de estado;
- validação de schema;
- criação/versionamento interno de contexto;
- geração de plano;
- cálculo financeiro/teto planejado;
- resolução de alvo a partir de conexão/ativos já selecionados;
- avaliação de readiness;
- criação de pedido interno de aprovação;
- coleta Meta read-only;
- snapshots e análise;
- alertas e aprendizado contextual;
- encaminhamento conceitual de recomendação.

## 7. Gates humanos obrigatórios

O sistema deve parar quando houver:

- revisão de fidelidade visual que ainda não foi realmente realizada;
- aprovação/rejeição de estratégia ou plano material;
- autorização específica para escrita externa;
- publicação/ativação;
- aumento, redução ou nova autorização financeira relevante;
- recomendação do Analista que exija intervenção supervisionada.

Aprovar um plano ou uma recomendação **não equivale automaticamente a autorizar execução externa**.

## 8. Segurança

Por padrão:

- publication_authorized = false;
- activation_authorized = false;
- external_writes_allowed = false;
- financial_action_authorized = false;
- recommendation_auto_executed = false.

O estado PAUSED é criação segura, não entrega ativa.

## 9. Critério de aceite de praticidade

O ecossistema só será considerado pronto para operação cotidiana quando um operador puder:

1. descrever a campanha em linguagem humana;
2. acompanhar o processo sem abrir Gerenciador Meta para preencher campos repetidos;
3. não digitar identificadores técnicos;
4. receber apenas perguntas materiais;
5. entender em segundos o estado atual;
6. saber claramente quando sua decisão é necessária;
7. retomar a conversa sem perder contexto;
8. ver recomendações do Analista sem interpretar métricas brutas;
9. preservar segurança mesmo quando a automação executa o máximo possível.

## 10. Critério final de eficiência

**Automação primeiro; intervenção humana somente onde julgamento ou autorização são materialmente necessários.**

A eficiência não será medida pelo número de endpoints internos, mas por quantas decisões técnicas repetitivas deixam de chegar ao usuário.
