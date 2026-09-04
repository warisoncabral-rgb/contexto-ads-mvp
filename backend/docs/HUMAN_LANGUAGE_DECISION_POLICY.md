# Human Language Decision Policy

## Product rule

Technical implementation details must not be the primary language shown to end users.

For every decision, blocker, approval, validation, publication step or error, the product must present first:

1. **O que aconteceu** — plain-language outcome.
2. **O que isso significa** — impact on the campaign or user.
3. **O que acontece agora** — the next clear action or decision.

Technical diagnostics may remain available internally for audit, support and engineering, but must not be required knowledge for normal use.

## Terms that stay backstage

Examples include: Kill Switch, manifest, adapter, hash, preflight, execution authorization, validation protocol, reconciliation, gate, payload, tenant, idempotency and raw API codes.

These may appear only in internal diagnostics or when an advanced user explicitly asks for technical detail.

## Safe automatic resolution

If a technical blocker is an internal safety state that can be resolved without changing strategy, budget, audience, creative, delivery state or spend authorization, the system should resolve it automatically after the relevant human intent is already explicit.

Example: after the user explicitly confirms creation in PAUSED, a campaign-level protection that only blocks safe PAUSED creation may be released automatically, while ACTIVE, delivery and spend remain blocked.

## Human decisions that must remain explicit

The product must still request clear human approval when the decision can change business intent or risk, including:

- strategy or campaign objective;
- audience or geography changes;
- budget or planned spend changes;
- creative/copy changes after approval;
- adding/changing Meta assets when ambiguous;
- activation/delivery;
- any action that can generate spend;
- payment actions performed in Meta.

## Response contract

User-facing responses should prefer fields equivalent to:

- `title`
- `message`
- `next_step`
- `user_decision_required`

Internal diagnostics should be separate and subordinate to the user-facing response.

## Example

Internal state: `campaign_kill_switch = engaged`.

User-facing copy:

- **Título:** A campanha está protegida contra publicação
- **Mensagem:** A proteção desta campanha ainda está ativa. Posso liberar somente a preparação segura, sem ativar e sem gerar gasto.
- **Próximo passo:** Continuar com a criação segura em modo pausado.

The user should not need to understand the term `Kill Switch` to make a correct decision.
