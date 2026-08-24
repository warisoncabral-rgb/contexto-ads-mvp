# Hostable Real-Smoke Candidate

## Purpose
Freeze the internally prepared state immediately before a real Meta environment is introduced.

## What is now prepared
- cumulative application candidate validated against `main`;
- PostgreSQL-backed domain and audit foundation;
- protected operator and tenant boundaries;
- secret-safe environment preflight;
- owner-only Meta configuration/readiness/smoke routes;
- least-privilege read-only OAuth profile;
- server-owned OAuth callback return destination;
- Central UI for OAuth and the four-step read-only smoke;
- reviewable smoke evidence packet;
- explicit real-environment setup checklist;
- provider-neutral liveness/readiness endpoints;
- provider-neutral backend/frontend production containers validated in CI.

## Exact next external actions
1. Provision a persistent PostgreSQL database and apply migrations.
2. Deploy backend and frontend containers on HTTPS endpoints.
3. Inject runtime secrets/configuration through the hosting platform, never the image.
4. Confirm `/v1/health/live` and `/v1/health/ready`.
5. Create/configure the real Meta app and register the exact backend callback URL.
6. Configure `public_profile`, `ads_read`, and `pages_show_list` for the first test.
7. Configure the owner operator identity/membership for the test tenant.
8. Run the secret-safe real-environment preflight.
9. Open `/connections`, complete OAuth, and execute the read-only smoke.
10. Review and preserve the generated evidence packet.

## Still deliberately absent
- real Meta credentials in repository or CI;
- `ads_management` in the default OAuth profile;
- a write transport/adapter;
- an external execution attempt;
- campaign publication, activation, delivery or budget mutation.

## Write phase boundary
Only after the read-only smoke is proven in the real environment should the separate controlled-write phase begin. That phase remains constrained to objects created in `PAUSED`, explicit short-lived execution authorization, preflight, Kill Switch, evidence collection, reconciliation, and no automatic retry after ambiguous outcomes.

## Release decision
If frontend, backend/PostgreSQL, and container validation all pass cumulatively for this branch against `main`, the repository is internally ready to be hosted and connected to a real Meta environment for the first read-only smoke. Remaining blockers are external configuration facts, not missing internal product scaffolding.
