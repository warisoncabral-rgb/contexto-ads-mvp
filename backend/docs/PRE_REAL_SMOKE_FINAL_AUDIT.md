# Pre-Real-Smoke Final Audit

## Scope
Cumulative candidate through the real Meta setup checklist, validated against `main` before any real credential is supplied.

## Prepared path
1. Secret-safe environment preflight.
2. Authenticated owner-only Meta configuration boundary.
3. Read-only OAuth scope profile by default.
4. Protected Central UI to start the Meta connection.
5. OAuth callback with single-use state.
6. Server-owned return destination back to the Central.
7. Connection ID carried into the read-only smoke UI.
8. Read-only smoke: identity -> asset discovery -> capability validation -> ad-account read.
9. Reviewable evidence packet derived from the persisted smoke report.
10. Explicit setup checklist separating read-only requirements from later controlled-write requirements.

## Still external
The following cannot be proven by repository CI:
- real Meta App ID and App Secret;
- exact public HTTPS callback registered in the Meta app;
- successful human OAuth consent;
- actual ads_read/pages_show_list grants and applicable App Review status;
- real discovered Business/Page/ad-account assets;
- real read-only smoke result.

## Write gate remains closed
- `ads_management` is excluded from the default read-only profile;
- requesting the future controlled-write profile is not authorization;
- no write adapter is enabled;
- no publication, activation, delivery or budget-changing command is enabled;
- the first write validation remains a separate future phase restricted to PAUSED creation, short authorization, preflight, Kill Switch, evidence collection and reconciliation.

## Candidate decision
If cumulative frontend and backend/PostgreSQL gates pass, no additional internal prerequisite is known for beginning the first real read-only smoke. The next blockers are environment-owned and require real Meta configuration/credentials.
