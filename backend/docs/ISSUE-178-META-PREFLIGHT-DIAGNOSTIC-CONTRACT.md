# Issue #178 — Diagnostic response contract

Proposed additive response shape for `ExecutionPreflightV1` and `action-confirm-paused`:

```json
{
  "meta_diagnostics": {
    "ad_account": {
      "status": "PASS|FAIL",
      "expected_id": "act_...",
      "observed_id": "act_...|null",
      "account_status": "...|null",
      "access_confirmed": true
    },
    "facebook_page": {
      "status": "PASS|FAIL",
      "selected_id": "...|null",
      "observed_id": "...|null",
      "display_name": "...|null",
      "access_confirmed": true
    },
    "whatsapp": {
      "status": "PASS|FAIL",
      "selected_id": "...|null",
      "observed_id": "...|null",
      "display_phone_number": "...|null",
      "expected_phone_number": "(83) 98655-3047",
      "expected_destination_matches": true
    },
    "association": {
      "status": "PASS|FAIL",
      "ad_account_page": true,
      "page_whatsapp": true,
      "all_assets_usable_together": true
    },
    "permissions": {
      "status": "PASS|FAIL",
      "required": ["ads_management"],
      "granted": ["ads_management"],
      "missing": []
    },
    "real_meta_write_validation": {
      "status": "PASS|FAIL",
      "code": "...|null",
      "failing_asset": "ad_account|facebook_page|whatsapp|association|permissions|null",
      "failing_field": "...|null",
      "message": "...",
      "remediation": "..."
    }
  }
}
```

Rules:
- never expose access tokens, app secrets, or raw sensitive Graph responses;
- normalize phone numbers before comparing destination;
- do not claim PASS from a stored binding alone: PASS requires current read-only evidence from Meta for access/availability where the API supports it;
- if Meta cannot prove a required relation, return FAIL with `unproven_relationship` rather than guessing;
- this contract is additive and must not loosen any existing safety gate.
