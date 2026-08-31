const DEFAULT_BASE_URL = 'https://contexto-ads-validation-api.onrender.com/v1';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function period(now = new Date()) {
  const lookback = Math.max(1, Math.min(7, Number(process.env.ANALYST_COLLECTION_LOOKBACK_DAYS ?? 1) || 1));
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - lookback);
  return { since: dateOnly(since), until: dateOnly(until) };
}

async function request(baseUrl, token, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} for ${path}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function uniqueTargets(portfolio) {
  const items = Array.isArray(portfolio?.items) ? portfolio.items : [];
  const map = new Map();
  for (const item of items) {
    if (!item?.tenantId || !item?.campaignId) continue;
    map.set(`${item.tenantId}:${item.campaignId}`, {
      tenantId: item.tenantId,
      campaignId: item.campaignId,
      tenantDisplayName: item.tenantDisplayName ?? null,
    });
  }
  return [...map.values()];
}

function assertSafeBoundaries(result) {
  const boundaries = result?.boundaries ?? {};
  for (const key of [
    'meta_write_performed',
    'external_writes_allowed',
    'recommendation_auto_executed',
    'financial_action_authorized',
  ]) {
    if (boundaries[key] === true) throw new Error(`Unsafe analyst boundary detected: ${key}=true`);
  }
}

function assertSafeLearning(learning) {
  const boundaries = learning?.boundaries ?? {};
  if (learning?.actionStatus === 'RECORDED' && boundaries.contextualOnly !== true) {
    throw new Error('Recorded learning is not marked contextual-only');
  }
  for (const key of [
    'universalRuleCreated',
    'autonomousTrainingPerformed',
    'metaWritePerformed',
    'externalWritesAllowed',
    'recommendationAutoExecuted',
  ]) {
    if (boundaries[key] === true) throw new Error(`Unsafe learning boundary detected: ${key}=true`);
  }
}

function sanitize(result, target, learning = null) {
  const brief = result?.user_brief ?? null;
  return {
    tenantId: target.tenantId,
    campaignId: target.campaignId,
    actionStatus: result?.action_status ?? 'UNKNOWN',
    operationalState: brief?.operationalState ?? null,
    situation: brief?.situation ?? result?.situation ?? result?.user_message ?? null,
    decision: brief?.decision ?? null,
    confidence: brief?.confidence?.label ?? null,
    urgency: brief?.urgency?.label ?? null,
    nextReviewAt: brief?.nextReviewAt ?? null,
    technicalIdRequiredFromUser:
      result?.meta_campaign_resolution?.technical_id_required_from_user
      ?? result?.technical_id_required_from_user
      ?? null,
    learningStatus: learning?.actionStatus ?? null,
    learning: learning?.learning ?? null,
    learningConfidence: learning?.confidence ?? null,
  };
}

export async function collectPortfolio(options = {}) {
  const baseUrl = (options.baseUrl ?? process.env.ANALYST_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const token = options.token ?? required('CONTEXT_ADS_OPERATOR_TOKEN');
  const window = options.period ?? period();
  const portfolio = await request(baseUrl, token, '/operator/portfolio');
  const targets = uniqueTargets(portfolio);
  const totals = {
    discovered: targets.length,
    analyzed: 0,
    awaitingMetaLink: 0,
    unavailable: 0,
    skipped: 0,
    failed: 0,
    learningRecorded: 0,
    learningNoLearning: 0,
    learningFailed: 0,
  };
  const results = [];

  for (const target of targets) {
    try {
      const result = await request(
        baseUrl,
        token,
        `/operator/tenants/${encodeURIComponent(target.tenantId)}`
          + `/campaigns/${encodeURIComponent(target.campaignId)}/analyst/collect-meta`,
        { method: 'POST', body: JSON.stringify(window) },
      );
      assertSafeBoundaries(result);
      const status = result?.action_status;
      let learning = null;

      if (status === 'ANALYZED') {
        totals.analyzed += 1;
        try {
          learning = await request(
            baseUrl,
            token,
            `/operator/tenants/${encodeURIComponent(target.tenantId)}`
              + `/campaigns/${encodeURIComponent(target.campaignId)}/analyst/learning/refresh`,
            { method: 'POST' },
          );
          assertSafeLearning(learning);
          if (learning?.actionStatus === 'RECORDED') totals.learningRecorded += 1;
          else totals.learningNoLearning += 1;
        } catch (error) {
          totals.learningFailed += 1;
          learning = {
            actionStatus: 'FAILED',
            learning: null,
            confidence: null,
            error: error instanceof Error ? error.message : 'Unknown learning refresh error',
          };
        }
      } else if (status === 'AWAITING_META_LINK') totals.awaitingMetaLink += 1;
      else if (status === 'UNAVAILABLE') totals.unavailable += 1;
      else totals.skipped += 1;

      const safe = sanitize(result, target, learning);
      results.push(safe);
      console.log(JSON.stringify(safe));
    } catch (error) {
      totals.failed += 1;
      const safeError = {
        tenantId: target.tenantId,
        campaignId: target.campaignId,
        actionStatus: 'FAILED',
        error: error instanceof Error ? error.message : 'Unknown collector error',
      };
      results.push(safeError);
      console.error(JSON.stringify(safeError));
    }
  }

  const summary = {
    period: window,
    totals,
    boundaries: {
      portfolioReadOnly: true,
      metaCollectionReadOnly: true,
      contextualLearningOnly: true,
      autonomousTrainingPerformed: false,
      publicationAuthorized: false,
      externalWritesAllowed: false,
      recommendationAutoExecuted: false,
      financialActionAuthorized: false,
    },
  };
  console.log(JSON.stringify({ collectorSummary: summary }, null, 2));

  if (targets.length > 0 && totals.failed === targets.length) {
    throw new Error('Analyst collector could not inspect any discovered campaign');
  }
  return { summary, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  collectPortfolio().catch((error) => {
    console.error(JSON.stringify({
      collectorStatus: 'FAILED',
      error: error instanceof Error ? error.message : 'Unknown collector error',
    }));
    process.exitCode = 1;
  });
}
