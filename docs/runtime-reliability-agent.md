# Runtime Reliability Agent

The Runtime Reliability Agent is the system's traffic-control layer. It is a backend engine, not only a dashboard widget. Its job is to decide whether the current machine and live-source plan are safe enough for more collectors, or whether expensive sources should stay manual.

## Position in the system

The agent runs beside the collectors and observes:

- runtime pressure from Node and the host machine
- live source health from `store.health.liveSources`
- persistence and backup health
- enabled/disabled state from `.env`
- auto-start policy from `.env`
- provider mode, including synthetic fallback providers

It does not replace the sentiment, evidence, fundamentals, macro, or trade setup engines. Instead, it gives those components a shared operational truth about data freshness and source reliability.

## Data flow

```text
Collectors and persistence
-> source health snapshots
-> Runtime Reliability Agent
-> /api/runtime-reliability
-> /api/health.runtime_reliability
-> dashboard/system panels and runtime control console
-> deploy scripts and future orchestrator controls
```

Downstream components should use it as a guardrail:

- dashboards show whether data is live, stale, fallback, unconfigured, disabled, or manual
- trade setup logic reduces conviction when key sources are degraded, fallback, stale, unconfigured, or intentionally manual; intentionally disabled optional sources and active `polling` states stay visible but do not reduce conviction
- deploy scripts can check whether the Pi is safe before enabling heavy collectors
- future scheduler/orchestrator logic can use the `collector_plan`

## Source classification

Each source receives:

- `status`: `healthy`, `fallback`, `manual`, `pending`, `polling`, `stale`, `degraded`, `error`, `unconfigured`, or `disabled`
- `action`: recommended next operational action
- `severity`: `info`, `warning`, or `critical`
- `reason`: human-readable explanation
- timing fields such as `last_success_at`, `last_poll_at`, and `age_hours`

The current source set includes:

- Fundamental Universe
- Live News
- Market Data
- Market Flow
- Earnings Calendar
- StockTwits Social Pulse
- Delayed Trade Prints
- Fundamental Market Reference
- SEC Fundamentals
- SEC Form 4 Insider Flow
- SEC 13F Institutional Flow
- Lightweight State Snapshot
- SQLite Backup

## Runtime pressure

The pressure model checks:

- Pi performance mode
- process RSS memory
- heap usage
- system free memory
- CPU load per core

When `AGENCY_AUTONOMOUS_DATA_ENABLED=true`, enabled live-data workers auto-start even when older Pi-light auto-start flags are still false. The pressure model can still warn about CPU or memory pressure, but it no longer keeps core data workers manual by default. Alpaca order submission remains separate and supervised.

## Autonomous Live Data

The `alpaca_marketaux_live` runtime profile is the preferred low-budget target once Alpaca market-data credentials are available. It keeps lightweight JSON persistence for the Pi, starts linked news, Alpaca market data, market flow, earnings, SEC fundamentals, Form 4, 13F, and fundamental market-reference refreshes, and keeps broker submission guarded.

The `autonomous_live` profile remains available for a Twelve Data-first setup. Use it when Twelve Data is the only configured pricing provider.

Expected optional gaps:

- `marketaux_news` is `unconfigured` until `MARKETAUX_API_KEY` is set. RSS fallback can still feed the Live News source.
- `stocktwits_stream` is `unconfigured` until `STOCKTWITS_API_KEY` is set, because unauthenticated server requests are commonly blocked.
- `trade_prints` is `unconfigured` until `MASSIVE_API_KEY`, `POLYGON_API_KEY`, `IEX_API_KEY`, or `TRADE_PRINTS_API_KEY` is set.
- Earnings use Yahoo with a crumb/cookie handshake by default. Twelve Data can be selected with `EARNINGS_PROVIDER=twelvedata`, but some earnings endpoints are plan-gated.

## API

```bash
GET /api/runtime-reliability
GET /api/health
GET /api/ready
GET /api/fundamentals/sec-queue
POST /api/runtime-reliability/actions
```

`/api/health` includes a compact `runtime_reliability` section. `/api/runtime-reliability` returns the complete source-by-source view.
`/api/ready` separates HTTP readiness from live-source warmup, which is useful on the Pi because the dashboard can be reachable while collectors are still starting.
`/api/fundamentals/sec-queue` exposes SEC fundamentals coverage progress, pending live-SEC counts, pending sectors, and the next bounded refresh batch.

## Operator actions

The action endpoint is intentionally one-shot. It does not turn on permanent background polling and it does not rewrite `.env`.

Supported payloads:

