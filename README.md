# Sentiment Analyst MVP

This repository contains a buildable MVP of the Sentiment Analyst pipeline described in the original note. It includes exact contracts, a working runtime pipeline, a live dashboard, and sample replay data so you can iterate locally before wiring in live collectors and a real LLM.

## What is included

- Exact PostgreSQL DDL in [sql/postgres-schema.sql](/C:/Users/meiri/OneDrive/Documents/trading%20system/sql/postgres-schema.sql)
- JSON Schemas in [schemas](/C:/Users/meiri/OneDrive/Documents/trading%20system/schemas)
- OpenAPI contract in [openapi/openapi.yaml](/C:/Users/meiri/OneDrive/Documents/trading%20system/openapi/openapi.yaml)
- A Node runtime pipeline in [src](/C:/Users/meiri/OneDrive/Documents/trading%20system/src)
- A live browser dashboard in [src/public/index.html](/C:/Users/meiri/OneDrive/Documents/trading%20system/src/public/index.html)
- A dedicated Fundamental Analyst dashboard in [src/public/fundamentals.html](/C:/Users/meiri/OneDrive/Documents/trading%20system/src/public/fundamentals.html)
- Replayable sample market events in [data/sample-events.json](/C:/Users/meiri/OneDrive/Documents/trading%20system/data/sample-events.json)
- Replayable sample fundamental coverage in [data/sample-fundamentals.json](/C:/Users/meiri/OneDrive/Documents/trading%20system/data/sample-fundamentals.json)
- Extension docs in [docs/architecture.md](/C:/Users/meiri/OneDrive/Documents/trading%20system/docs/architecture.md) and [docs/prompt-pack.md](/C:/Users/meiri/OneDrive/Documents/trading%20system/docs/prompt-pack.md)
- Plain user instructions for operating the 12-agent trading workflow in [docs/user-guide.md](docs/user-guide.md)
- The canonical Unusual Trading Activity Agent UX source map in [ux design/README.md](ux%20design/README.md)
- The UTA Node-first runtime policy in [docs/uta-stack-runtime-policy.md](docs/uta-stack-runtime-policy.md)
- The UTA provider adapter matrix in [docs/uta-provider-adapter-matrix.md](docs/uta-provider-adapter-matrix.md)

## Commands

Run these from `C:\Users\meiri\OneDrive\Documents\trading system`.

```bash
node scripts/check.js
node scripts/replay.js
node scripts/sqlite-backup.js
npm run build:uta
node src/server.js
```

`node scripts/check.js` defaults to `DATABASE_ENABLED=false` so local contract checks do not depend on a healthy SQLite file.

Then open `http://127.0.0.1:3000`.

For the new fundamentals view, open `http://127.0.0.1:3000/fundamentals.html`.

For the Unusual Trading Activity live scanner, open `http://127.0.0.1:3000/uta`.

During UTA frontend work, edit the React/Vite source under `src/uta/`, then run:

```bash
npm run build:uta
```

The build writes the Node-served static files to `src/public/uta/`.

UTA verification commands:

```bash
npm run check:uta-contracts
npm run check:uta-engine
npm run check:uta-api
npm run check:uta-ui
npm run check:uta-ux-parity
npm run check:uta-provider-preflight
npm run check:uta-pi-profile
```

## Current runtime notes

