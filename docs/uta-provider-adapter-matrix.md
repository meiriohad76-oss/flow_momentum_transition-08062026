# UTA Provider Adapter Matrix

UTA v1 is live-data only. Replay fixtures are not a selectable runtime source and live-provider failures must surface as unavailable lane states rather than synthetic signal results.

Massive is the primary UTA market-data provider for v1. Polygon-compatible credentials and URLs remain accepted because Massive is the successor branding/API surface for Polygon-style endpoints.

Recommended environment:

```text
MASSIVE_API_KEY=...
UTA_PRIMARY_PROVIDER=massive
TRADE_PRINTS_PROVIDER=massive
MARKET_DATA_PROVIDER=massive
```

| Lane | V1 source | Live provider policy | Fallback state |
|---|---|---|---|
| `massive_live_trade_slices` | Massive trades API | Massive trades API by default; Polygon-compatible key/base URL accepted. Massive-style fields are normalized into the UTA contract. | `unavailable` with no live signal. |
| `massive_premarket_trade_slices` | Massive trades API | Same trade-print adapter, scoped to 04:00-09:30 ET. | `disabled` outside premarket or `unavailable` if provider missing. |
| `massive_daily_bars` | Massive aggregate bars | Massive aggregate bars by default when `MARKET_DATA_PROVIDER=massive`; existing provider chain remains available. | `stale` or `unavailable`; no B score if baseline cannot be built. |
| `massive_block_trade_feed` | Derived from normalized prints | No direct provider call in v1. | Mirrors source lane state. |
| `fred_macro_context` | Existing macro context | FRED or existing macro context provider. | `stale`; macro is contextual only. |
| `activity_alerts` | Optional imports | Optional CSV/API imports such as TradeVision or Unusual Whales. | `disabled`; never penalizes tier. |
| `options_flow` | Optional future adapter | Optional future adapter. | `disabled`; never penalizes tier. |
| `earnings_calendar` | Earnings provider chain | Existing earnings provider chain. | `stale`; affects baseline exclusion only. |
| `universe_constituents` | Cached/reference constituents | Weekly updater from configured reference provider. | `stale` warning; scan can run with last known universe. |

Provider failures must become lane states. They must not create synthetic live signals.

## Runtime Readiness Surface

`GET /api/uta/providers` exposes the provider-readiness contract used by the Runtime UI. It reports:

- which provider family backs each UTA lane;
- whether the provider is enabled/configured without exposing secrets;
- the fallback lane state and tier effect if unavailable;
- Pi-safe manual-only/autostart safeguards;
- live-only policy text and validation safeguards.

This endpoint is operational visibility only. It must not start polling, mutate lane history, fabricate live data, or enable paper-trading effects.

`POST /api/uta/providers/preflight` runs a manual, read-only provider preflight. The default mode is deterministic and does not call external APIs; it reports `configured` or `missing_key` states, validates mutation guards, and keeps trading effect at `none`. Explicit live probes with `probe_live=true` may return `sample_ok`, `provider_error`, or `rate_limited`; they remain manual-only and must not write historical signal rows.
