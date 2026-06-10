# UTA Live Validation And Calibration

This document defines the v1 validation gate for the Unusual Trading Activity Agent.

## Scope

UTA v1 uses live provider data only. The dashboard and API must not expose a replay mode, silently fall back to fixtures, or produce synthetic signal results when live providers are missing.

Validation inputs:

- Massive/Polygon-compatible provider credentials in the Pi environment
- `src/domain/uta-validation.js`
- `npm run check:uta-provider-preflight`
- `npm run check:uta-calibration`
- `npm run check:uta-trading-integration`
- `npm run check:uta-deploy-smoke`

## Live Provider Preflight

`check:uta-provider-preflight` verifies:

- required trade-print and bar lanes report configured provider state without exposing secrets
- provider failures become lane states, not fake signals
- optional corroboration lanes remain non-penalizing
- historical signal rows are not mutated by readiness checks
- trading effect remains `none`

Manual live probes may be used for a small ticker sample before a deployment is accepted.

## Calibration Audit

`check:uta-calibration` verifies:

- no-look-ahead baseline windows
- B-score stability by tier
- lane SLA failures remain visible
- false positive controls remain inside the accepted gate
- top-decile precision remains inside the accepted gate
- tier averages are monotonic across A, B, and C
- Benjamini-Hochberg FDR correction rows are produced
- paper-trading effects remain blocked

Any threshold change must include before/after metrics from live or accepted historical market data.

## Trading Gate

UTA evidence may not affect paper-trading behavior until all of these are accepted:

- live provider preflight
- calibration audit
- Pi deployment smoke
- human review of validation metrics

Until then, UTA remains supporting evidence only.

`check:uta-trading-integration` verifies that UTA evidence can attach to final-selection candidate reports, but cannot change:

- final action
- final conviction
- execution permission
- position size