- The MVP uses Server-Sent Events instead of WebSockets to stay dependency-light.
- The LLM scorer is simulated deterministically from the rule engine so the full flow remains runnable offline.
- Storage is in memory at runtime, while the exact production storage contracts are already defined in SQL and JSON Schema artifacts.
- The server now includes a live Google News RSS collector for the watchlist. It polls in the background and pushes new items through the same pipeline as the sample replay feed.
- Market data can now come from a real provider-backed adapter. The default is `synthetic`, but if you set `TWELVE_DATA_API_KEY`, the app will automatically switch to `twelvedata` unless you override `MARKET_DATA_PROVIDER`.
- A live market-flow monitor can now turn abnormal price and volume spikes into fast money-flow events when real market data is configured.
- The server now also includes an SEC Form 4 insider-flow collector that polls official EDGAR filings for tracked tickers and turns insider buys/sells into live pipeline events.
- The server now includes an SEC 13F collector that compares recent institutional holdings filings from tracked managers and turns watchlist position changes into institutional flow events.
- The server now also includes a deterministic Fundamental Analyst MVP with sector-first ranking, company scorecards, confidence logic, and a dedicated dashboard page.
- The Fundamental Analyst can now refresh covered companies from live SEC submissions and Company Facts data, with fallback to the local replay dataset when SEC data is unavailable.
- The Fundamental Analyst now also materializes an auditable warehouse-style persistence layer in dedicated tables, exposed through `/api/fundamentals/storage/summary` and `/api/fundamentals/storage/ticker/{ticker}`.
- SQLite deployments now produce scheduled snapshot backups with retention, so the single-machine Pi setup has a recovery path without requiring PostgreSQL first.
- The Fundamental Analyst now exposes a real stage-one initial screener before the full ranking model, with `eligible`, `watch`, and `reject` states.
- The dashboard now also includes a Macro Regime Agent that scores top-down conditions and adjusts long/short thresholds and exposure.
- The dashboard now also includes a Trade Setup Agent that turns sentiment, money flow, alerts, and fundamentals into ranked `long`, `short`, `watch`, and `no_trade` ideas.
- Macro-regime snapshots, deterministic trade setups, LLM reviews, final-selection candidates, passed trading selections, risk snapshots, portfolio monitor snapshots, execution intents, and agency-cycle states are now persisted in dedicated SQLite/Postgres audit tables.
- The runtime now includes an Evidence Quality Agent that scores every document after classification and before aggregation, so dashboards and downstream agents share one trust layer for freshness, duplication, corroboration, source quality, and display tier.
- The runtime now includes a Runtime Reliability Agent that evaluates Pi/system pressure, source freshness, fallback mode, collector errors, and auto-start policy before heavier live-source load is enabled.
- The runtime now includes an Execution Agent with a guarded Alpaca broker adapter. It can preview paper-trading orders from Trade Setup Agent output, while real submission stays disabled until explicit broker safety flags are configured.
- The runtime now includes a Portfolio Risk Agent that checks proposed orders against gross exposure, single-name exposure, open-order count, and runtime-pressure policy before execution.
- The runtime now includes a Position Monitor Agent that compares Alpaca positions and open orders against the latest Trade Setup Agent view.
- Decision signals now enforce freshness: non-filing market/news/flow evidence older than `SIGNAL_FRESHNESS_MAX_HOURS` is skipped from scoring, alerts, macro regime, trade setups, and dashboard feeds. Automatic seed-data replay is disabled by default.

## SQLite backup and retention

When `DATABASE_PROVIDER=sqlite`, the app can create consistent snapshot backups using SQLite's own `VACUUM INTO` flow. This is safer than copying the live database file directly because the app runs with WAL mode enabled.

Useful environment variables:

```bash
SQLITE_BACKUP_ENABLED=true
SQLITE_BACKUP_DIR=data/backups
SQLITE_BACKUP_INTERVAL_MS=21600000
SQLITE_BACKUP_RETENTION_COUNT=28
SQLITE_BACKUP_RETENTION_DAYS=14
SQLITE_BACKUP_ON_STARTUP=true
```

Useful commands:

```bash
node scripts/sqlite-backup.js
npm run sqlite:backup
```

The dashboard health/config payloads now also report the latest backup status so you can confirm the Pi is protecting its local database.

## Initial screener

The fundamentals flow now starts with an explicit stage-one screen before the final composite ranking. The screener uses the currently tracked coverage set and checks for:

- large-cap scale
- filing quality and freshness
- minimum growth
- minimum profitability
- acceptable balance sheet
- acceptable cash conversion
- valuation sanity

Each company is classified as:

