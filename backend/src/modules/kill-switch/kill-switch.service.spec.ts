import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CampaignContextPackageV1 } from '../../domain/contracts/campaign-context';
import { AuditEvent } from '../../domain/contracts/audit-event';
import { KillSwitchStateV1 } from '../../domain/contracts/kill-switch';
import {
  CampaignContextRepository,
  KillSwitchRepository,
} from '../../domain/ports/repositories';
import { KillSwitchService } from './kill-switch.service';

describe('KillSwitchService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const campaignId = '22222222-2222-4222-8222-222222222222';
  const campaign: CampaignContextPackageV1 = {
    packageId: '33333333-3333-4333-8333-333333333333',
    tenantId, campaignId, version: 1, schemaVersion: '1.0',
    status: 'ready_for_generation', facts: {}, inferences: [],
    validationIssues: [], contentHash: 'a'.repeat(64),
    createdAt: '2026-08-24T14:00:00.000Z',
  };
  const tenantReleased: KillSwitchStateV1 = {
    killSwitchStateId: '44444444-4444-4444-8444-444444444444',
    tenantId, scope: 'tenant', version: 1, status: 'released',
    reason: 'Preparação validada.', changedBy: 'warison',
    correlationId: '55555555-5555-4555-8555-555555555555',
    changedAt: '2026-08-24T14:01:00.000Z',
  };
  const campaignReleased: KillSwitchStateV1 = {
    ...tenantReleased,
    killSwitchStateId: '66666666-6666-4666-8666-666666666666',
    scope: 'campaign', campaignId,
  };
  let states: jest.Mocked<KillSwitchRepository>;
  let campaigns: jest.Mocked<CampaignContextRepository>;
  let service: KillSwitchService;

  beforeEach(() => {
    states = {
      appendNext: jest.fn(async (state, _event: AuditEvent) => ({
        ...state, version: 1,
      })),
      latest: jest.fn().mockResolvedValue(null),
    };
    campaigns = {
      create: jest.fn(), appendNext: jest.fn(),
      latest: jest.fn().mockResolvedValue(campaign), findVersion: jest.fn(),
    };
    service = new KillSwitchService(states, campaigns);
  });

  it('blocks fail-closed when either state is absent', async () => {
    const result = await service.effective(tenantId, campaignId);
    expect(result).toEqual(expect.objectContaining({
      writesBlocked: true,
      decision: 'blocked_missing_state',
      tenant: { known: false, status: 'missing' },
      campaign: { known: false, status: 'missing' },
      boundaries: { externalWritesAllowed: false, externalWritesPerformed: false },
    }));
  });

  it('reports released only when both scopes are known and released', async () => {
    states.latest
      .mockResolvedValueOnce(tenantReleased)
      .mockResolvedValueOnce(campaignReleased);
    const result = await service.effective(tenantId, campaignId);
    expect(result.writesBlocked).toBe(false);
    expect(result.decision).toBe('released');
    expect(result.tenant).toEqual(expect.objectContaining({
      known: true, status: 'released', version: 1,
    }));
    expect(result.boundaries.externalWritesAllowed).toBe(false);
  });

  it('gives an engaged tenant switch precedence over a released campaign', async () => {
    states.latest
      .mockResolvedValueOnce({ ...tenantReleased, status: 'engaged' })
      .mockResolvedValueOnce(campaignReleased);
    const result = await service.effective(tenantId, campaignId);
    expect(result).toEqual(expect.objectContaining({
      writesBlocked: true, decision: 'blocked_engaged',
    }));
  });

  it('persists tenant and campaign changes with actor, reason and audit intent', async () => {
    await service.changeTenant(
      tenantId, 'engaged', 'warison', 'Interrupção preventiva.',
    );
    await service.changeCampaign(
      tenantId, campaignId, 'released', 'warison', 'Preflight autorizado.',
    );
    expect(states.appendNext).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        tenantId, scope: 'tenant', status: 'engaged', changedBy: 'warison',
      }),
      expect.objectContaining({ eventType: 'kill_switch_engaged', result: 'blocked' }),
    );
    expect(states.appendNext).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ tenantId, campaignId, scope: 'campaign' }),
      expect.objectContaining({ eventType: 'kill_switch_released', result: 'info' }),
    );
  });

  it('does not expose or mutate a campaign from another tenant', async () => {
    campaigns.latest.mockResolvedValueOnce(null);
    await expect(service.changeCampaign(
      '99999999-9999-4999-8999-999999999999', campaignId,
      'engaged', 'warison', 'Bloquear campanha.',
    )).rejects.toBeInstanceOf(NotFoundException);
    expect(states.appendNext).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs, status, actors and reasons', async () => {
    await expect(service.changeTenant('bad', 'engaged', 'warison', 'Motivo válido.'))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.changeTenant(tenantId, 'open', 'warison', 'Motivo válido.'))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.changeTenant(tenantId, 'engaged', 'x', 'Motivo válido.'))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.changeTenant(tenantId, 'engaged', 'warison', 'x'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
