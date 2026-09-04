export type HumanDecision = {
  status: 'ready' | 'action_required' | 'blocked';
  title: string;
  message: string;
  nextStep: string;
  userDecisionRequired: boolean;
};

const BLOCKER_COPY: Record<string, HumanDecision> = {
  manifest_current: {
    status: 'blocked',
    title: 'A campanha mudou desde a última revisão',
    message: 'A versão que estava pronta para criar não é mais a versão atual da campanha.',
    nextStep: 'Revise a campanha atual e confirme novamente antes de continuar.',
    userDecisionRequired: true,
  },
  specific_execution_authorization: {
    status: 'action_required',
    title: 'Precisamos da sua confirmação para continuar',
    message: 'A criação segura ainda não está autorizada para esta tentativa.',
    nextStep: 'Confirme a criação em modo pausado para continuar sem ativar nem gerar gasto.',
    userDecisionRequired: true,
  },
  tenant_kill_switch: {
    status: 'blocked',
    title: 'A conta está protegida contra alterações',
    message: 'Existe uma proteção geral ativa que impede qualquer criação na Meta.',
    nextStep: 'Libere a proteção geral da conta antes de tentar criar a campanha.',
    userDecisionRequired: true,
  },
  campaign_kill_switch: {
    status: 'action_required',
    title: 'A campanha está protegida contra publicação',
    message: 'A proteção desta campanha ainda está ativa. Ela pode ser liberada somente para criar tudo em modo pausado, sem ativar e sem gerar gasto.',
    nextStep: 'Continuar com a criação segura em modo pausado.',
    userDecisionRequired: false,
  },
  meta_geography_resolved: {
    status: 'action_required',
    title: 'Precisamos ajustar a localização da campanha',
    message: 'A Meta não reconheceu uma ou mais localidades exatamente como foram configuradas.',
    nextStep: 'Revise as cidades e o raio antes de continuar.',
    userDecisionRequired: true,
  },
  real_meta_write_validation: {
    status: 'blocked',
    title: 'A conexão com a Meta ainda não está pronta para criar a campanha',
    message: 'Falta uma configuração necessária da conta de anúncios, Página ou WhatsApp.',
    nextStep: 'Conclua a configuração indicada da conta Meta e tente novamente.',
    userDecisionRequired: true,
  },
  write_adapter_enabled: {
    status: 'blocked',
    title: 'A criação ainda não está disponível neste ambiente',
    message: 'O recurso técnico responsável por enviar a campanha para a Meta não está habilitado.',
    nextStep: 'Aguarde a liberação do ambiente antes de tentar novamente.',
    userDecisionRequired: false,
  },
};

export function humanizeExecutionBlockers(blockers: string[]): HumanDecision {
  if (!blockers.length) {
    return {
      status: 'ready',
      title: 'Tudo pronto para criar a campanha',
      message: 'As verificações foram concluídas e a campanha pode ser criada em modo pausado.',
      nextStep: 'Criar a campanha em modo pausado e conferir os dados antes de ativar.',
      userDecisionRequired: false,
    };
  }
  if (blockers.length === 1 && BLOCKER_COPY[blockers[0]]) return BLOCKER_COPY[blockers[0]];
  return {
    status: 'action_required',
    title: 'Ainda falta uma etapa antes de criar a campanha',
    message: 'Encontramos uma ou mais configurações que precisam ser concluídas antes da criação segura.',
    nextStep: 'Siga a orientação apresentada e tente novamente quando estiver concluído.',
    userDecisionRequired: true,
  };
}