- `eligible`: passes the first-stage gate and enters the ranked candidate set cleanly
- `watch`: worth monitoring, but not strong enough to clear the first screen
- `reject`: fails the current first-pass gate

This stage is exposed in the Fundamentals dashboard and through `/api/fundamentals/dashboard`.

## Trade Setup Agent

The Trade Setup Agent sits on top of the existing collectors and combines:

- short-term sentiment state
- recent high-confidence documents
- money-flow evidence
- alert history
- fundamentals and screener stage
- Evidence Quality Agent weights for recent supporting documents

It produces a ranked trade plan with:

- action: `long`, `short`, `watch`, or `no_trade`
- conviction
- suggested position size
- timeframe
- entry zone
- stop loss
- take profit
- thesis and risk flags

The Trade Setup Agent is also macro-aware. It consumes the current Macro Regime Agent snapshot so that:

- risk-on conditions loosen long thresholds and allow larger gross exposure
- risk-off conditions raise the bar for longs and support defensive or short-biased positioning
- high-dispersion conditions keep the engine selective even when individual names still look interesting

Useful endpoints:

```bash
GET /api/trade-setups
GET /api/trade-setups?window=1h&limit=6
GET /api/trade-setups/ticker/NVDA
GET /api/trade-setups/storage/summary
GET /api/trade-setups/storage/ticker/NVDA
```

## User workflow

The intended dashboard flow is:

- Start on `Dashboard` to see the current market pulse, ticker leaderboard, decision flow, and Trade Setup Agent lists.
- Use `Fundamentals` / `Fundamentals V2` to inspect why a stock is `eligible`, `watch`, `reject`, or still waiting for live SEC coverage.
- Use `Markets` for active-conviction comparison only. It intentionally hides fundamentals-only names with no fresh signal evidence.
- Use `Signals` / `Alerts` to inspect the source, timestamp, evidence quality, and reason behind each signal before trusting it.
- Use `Trading Plan` as the main action workspace. It shows the compiled `Buy Candidates`, `Short / Sell Candidates`, and `Watch List`, plus Alpaca paper readiness, risk status, open positions, and execution preview controls.
- Use Execution/Risk/Position endpoints or dashboard controls to preview Alpaca paper orders. Order submission remains blocked unless credentials, safety flags, risk approval, and confirmation phrase are present.

## End-to-end workflow readiness

The system now exposes one workflow gate for the complete path from live evidence to guarded paper execution:

```bash
GET /api/trading-workflow/status
GET /api/trading-workflow/status?window=1h&limit=25
npm run check:workflow
```

The workflow gate is intentionally strict. It blocks decision-ready status when seed/sample data is enabled, when there is no fresh market evidence inside `SIGNAL_FRESHNESS_MAX_HOURS`, when the app is still starting, or when the Portfolio Risk Agent has a hard block. SEC filings and quarterly fundamentals can remain useful as long-horizon context, but stale news, money-flow, or alert evidence is not allowed to drive trade decisions.

The Trading Plan screen uses this status to show:

- `Decision Ready`: fresh production evidence is available and seed data is blocked.
- `Preview Ready`: the current trade plan can be converted into order previews.
- `Paper Submit Ready`: Alpaca paper credentials, broker safety flags, risk gates, and confirmation gates are all aligned.

The same panel also exposes one-shot live refresh buttons for News, SEC Form 4, Market Flow, Pricing, and SEC Fundamentals batches. These buttons call the guarded Runtime Reliability action endpoint and do not turn on permanent background polling.

## Execution Agent and Alpaca integration

The Execution Agent sits after the Trade Setup Agent. It turns a qualified `long` or `short` setup into a broker-ready order preview, then blocks actual submission unless Alpaca credentials and explicit safety flags are present.

Default behavior is preview-only:

