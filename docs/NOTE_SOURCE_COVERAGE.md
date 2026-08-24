# Source coverage authority

`/work-queue/sources` is the authoritative multi-tenant projection for current work-queue source coverage.

It derives coverage from every authorized snapshot. A single tenant snapshot must not be treated as a global proxy when source statuses can differ by tenant.

This projection is read-only and does not infer source availability beyond each persisted `sourceDecisions` status.
