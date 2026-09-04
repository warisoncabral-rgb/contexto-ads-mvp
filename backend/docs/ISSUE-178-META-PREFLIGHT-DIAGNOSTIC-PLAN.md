# Issue #178 — Meta preflight diagnostic plan

## Root cause confirmed in current `main`

`ExecutionAuthorizationService.preflight()` currently computes the `real_meta_write_validation` umbrella check from local readiness booleans only:

- `adAccountReady`: plan contains an `act_...` id;
- `connectionReady`: connection has a credential ref and status `connected|ready`;
- `pageReady`: exactly one selected `facebook_page` binding exists;
- `whatsappReady`: exactly one selected `whatsapp` binding exists;
- `protocolReady`: validation protocol is prepared.

If Page or WhatsApp is missing/ambiguous, the API collapses the failure into the generic message: `A Página e o WhatsApp selecionados não estão completos ou são ambíguos.`

The existing `MetaReadonlyAdapter` already has read-only primitives that can help close this gap: connection validation, asset discovery, granted-permission/capability validation, and ad-account read. Asset discovery queries managed/promoted Pages and WhatsApp assets from Meta without performing writes.

## Required implementation

1. Extend `ExecutionPreflightV1` with a read-only `metaDiagnostics` object containing:
   - ad account: expected id, observed id/status/access, PASS/FAIL;
   - Page: selected binding id, Meta-observed id/name/access, PASS/FAIL;
   - WhatsApp: selected binding id, Meta-observed phone/display name or phone id when available, PASS/FAIL;
   - destination match against `(83) 98655-3047`;
   - association result for ad account ↔ Page ↔ WhatsApp;
   - required/granted/missing permissions for controlled PAUSED creation and Click-to-WhatsApp;
   - granular `real_meta_write_validation` result: failing asset, field, code, message, remediation.

2. Use read-only Meta operations before allowing the write adapter:
   - validate connection;
   - discover assets;
   - read ad account;
   - validate capabilities/permissions.

3. Fail closed. `real_meta_write_validation` must remain blocked if any required asset, relationship, permission, or expected WhatsApp destination cannot be proved.

4. Surface `metaDiagnostics` in `action-confirm-paused` when returning `BLOCKED_BEFORE_META_WRITE`, so the GPT Action can explain the exact correction instead of the umbrella error.

5. Add tests for:
   - missing Page;
   - missing WhatsApp;
   - multiple/ambiguous bindings;
   - expected WhatsApp mismatch;
   - missing `ads_management`;
   - connection/token access failure;
   - ad-account read failure;
   - all-PASS path.

## Safety invariants

This diagnostic remains GET/read-only at Meta level. It must not create or mutate campaign, ad set, creative, ad, Page, WhatsApp, billing, budget, or delivery state. `CREATE_PAUSED` remains blocked until all required diagnostics PASS.