```bash
BROKER_PROVIDER=alpaca
BROKER_ADAPTER=rest
BROKER_TRADING_MODE=paper
BROKER_SUBMIT_ENABLED=false
ALPACA_API_KEY_ID=
ALPACA_API_SECRET_KEY=
EXECUTION_MIN_CONVICTION=0.62
EXECUTION_MAX_ORDER_NOTIONAL_USD=1000
EXECUTION_MAX_POSITION_PCT=0.03
```

Useful endpoints:

```bash
GET /api/execution/status
GET /api/execution/account
GET /api/execution/positions
GET /api/execution/orders
POST /api/execution/preview
POST /api/execution/orders
GET /api/risk/status
POST /api/risk/evaluate
GET /api/positions/monitor
```

Contract check:

```bash
npm run check:execution
```

Alpaca MCP paper-trading checks:

```bash
npm run check:alpaca-mcp
npm run check:alpaca-mcp-broker
```

Set `BROKER_ADAPTER=mcp` to route the Execution, Risk, and Position Monitor agents through the official Alpaca MCP server instead of direct REST. The MCP path still uses the same preview, risk, and confirmation gates.

The full design is documented in [docs/execution-agent.md](/C:/Users/meiri/OneDrive/Documents/trading%20system/docs/execution-agent.md).

The risk gate is documented in [docs/risk-agent.md](/C:/Users/meiri/OneDrive/Documents/trading%20system/docs/risk-agent.md).
The position monitor is documented in [docs/position-monitor-agent.md](/C:/Users/meiri/OneDrive/Documents/trading%20system/docs/position-monitor-agent.md).

## Evidence Quality Agent

The Evidence Quality Agent is the reusable trust layer in the data pipeline. It runs after document scoring and before sentiment aggregation, alerts, macro regime, trade setup generation, and dashboard display.

For each scored document, it evaluates:

- freshness
- source reliability
- classification confidence
- duplicate risk
- corroboration from other recent sources
- extraction quality
- ticker mapping confidence

It produces:

- `data_quality_label`: `high_quality`, `needs_confirmation`, `stale`, `duplicate`, `low_signal`, or `source_limited`
- `display_tier`: `alert`, `watch`, `context`, or `suppress`
- `downstream_weight`: a 0-1 multiplier used by downstream analysis
- `explanation`: a human-readable reason for the quality verdict

Useful endpoint:

```bash
GET /api/evidence-quality
GET /api/evidence-quality?ticker=NVDA
GET /api/evidence-quality?tier=alert
```

Engine contract check:

```bash
npm run check:evidence-quality
```

The detailed design and criteria are documented in [docs/evidence-quality-agent.md](/C:/Users/meiri/OneDrive/Documents/trading%20system/docs/evidence-quality-agent.md).

## Source Reliability

Live news now uses Google News RSS first and Yahoo Finance RSS as a no-key fallback. SEC collectors use retry-aware requests so transient aborts/timeouts are reported clearly and retried before collector health is marked degraded.

Details are documented in [docs/source-reliability.md](/C:/Users/meiri/OneDrive/Documents/trading%20system/docs/source-reliability.md).

## Runtime Reliability Agent

The Runtime Reliability Agent is the backend traffic-control layer for the Pi and live sources. It observes source health, `.env` auto-start policy, fallback providers, lightweight/SQLite persistence state, process memory, host memory, and CPU load. It then returns a collector plan that tells the dashboard, deploy scripts, and future orchestration logic which sources are safe to auto-start, which should stay manual, and which need investigation.

Useful endpoint:

```bash
GET /api/runtime-reliability
GET /api/ready
GET /api/fundamentals/sec-queue
POST /api/runtime-reliability/actions
```

The compact summary is also embedded in `/api/health` as `runtime_reliability`.
`/api/ready` reports whether HTTP is listening, initialization is complete, and live collectors have finished their startup warmup.

The action endpoint supports guarded one-shot operations such as `poll_once` for a single source, `refresh_universe`, and `backup_now`. It does not enable permanent background polling or rewrite `.env`.

It also exposes runtime profile previews for `emergency`, `live_news_only`, `pi_light`, `autonomous_live`, `alpaca_marketaux_live`, and `full_live`. Profile application requires an explicit `apply=true` payload and a service restart afterward.

