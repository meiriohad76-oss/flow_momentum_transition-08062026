# UTA Provider Adapter Matrix

The first UTA implementation starts with replay data. Live providers are introduced only after the replay vertical slice passes.

| Lane | V1 source | Live provider policy | Fallback state |
|---|---|---|---|
| `massive_live_trade_slices` | Replay fixture | Configured trade-print provider adapter. Massive-style fields are normalized into the UTA contract. | `unavailable` with no live signal. |
| `massive_premarket_trade_slices` | Replay fixture | Same trade-print adapter, scoped to 04:00-09:30 ET. | `disabled` outside premarket or `unavailable` if provider missing. |
| `massive_daily_bars` | Replay fixture | Existing market-data provider chain where possible. | `stale` or `unavailable`; no B score if baseline cannot be built. |
| `massive_block_trade_feed` | Derived from normalized prints | No direct provider call in v1. | Mirrors source lane state. |
| `fred_macro_context` | Replay fixture | FRED or existing macro context provider. | `stale`; macro is contextual only. |
| `activity_alerts` | Replay fixture | Optional CSV/API imports such as TradeVision or Unusual Whales. | `disabled`; never penalizes tier. |
| `options_flow` | Replay fixture | Optional future adapter. | `disabled`; never penalizes tier. |
| `earnings_calendar` | Replay fixture | Existing earnings provider chain. | `stale`; affects baseline exclusion only. |
| `universe_constituents` | JSON fixtures | Weekly updater from configured reference provider. | `stale` warning; scan can run with last known universe. |

Provider failures must become lane states. They must not create synthetic live signals.

## Runtime Readiness Surface

`GET /api/uta/providers` exposes the provider-readiness contract used by the Runtime UI. It reports:

- which provider family backs each UTA lane;
- whether the provider is enabled/configured without exposing secrets;
- the fallback lane state and tier effect if unavailable;
- Pi-safe manual-only/autostart safeguards;
- replay-first policy text and validation safeguards.

This endpoint is operational visibility only. It must not start polling, mutate lane history, promote replay data to live data, or enable paper-trading effects.
