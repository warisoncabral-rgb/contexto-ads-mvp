# Provider-neutral deployment

Two production container definitions are provided:

- `deploy/Dockerfile.backend`
- `deploy/Dockerfile.frontend`

They intentionally contain no environment-specific credentials and can be used by any container platform that supports Node.js containers and outbound HTTPS.

## Backend runtime

Inject at runtime, never at image build time:

- `DATABASE_URL`
- `CREDENTIAL_VAULT_PROVIDER=postgres`
- `CREDENTIAL_VAULT_MASTER_KEY`
- `META_GRAPH_BASE_URL`
- `META_GRAPH_API_VERSION`
- `META_APP_ID`
- `META_APP_SECRET`
- `META_OAUTH_REDIRECT_URI`
- `CONTEXT_ADS_FRONTEND_BASE_URL`
- `OPERATOR_BOOTSTRAP_SUBJECT`
- `OPERATOR_BOOTSTRAP_TOKEN_SHA256`

Run all PostgreSQL migrations before routing production traffic to a new backend revision. The container does not auto-migrate by design so migration and application rollout remain separate, auditable operations.

Health probes after deployment:

- `/v1/health/live`
- `/v1/health/ready`

The ready response reports only booleans and never returns secret values.

## Frontend runtime

Inject server-side:

- `CONTEXT_ADS_API_BASE_URL`
- `CONTEXT_ADS_OPERATOR_TOKEN`

`CONTEXT_ADS_OPERATOR_TOKEN` must remain server-only and must never use a `NEXT_PUBLIC_` prefix.

## First real smoke sequence

1. Deploy PostgreSQL and apply migrations.
2. Deploy backend with protected runtime environment variables.
3. Confirm liveness/readiness.
4. Deploy frontend and set its public HTTPS URL in backend `CONTEXT_ADS_FRONTEND_BASE_URL`.
5. Register the backend HTTPS callback exactly in the Meta app.
6. Run `npm run preflight:real-meta-env` in the protected backend environment.
7. Open `/connections` and complete read-only OAuth.
8. Run the four-step read-only smoke and review the evidence packet.

No step above enables external writes. `ads_management` and the future PAUSED write validation remain separate.