Pi-oriented profiles keep SQLite off and use `LIGHTWEIGHT_STATE_ENABLED=true`, writing a compact JSON state file to `data/runtime-state.json`. This preserves SEC fundamentals batch progress and recent runtime context across restarts without reintroducing heavy SQLite writes or backups.

Contract check:

```bash
npm run check:runtime-reliability
```

Terminal helper:

```bash
npm run runtime:profiles
npm run runtime:profile -- preview live_news_only
npm run runtime:profile -- apply live_news_only --yes
npm run sec:catchup -- --max-batches 5 --delay-ms 2000
```

`sec:catchup` is the safe Pi helper for SEC fundamentals progress. It runs bounded one-shot SEC batches, auto-saves lightweight JSON state when Pi mode is using JSON state, and reports live SEC coverage plus remaining bootstrap placeholders.
`/api/fundamentals/sec-queue` shows the same SEC coverage queue from the API, including pending bootstrap names by sector and the next batch preview.

The full design is documented in [docs/runtime-reliability-agent.md](/C:/Users/meiri/OneDrive/Documents/trading%20system/docs/runtime-reliability-agent.md).

## Pi Performance Mode

Set this on Raspberry Pi deployments:

```bash
PI_PERFORMANCE_MODE=true
```

This lowers polling frequency, SEC concurrency, retry pressure, autosave frequency, and SQLite backup churn unless those values are explicitly overridden in `.env`.

Explicit `.env` values always win. For example, if `SQLITE_BACKUP_RETENTION_COUNT=6` is already set, Pi mode will keep using `6`.

In Pi mode, heavy collectors do not auto-start unless explicitly enabled:

```bash
AUTO_START_MARKET_FLOW=false
AUTO_START_SEC_13F=false
AUTO_START_SEC_FUNDAMENTALS=false
AUTO_START_FUNDAMENTAL_MARKET_DATA=false
```

Manual endpoints and scripts can still refresh data when needed; the goal is to keep normal dashboard serving lightweight.

Useful endpoint:

```bash
GET /api/performance
```

## Macro Regime Agent

The Macro Regime Agent summarizes the top-down backdrop by combining:

- market-level sentiment state
- sector and ticker breadth
- recent accumulation versus distribution flow
- alert balance
- fundamental breadth and screener pass rate

It classifies the environment into:

- `risk_on`
- `risk_off`
- `high_dispersion`
- `balanced`

Each snapshot includes:

- regime and bias labels
- conviction
- exposure multiplier
- long and short thresholds
- supporting signals and risk flags

Useful endpoints:

```bash
GET /api/macro-regime
GET /api/macro-regime?window=1h
GET /api/macro-regime/history
```

## Agent audit trail

Agent outputs are written into dedicated relational audit tables in the configured persistence provider. This makes the system easier to inspect, backtest, and debug after restart.

Core audit tables:

- `fundamental_scores`: factor-level Fundamentals Agent scores
- `macro_regime_states`: Market Agent regime, thresholds, and exposure posture
- `trade_setup_states`: Deterministic Selection Agent setup scores and price plan
- `llm_selection_reviews`: LLM Selection Agent action, confidence, concerns, missing data, and prompt metadata
- `final_selection_candidates`: Final Selection Agent arbitration result, score components, policy gates, and selection report
- `trading_selection_passes`: only candidates that passed Final Selection for supervised Alpaca preview
- `risk_snapshots`: Risk Manager portfolio/risk state
- `position_monitor_snapshots`: Portfolio Monitor state
- `execution_intents`: Execution Agent preview/submission intent records
- `agency_cycle_states`: Command-center cycle/readiness state

Useful inspection endpoints:

```bash
GET /api/macro-regime/history
GET /api/trade-setups/storage/summary
GET /api/trade-setups/storage/ticker/NVDA
```

Useful audit checks:

```bash
npm run sqlite:health
npm run check:sqlite-agent-audit
```

