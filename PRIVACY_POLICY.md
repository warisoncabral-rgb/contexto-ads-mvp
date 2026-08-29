# Política de Privacidade — Contexto Ads

**Última atualização: 28 de agosto de 2026**

Esta Política de Privacidade explica como o **Contexto Ads — Arquiteto de Campanhas com Contexto** trata informações quando é usado para estruturar campanhas e, quando autorizado, interagir com o backend do Gerador de Campanhas.

## 1. Informações tratadas

O Contexto Ads pode tratar informações fornecidas pelo próprio usuário para montar uma campanha, como:

- nome e descrição do negócio;
- descrição da oferta, produto ou serviço;
- objetivo da campanha e destino de conversão;
- descrição do público e localização;
- orçamento e duração planejados;
- textos de anúncio e mensagens iniciais;
- referências e metadados de mídia;
- identificadores internos de pacote, campanha, plano e aprovação;
- estados de revisão e aprovação.

O contrato de integração foi desenhado para **não incluir senhas, chaves de API, tokens de acesso ou outros segredos dentro do Campaign Package**.

## 2. Finalidade do tratamento

As informações são usadas somente para funções relacionadas ao fluxo de campanha, incluindo:

- organizar e validar o contexto da campanha;
- gerar e versionar um Campaign Package;
- criar ou consultar estruturas internas do Gerador;
- revisar e aprovar conteúdo criativo;
- solicitar e registrar aprovação de um plano de execução;
- informar pendências e próximos passos de forma estruturada.

## 3. Efeitos externos e Meta Ads

A integração do Contexto Ads com o Gerador separa preparação, aprovação e execução.

As ações atualmente expostas ao GPT **não autorizam, por si só, publicação, entrega, gasto ou escrita externa na Meta**. Aprovar um criativo ou um plano também não equivale a autorizar execução.

Operações de maior risco, como manifesto de execução, autorização específica de execução, preflight e criação de objetos na Meta, pertencem a um gate separado.

## 4. Armazenamento e infraestrutura

Dados necessários ao funcionamento do fluxo podem ser armazenados em infraestrutura de backend e banco de dados usada pelo serviço para manter histórico, versões, aprovações, auditoria e estado operacional.

O serviço aplica separação entre dados de operação e credenciais. Segredos de autenticação não devem ser incluídos em mensagens, Campaign Packages ou respostas conversacionais.

## 5. Compartilhamento

As informações são compartilhadas apenas com os componentes técnicos necessários para prestar a funcionalidade solicitada, como o backend do Gerador e a infraestrutura que hospeda e persiste o serviço.

O Contexto Ads não usa o Campaign Package como autorização para ativar anúncios ou iniciar gasto automaticamente.

## 6. Segurança

O projeto adota controles como:

- autenticação para endpoints operacionais;
- isolamento por tenant;
- versionamento e hashes para detectar alterações;
- aprovações vinculadas ao plano exato;
- registro de auditoria;
- separação entre aprovação de plano e autorização de execução;
- execução externa protegida por gates adicionais.

Nenhum sistema é completamente isento de risco, mas o fluxo é projetado para reduzir ações externas acidentais e impedir que uma aprovação genérica seja interpretada como permissão de gasto.

## 7. Retenção e exclusão

Informações operacionais podem ser mantidas enquanto forem necessárias para o funcionamento, histórico, auditoria e segurança do serviço. Solicitações de correção ou exclusão podem ser feitas ao responsável pelo Contexto Ads pelo canal de contato usado para a prestação do serviço, observadas eventuais obrigações técnicas, legais ou de auditoria aplicáveis.

## 8. Direitos do titular

Quando aplicável, o usuário pode solicitar informações sobre os dados tratados, correção de dados incorretos, atualização, exclusão ou outras medidas previstas pela legislação de proteção de dados aplicável, incluindo a LGPD.

## 9. Alterações nesta política

Esta política pode ser atualizada quando o produto, a infraestrutura ou as integrações mudarem. A data da versão mais recente será indicada no início desta página.

## 10. Contato

Dúvidas ou solicitações relacionadas a privacidade podem ser encaminhadas ao responsável pelo Contexto Ads pelo mesmo canal de atendimento utilizado para acesso ou suporte ao serviço.