```json
{ "action": "snapshot" }
{ "action": "refresh_universe" }
{ "action": "save_lightweight_state" }
{ "action": "backup_now" }
{ "action": "apply_profile", "profile": "emergency", "apply": false }
{ "action": "apply_profile", "profile": "live_news_only", "apply": true }
{ "action": "apply_profile", "profile": "autonomous_live", "apply": true }
{ "action": "apply_profile", "profile": "alpaca_marketaux_live", "apply": true }
{ "action": "poll_once", "source": "live_news" }
{ "action": "poll_once", "source": "market_flow" }
{ "action": "poll_once", "source": "earnings_calendar" }
{ "action": "poll_once", "source": "stocktwits_stream" }
{ "action": "poll_once", "source": "trade_prints" }
{ "action": "poll_once", "source": "sec_form4" }
{ "action": "poll_once", "source": "sec_13f" }
{ "action": "poll_once", "source": "sec_fundamentals" }
{ "action": "poll_once", "source": "fundamental_market_data" }
```

Disabled sources are blocked by default and return a clear error. Unconfigured sources stay visible in the dashboard with the exact missing key/provider requirement.

## System tab control console

The dashboard System tab is the operator surface for the agent. It separates passive telemetry from actions:

- SEC fundamentals batch: advances the live SEC coverage by the configured batch size.
- Save lightweight state: writes the compact JSON runtime snapshot immediately.
- Market flow scan: runs one flow pass without enabling background polling.
- SEC 13F scan: runs one slower institutional-flow pass.

The expected Pi workflow is:

1. Keep `pi_light` active.
2. Run one SEC fundamentals batch.
3. Watch runtime pressure and live SEC coverage.
4. Repeat later until pending names receive SEC-backed fundamentals.

This gives the system forward progress without returning to the heavy SQLite backup loop that overloaded the Pi.

State-changing one-shot actions auto-save the lightweight JSON snapshot when `LIGHTWEIGHT_STATE_ENABLED=true` and `DATABASE_ENABLED=false`. The separate Save Lightweight State button remains available as a manual checkpoint, but normal SEC/news/flow one-shot actions no longer require a second save click.

For hands-off but still bounded SEC progress, use the catch-up CLI instead of pressing the System tab button repeatedly:

```bash
npm run sec:catchup -- --max-batches 5 --delay-ms 2000
```

The helper calls the same one-shot runtime action as the dashboard. It does not enable background polling and it does not rewrite `.env`. On the Pi, each batch uses `FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL`, so `pi_light` normally refreshes up to 8 names per batch. The command prints one progress line per batch, then a final JSON summary with live SEC count, remaining pending live-SEC count, runtime status, and lightweight-state save status.

Useful variants:

```bash
npm run sec:catchup -- --max-batches 1
npm run sec:catchup -- --max-batches 10 --delay-ms 5000
npm run sec:catchup -- --force-universe --max-batches 3
```

Stop after any run if runtime pressure rises, Cloudflare starts returning 502, or the SEC action reports repeated error-only batches. The point is steady coverage progress, not maximum throughput.

## Trade Setup integration

The Trade Setup Agent consumes the Runtime Reliability Agent as an engine input. It does not merely display runtime status.

For each setup, the agent calculates a runtime adjustment from:

- source status: healthy, fallback, manual, pending, stale, degraded, error, or disabled
- source criticality: critical, high, medium, or low
- runtime pressure: Pi performance mode, memory pressure, and load pressure
- overall runtime status: optimal, caution, constrained, or degraded

Storage-only sources are excluded from the trade penalty, because a disabled database changes durability, not current signal quality. Planned optional sources that are disabled in `.env`, such as StockTwits or delayed trade prints, are also excluded from the trade penalty. A source that is currently `polling` is treated as in progress, not degraded.

The final setup contains:

- `runtime_reliability.adjustment_multiplier`
- `runtime_reliability.penalty`
- `runtime_reliability.degraded_sources`
- `score_components.raw_long` and `score_components.raw_short`
- `score_components.runtime_multiplier`

Conviction and position size are calculated after this adjustment. That means a setup can move from long/short to watch, or shrink its position size, when the system is running on fallback data or constrained Pi resources.

## SEC fundamentals batching

SEC fundamentals is intentionally treated as a heavy source. The collector uses `FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL` to cap each poll:

- `0` means refresh the full tracked universe in one poll.
- In `pi_light`, the profile sets `FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL=8`.
- In `full_live`, the profile sets `FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL=24`.

Each bounded poll prioritizes allowed-universe names that do not yet have SEC-backed fundamentals, then rotates through already SEC-live companies on later polls. The full 168-stock universe is preserved as metadata while the batch refresh is running; unprocessed names remain outside scored fundamentals until live SEC rows exist.