## Live news collector

The live collector is enabled by default and uses Google News RSS queries for the current watchlist names. If network access is unavailable, the app still works with replay data and the collector records its status in `/api/health`.

Useful environment variables:

```bash
LIVE_NEWS_ENABLED=true
LIVE_NEWS_POLL_MS=300000
LIVE_NEWS_MAX_ITEMS_PER_TICKER=3
LIVE_NEWS_LOOKBACK_HOURS=24
LIVE_NEWS_REQUEST_TIMEOUT_MS=12000
```

Set `LIVE_NEWS_ENABLED=false` if you want an offline-only session.

## Signal freshness policy

Trading decisions should not be influenced by stale news, stale market-flow, or old seeded examples. The default policy is:

- non-filing market/news/macro/flow evidence must be no older than 72 hours
- SEC filings, institutional filings, and quarterly/fundamental evidence are allowed as long-horizon context
- automatic startup replay of sample data is disabled
- seed/sample replay data is excluded from decisions unless explicitly enabled for offline testing

Useful environment variables:

```bash
SIGNAL_FRESHNESS_MAX_HOURS=72
SEED_DATA_ON_EMPTY=false
SEED_DATA_IN_DECISIONS=false
```

## Live news provider

The live news collector tries Marketaux first when a key is present, then falls back to Google News RSS and Yahoo Finance RSS. Marketaux articles preserve their source URLs, entity symbols, match scores, and sentiment fields so the Signals Agent can explain where each alert came from.

Useful environment variables:

```bash
MARKETAUX_ENABLED=true
MARKETAUX_API_KEY=your_key_here
MARKETAUX_SYMBOLS_PER_REQUEST=20
MARKETAUX_MAX_ITEMS_PER_TICKER=3
LIVE_NEWS_POLL_MS=600000
```

Leave `MARKETAUX_API_KEY` empty to use the no-key RSS fallback path.

## Market data provider

The ticker detail chart and market snapshot now support Alpaca Market Data and Twelve Data, with automatic fallback to the synthetic local series if no live provider is configured or the provider request fails. Alpaca is preferred automatically when Alpaca keys are present and `MARKET_DATA_PROVIDER` is not explicitly set.

Useful environment variables:

```bash
MARKET_DATA_PROVIDER=alpaca
ALPACA_MARKET_DATA_ENABLED=true
ALPACA_MARKET_DATA_FEED=iex
ALPACA_API_KEY=your_alpaca_key
ALPACA_SECRET_KEY=your_alpaca_secret

# Optional backup provider
TWELVE_DATA_API_KEY=your_key_here
MARKET_DATA_INTERVAL=15min
MARKET_DATA_HISTORY_POINTS=18
MARKET_DATA_CACHE_MS=60000
MARKET_DATA_REFRESH_MS=60000
MARKET_DATA_REQUEST_TIMEOUT_MS=12000
```

Set `MARKET_DATA_PROVIDER=synthetic` if you want to force the local deterministic adapter.

## Live market flow

The market-flow monitor uses the configured market data provider and scans the latest bars for abnormal volume and price shock conditions. When a spike clears the configured thresholds, it emits fast `money_flow` events like abnormal volume buying/selling or block trade accumulation/distribution.

Useful environment variables:

```bash
MARKET_FLOW_ENABLED=true
MARKET_FLOW_POLL_MS=60000
MARKET_FLOW_VOLUME_SPIKE_THRESHOLD=2.2
MARKET_FLOW_MIN_PRICE_MOVE_THRESHOLD=0.01
MARKET_FLOW_BLOCK_TRADE_SPIKE_THRESHOLD=3.8
MARKET_FLOW_BLOCK_TRADE_SHOCK_THRESHOLD=2.2
```

This monitor only produces meaningful live signals when a real market data provider is configured.

## Fundamental market/reference data

