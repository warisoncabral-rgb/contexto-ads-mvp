import { humanizeExecutionBlockers } from './human-decision.presenter';

describe('humanizeExecutionBlockers', () => {
  it('keeps campaign protection technical details out of the user message', () => {
    const result = humanizeExecutionBlockers(['campaign_kill_switch']);
    expect(result.title).toBe('A campanha está protegida contra publicação');
    expect(result.message).not.toMatch(/kill switch/i);
    expect(result.userDecisionRequired).toBe(false);
  });

  it('translates Meta target problems into human language', () => {
    const result = humanizeExecutionBlockers(['real_meta_write_validation']);
    expect(result.message).toContain('conta de anúncios');
    expect(result.nextStep).not.toMatch(/adapter|manifest|preflight|hash/i);
  });

  it('returns a simple ready state when there are no blockers', () => {
    const result = humanizeExecutionBlockers([]);
    expect(result.status).toBe('ready');
    expect(result.userDecisionRequired).toBe(false);
  });
});
