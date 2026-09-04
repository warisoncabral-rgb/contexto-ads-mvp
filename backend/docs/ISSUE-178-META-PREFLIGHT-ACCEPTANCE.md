# Issue #178 — Acceptance checklist

The implementation is ready for deployment only when all checks below pass:

- [ ] ad account is read from Meta and its operational status/access are returned;
- [ ] exactly one Facebook Page is selected and currently observable by Meta;
- [ ] exactly one WhatsApp destination is selected and currently observable by Meta;
- [ ] expected WhatsApp `(83) 98655-3047` matches the Meta-observed destination after normalization;
- [ ] ad account/Page/WhatsApp relationship is proved or explicitly fails closed;
- [ ] effective permissions are returned with required/granted/missing values;
- [ ] `real_meta_write_validation` identifies the exact failing asset/field and remediation;
- [ ] blocked Action response surfaces `meta_diagnostics`;
- [ ] no token/app secret/raw sensitive response is exposed;
- [ ] diagnostic makes no Meta write;
- [ ] tests cover missing Page, missing WhatsApp, ambiguity, destination mismatch, permission failure, token/access failure, ad-account failure, and all-PASS;
- [ ] existing PAUSED-only, no-delivery, no-spend boundaries remain unchanged;
- [ ] `CREATE_PAUSED` remains blocked unless the complete required preflight passes.