The Fundamental Analyst now supports a live-capable market/reference adapter for valuation and reference fields such as current price, market capitalization, enterprise value, shares outstanding, beta, trailing P/E, EV/EBITDA, price-to-sales, and PEG. Twelve Data can provide a broader reference payload through `quote` and `statistics`; Alpaca can provide partial live price/change fields while SEC and the local fundamental model keep supplying business metrics. Both paths fall back to synthetic reference data if the provider is unavailable or no key is configured.

Useful environment variables:

```bash
FUNDAMENTAL_MARKET_DATA_PROVIDER=alpaca
ALPACA_API_KEY=your_alpaca_key
ALPACA_SECRET_KEY=your_alpaca_secret

# Optional broader reference provider
TWELVE_DATA_API_KEY=your_key_here
FUNDAMENTAL_MARKET_DATA_CACHE_MS=900000
FUNDAMENTAL_MARKET_DATA_REFRESH_MS=900000
FUNDAMENTAL_MARKET_DATA_REQUEST_TIMEOUT_MS=12000
```

Set `FUNDAMENTAL_MARKET_DATA_PROVIDER=synthetic` if you want to force offline fallback mode for the Fundamental Analyst.

## Live SEC fundamentals

The Fundamental Analyst now includes a live SEC fundamentals collector that polls official EDGAR submissions metadata and Company Facts XBRL data for the covered companies, maps a core canonical metric set, and refreshes the fundamentals leaderboard while preserving the existing replay fallback.

Useful environment variables:

```bash
FUNDAMENTAL_SEC_ENABLED=true
FUNDAMENTAL_SEC_POLL_MS=21600000
FUNDAMENTAL_SEC_LOOKBACK_HOURS=10800
SEC_REQUEST_TIMEOUT_MS=15000
SEC_TICKER_MAP_CACHE_MS=86400000
SEC_USER_AGENT="SentimentAnalyst/1.0 contact=you@example.com"
```

Set a real contact in `SEC_USER_AGENT` for production-style use. Set `FUNDAMENTAL_SEC_ENABLED=false` if you want the Fundamental Analyst to stay replay-only.

## Fundamental warehouse inspection

The app now materializes the current fundamentals run into table-shaped records that mirror the PostgreSQL design, including coverage rows, filing events, financial periods, financial facts, market reference rows, feature rows, score rows, and state rows. These records are written into dedicated relational tables in the configured local persistence provider and are rehydrated on startup, so the warehouse survives restart without relying on a single runtime-state blob.

Useful endpoints:

```bash
GET /api/fundamentals/storage/summary
GET /api/fundamentals/storage/ticker/AAPL
GET /api/fundamentals/storage/ticker/AAPL/filings
GET /api/fundamentals/storage/ticker/AAPL/facts/revenue?periodType=quarterly
```

## SEC Form 4 insider flow

The insider collector uses official SEC endpoints for ticker-to-CIK mapping, company submission history, and filing archive documents. It is enabled by default and polls recent Form 4 and Form 4/A filings for the tracked watchlist names.

Useful environment variables:

```bash
SEC_FORM4_ENABLED=true
SEC_FORM4_POLL_MS=600000
SEC_FORM4_LOOKBACK_HOURS=72
SEC_REQUEST_TIMEOUT_MS=15000
SEC_TICKER_MAP_CACHE_MS=86400000
SEC_USER_AGENT="SentimentAnalyst/1.0 contact=you@example.com"
```

Set a real contact in `SEC_USER_AGENT` for production-style use. Set `SEC_FORM4_ENABLED=false` if you want to disable insider ingestion.

## SEC 13F institutional flow

The institutional collector tracks a small set of major filers and compares the latest and previous 13F information tables for watchlist names. Because 13F is a quarterly filing regime, this is slower-moving than the live news and Form 4 collectors, but it gives the system a first official institutional-flow signal.

Useful environment variables:

```bash
SEC_13F_ENABLED=true
SEC_13F_POLL_MS=43200000
SEC_13F_LOOKBACK_HOURS=2400
```

Set `SEC_13F_ENABLED=false` if you want to disable institutional holdings ingestion.
