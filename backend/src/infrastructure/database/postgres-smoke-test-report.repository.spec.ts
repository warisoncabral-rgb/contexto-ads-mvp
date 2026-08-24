import { Pool } from 'pg';
import { ReadOnlySmokeTestReport } from '../../domain/contracts/readiness';
import { PostgresSmokeTestReportRepository } from './postgres-smoke-test-report.repository';

describe('PostgresSmokeTestReportRepository', () => {
  const query = jest.fn();
  const repository = new PostgresSmokeTestReportRepository({ query } as unknown as Pool);
  const report: ReadOnlySmokeTestReport = {
    smokeTestId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    connectionId: '33333333-3333-4333-8333-333333333333',
    passed: true,
    steps: [{
      key: 'identity',
      status: 'passed',
      meaning: 'Identity valid',
      evidenceRefs: ['meta_user:123'],
      observedAt: '2026-08-24T04:00:00.000Z',
    }],
    blockers: [],
    generatedAt: '2026-08-24T04:01:00.000Z',
  };

  beforeEach(() => query.mockReset());

  it('persists a complete smoke report idempotently', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await repository.save(report);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('on conflict (smoke_test_id) do nothing'),
      [
        report.smokeTestId,
        report.tenantId,
        report.connectionId,
        report.passed,
        JSON.stringify(report.steps),
        JSON.stringify(report.blockers),
        report.generatedAt,
      ],
    );
  });

  it('loads only the latest tenant-scoped smoke report', async () => {
    query.mockResolvedValueOnce({ rows: [{
      smoke_test_id: report.smokeTestId,
      tenant_id: report.tenantId,
      connection_id: report.connectionId,
      passed: report.passed,
      steps: report.steps,
      blockers: report.blockers,
      generated_at: new Date(report.generatedAt),
    }] });

    await expect(repository.latestForConnection(
      report.tenantId,
      report.connectionId,
    )).resolves.toEqual(report);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where tenant_id = $1 and connection_id = $2'),
      [report.tenantId, report.connectionId],
    );
  });
});
