# Issue #178 — Current state after investigation

Investigation result: the current preflight does not perform a granular live Meta asset diagnostic before evaluating `real_meta_write_validation`.

It currently reduces readiness to local booleans derived from the approved plan, connection state and selected bindings. In particular, Page and WhatsApp are considered ready only when there is exactly one selected local binding for each. When either is missing or ambiguous, the public Action receives only the umbrella `real_meta_write_validation` blocker and a generic Page/WhatsApp message.

The repository already contains a read-only Meta adapter capable of validating the connection, discovering ad accounts/Pages/WhatsApp assets, reading the ad account and checking effective capabilities/permissions. The implementation should reuse those reads and surface sanitized diagnostic evidence in preflight before any write adapter is invoked.

No campaign, ad set, creative or ad was created or activated as part of this investigation. No Meta write or spend was authorized.