Health fields exposed under `live_sources.sec_fundamentals`:

- `tracked_companies`: full fundamentals universe size.
- `refresh_limit`: configured max names per SEC poll.
- `refresh_batch_size`: number selected for the current poll.
- `refresh_cursor`: retry cursor used when a batch cannot advance because all selected names failed.
- `live_companies`: total SEC-backed companies after the poll.
- `pending_live_sec_companies`: names still waiting for live SEC refresh.

For a direct operator view of the SEC queue:

```bash
curl -s "http://127.0.0.1:3000/api/fundamentals/sec-queue?limit=10"
```

This returns the full tracked count, live SEC count, remaining pending live-SEC count, pending sector distribution, and a preview of the next names that a System tab SEC batch or `npm run sec:catchup` will attempt.

## Runtime profiles

Profiles are predefined `.env` operating modes:

- `api_saver_testing`: manual-only testing mode; dashboard stays usable while external API calls happen only after explicit refresh/test actions
- `emergency`: lowest-load recovery mode
- `live_news_only`: first live-data step using RSS news only
- `pi_light`: balanced Pi mode with expensive collectors manual
- `full_live`: maximum live coverage for a stable machine or off-Pi deployment

In Pi-oriented profiles, `DATABASE_ENABLED=false` and `LIGHTWEIGHT_STATE_ENABLED=true`. That keeps SQLite and backup load off the Pi while still saving a compact JSON runtime snapshot under `data/runtime-state.json`. The snapshot preserves the current fundamentals universe, SEC refresh progress, recent sentiment context, evidence quality, macro state, and trade setup state across service restarts.

Lightweight state knobs:

- `LIGHTWEIGHT_STATE_ENABLED=true`
- `LIGHTWEIGHT_STATE_PATH=data/runtime-state.json`
- `LIGHTWEIGHT_STATE_MAX_DOCUMENTS=300`

This is not a long-term analytical warehouse. It is a safe Pi recovery cache. Use SQLite/Postgres/off-Pi persistence again when you want durable history, larger evidence storage, or richer analytics.

Profile actions are preview-only unless `apply=true` is included. Applying a profile writes `.env`, updates in-process config where possible, and returns a message reminding the operator to restart the service so timers and startup behavior fully reload.

The same profiles are available from the terminal:

```bash
npm run runtime:profiles
npm run runtime:profile -- preview api_saver_testing
npm run runtime:profile -- apply api_saver_testing --yes
npm run runtime:profile -- preview live_news_only
npm run runtime:profile -- apply live_news_only --yes
sudo systemctl restart sentiment-analyst.service
```

The CLI creates an `.env` backup under `data/env-backups/` before writing.

## SQLite health and recovery

When SQLite is enabled, use the health check before restarting into a heavy persistence mode:

```bash
npm run sqlite:health
npm run sqlite:health -- --full
```

The default check uses SQLite `quick_check`; `--full` runs `integrity_check`. If the database is malformed, the command exits non-zero and prints the newest backup plus exact recovery commands.

Recommended recovery flow:

```bash
sudo systemctl stop sentiment-analyst.service
mv /home/ahad/sentiment-analyst/data/sentiment-analyst.sqlite /home/ahad/sentiment-analyst/data/sentiment-analyst.sqlite.bad-$(date +%Y%m%d-%H%M%S)
cp /home/ahad/sentiment-analyst/data/backups/<backup-file>.sqlite /home/ahad/sentiment-analyst/data/sentiment-analyst.sqlite
sudo chown ahad:ahad /home/ahad/sentiment-analyst/data/sentiment-analyst.sqlite
npm run sqlite:health
sudo systemctl start sentiment-analyst.service
```

In `pi_light`, SQLite is normally disabled and lightweight JSON state is preferred, so a malformed SQLite file should not block the dashboard. Treat SQLite recovery as a deliberate operator step before returning to full persistence.

## Contract check

The runtime reliability contract check verifies the offline Pi-safe path:

```bash
npm run check:runtime-reliability
```

It confirms source coverage, profile availability, guarded action behavior, health embedding, the 168-stock fundamentals universe, lightweight JSON state saving, and lightweight restore after a simulated restart.

## Current limits

The agent still does not automatically rewrite `.env`, restart collectors, or pause collectors. That is intentional: the Pi should not be surprised by hidden automation.

The next safe step is to add explicit operator actions:

- pause or resume a collector
- require confirmation before enabling high-cost sources
- apply a recommended `.env` profile
