# Unusual Trading Activity Agent — Ticket-Based Implementation Plan

**Based on:** unusual-trading-activity-agent-v2-product-design.md
**Total tickets:** 64
**Phases:** 5
**Target deployment:** Raspberry Pi 5 · Cloudflare tunnel · Web browser

---

## Ticket Format

Each ticket includes:
- **ID / Title / Epic / Phase / Priority / Complexity**
- **Dependencies** (must complete before this starts) and **Blocks** (cannot start until this completes)
- **User Story** — who needs what and why
- **Technical Design** — what to build and how
- **Acceptance Criteria** — specific, testable conditions that define completion
- **Definition of Done (DoD)** — checklist that must be fully checked before closing
- **Testing Requirements** — unit, integration, and scenario tests
- **QA Checklist** — explicit QA scenarios from the v2 spec

**Priority:** P0 = must before next phase · P1 = required for phase · P2 = important · P3 = nice-to-have
**Complexity:** XS=half day · S=1 day · M=2–3 days · L=4–5 days · XL=1+ week

---

---

# PHASE 1 — CONTRACTS

*No production code. Deliverables are documents, schemas, and JSON policy files checked into the repo. Every Phase 2 ticket depends on the relevant Phase 1 contract being complete.*

---

## P1-01 · Condition Code Policy Document

**Epic:** Data Contracts | **Phase:** 1 | **Priority:** P0 | **Complexity:** S
**Depends on:** None | **Blocks:** P2-07, P2-08, P2-09, P4-04

### User Story
As a data engineer building the raw print normalizer, I need a locked, versioned list of exactly which SIP/CTS condition codes to hard-exclude, flag, or bucket into separate sessions, so that no non-directional print ever silently inflates a scored signal.

### Technical Design
- Create `config/condition_code_policy_v1.json` in the repo root.
- Schema:
```json
{
  "version": "v1",
  "effective_date": "YYYY-MM-DD",
  "hard_exclude": [
    {"code": "E", "description": "Corrected Consolidated Close"},
    {"code": "W", "description": "Average Price Trade"},
    {"code": "6", "description": "Derivatively Priced"},
    {"code": "4", "description": "Derivatively Priced (alternate)"},
    {"code": "P", "description": "Prior Reference Price"}
  ],
  "session_bucket": [
    {"code": "T", "description": "Form T (extended hours)", "bucket": "extended_hours"},
    {"code": "U", "description": "Extended Hours (FINRA)", "bucket": "extended_hours"}
  ],
  "flag_only": [
    {"code": "O", "description": "Opening Trade", "flag": "opening_print", "exclude_from": ["block_detection", "directional_scoring"]},
    {"code": "M", "description": "Close Trade", "flag": "closing_print", "exclude_from": ["block_detection", "directional_scoring"]},
    {"code": "Q", "description": "Official Open", "flag": "opening_print", "exclude_from": ["block_detection"]},
    {"code": "I", "description": "Odd Lot", "flag": "odd_lot", "exclude_from": ["block_detection"]}
  ],
  "separate_analysis": [
    {"code": "F", "description": "Intermarket Sweep (ISO)", "flag": "iso_sweep", "included_in": ["volume_count"], "excluded_from": ["focus_block_classification"]}
  ],
  "no_code": "eligible"
}
```
- This file is **read-only in production**. Any change requires a version bump (`v2`, etc.) and a new file — never edit `v1` in place.
- All signal result rows store `condition_code_policy_version: "v1"` for replay reproducibility.

### Acceptance Criteria
- [ ] JSON file validates against a JSON Schema (schema also committed to repo).
- [ ] Every condition code mentioned in v2 spec Section 4.5 is present in exactly one category.
- [ ] File includes `version` and `effective_date` fields.
- [ ] A companion `condition_code_policy.schema.json` is committed alongside the policy file.
- [ ] Policy is referenced in the repo README with a link to the spec section.

### Definition of Done
- [ ] `config/condition_code_policy_v1.json` committed to repo
- [ ] `config/condition_code_policy.schema.json` committed to repo
- [ ] JSON validates against its own schema (automated check in CI)
- [ ] Document reviewed by market microstructure expert or lead developer
- [ ] Policy version referenced in the data model DDL ticket (P1-06)

### Testing Requirements
- **Schema validation test:** `pytest tests/contracts/test_condition_code_policy.py` — asserts file validates against schema, no unknown categories, no duplicate codes.
- **Coverage test:** Assert all codes in the spec Section 4.5 are present in the policy file.

### QA Checklist
- [ ] Hard-exclude codes never appear in scored signal outputs (verified in P2-07 unit tests).
- [ ] `odd_lot` prints excluded from block detection but counted in total volume.
- [ ] ISO sweep prints counted in volume, not classified as focus/block prints.

---

## P1-02 · Baseline Window & Time Bucket Specification

**Epic:** Data Contracts | **Phase:** 1 | **Priority:** P0 | **Complexity:** S
**Depends on:** None | **Blocks:** P2-06, P2-15, P4-04

### User Story
As a quant developer building the baseline cache, I need an unambiguous definition of the baseline window, time bucket boundaries, earnings exclusion rules, and minimum sample requirements, so that B-scores are consistent, reproducible, and free of look-ahead bias.

### Technical Design
Create `docs/baseline-specification.md` with:

**Window:** 20 most recent completed trading days strictly before `as_of_date` (< not <=).
**Extended window:** 60 days (configurable per ticker via `ticker_profiles.baseline_window_days`).
**Minimum:** 10 usable sessions. Below threshold → `insufficient_history` state.
**Earnings exclusion:** Any session where an earnings release occurred for the ticker is excluded. Uses `earnings_calendar` table. Earnings sessions excluded from count — if exclusions reduce usable sessions below 10, state = `insufficient_history`.

**Time buckets:**

| ID | Label | Window (ET) | Notes |
|---|---|---|---|
| `open` | Opening | 09:30–10:00 | Highest variance |
| `morning` | Morning | 10:00–11:30 | Settling period |
| `midday` | Midday | 11:30–13:30 | Lowest liquidity |
| `afternoon` | Afternoon | 13:30–15:00 | Volume rebuild |
| `power_hour` | Power Hour | 15:00–15:45 | Elevated |
| `close` | Close | 15:45–16:00 | MOC/LOC — mostly excluded by condition code |

Each print is assigned to the time bucket containing its exchange timestamp. Prints with no exchange timestamp use participant timestamp with a documented fallback note.

**Baseline metrics stored per (ticker, as_of_date, time_bucket, metric):**
`volume`, `notional`, `trade_count`, `focus_notional_share`, `net_notional_pressure`, `abs_net_notional_pressure`, `focus_trade_count`, `largest_print_multiple`

**Pre-market baseline:** Separate window — all pre-market (04:00–09:30) prints across the 20 prior sessions. Not time-bucketed (one bucket: `pre_market`).

### Acceptance Criteria
- [ ] Document defines all 6 time bucket boundaries with exact ET times.
- [ ] Document specifies the strict `<` (not `<=`) rule for look-ahead safety.
- [ ] Earnings exclusion logic is described with an example.
- [ ] Minimum session count (10) is stated explicitly.
- [ ] All metrics stored in the baseline cache are enumerated.
- [ ] Pre-market baseline is specified as a separate window.

### Definition of Done
- [ ] `docs/baseline-specification.md` committed to repo
- [ ] Reviewed and signed off by lead developer
- [ ] Referenced in P1-06 DDL ticket

### Testing Requirements
- No code in Phase 1, but the spec includes example calculations that P2-06 unit tests must reproduce exactly.

### QA Checklist
- [ ] Replay mode uses `as_of_date - 1` as the latest baseline date (verified in P2-22 tests).
- [ ] Sessions with earnings releases are absent from baseline windows.
- [ ] Tickers with < 10 sessions return `insufficient_history` — not a score of 0.

---

## P1-03 · A/B/C Indicator Definitions Document

**Epic:** Data Contracts | **Phase:** 1 | **Priority:** P0 | **Complexity:** S
**Depends on:** P1-02 | **Blocks:** P2-15, P2-16, P2-17, P3-13

### User Story
As a frontend developer building the indicator display, I need precise definitions of what each indicator means, its units, its range, and how it is computed, so that I can render it correctly and write accurate UX labels.

### Technical Design
Create `docs/indicator-definitions.md`:

**Indicator A — Universe Percentile**
- Formula: `count(peers where metric < ticker.metric) / count(peers)`
- Range: [0.0, 1.0]
- Units: percentile (display as "Xth percentile" or "top X%")
- Available: Portfolio mode, Scan mode. Null in Single Ticker mode.
- Context label always required: "of [Universe Label] today (N tickers)"
- Computed per metric independently.

**Indicator B — Historical Robust Z-score**
- Formula: `(current_value − median_baseline) / (MAD_baseline × 1.4826)`
- Range: Unbounded. Typical range −4 to +10. Values > 5 are extreme.
- Units: σ (sigma / standard deviations)
- MAD scaling constant: 1.4826 (converts MAD to σ-equivalent for normal approximation)
- Available: All modes.
- Computed per metric per time bucket.
- Display: "3.8σ above own 20-session median"

**Indicator C — Raw Metric**
- Raw observed values in natural units. Never transformed.
- Display examples: "9.8× median notional", "$440M", "+72% signed pressure", "4 block prints"
- Used for ordering (C_screen, C_order formulas) — never displayed as a score number.

**C_screen formula (Pass 1 — bars only):**
```
C_screen = volume_ratio_from_bars × (1 + abs(daily_return))
```

**C_order formula (Pass 2 — full):**
```
C_order = volume_ratio
        × (1 + abs(net_notional_pressure))
        × (1 + focus_notional_share)
        × (1 + 0.5 × confirmed_alert_present)
```

### Acceptance Criteria
- [ ] Every indicator has: name, formula, range, units, availability per mode, display format.
- [ ] Both C formulas (Pass 1 and Pass 2) are specified with variable definitions.
- [ ] The 1.4826 MAD scaling constant is documented with its derivation rationale.
- [ ] Null behavior (A in single-ticker mode) is specified.

### Definition of Done
- [ ] `docs/indicator-definitions.md` committed
- [ ] Reviewed by lead developer

### Testing Requirements
- P2-15 and P2-16 unit tests use the exact formulas from this document.

---

## P1-04 · Lane State Contract Schema

**Epic:** Data Contracts | **Phase:** 1 | **Priority:** P0 | **Complexity:** S
**Depends on:** None | **Blocks:** P2-21, P3-20

### User Story
As a frontend developer, I need a JSON schema for the lane state object so I know exactly what fields to expect and can render lane health UI without guessing.

### Technical Design
Create `config/lane_state.schema.json` with all 8 states, allowed field values, and freshness SLA per lane type (from v2 spec Section 9).

Also create `config/lane_registry.json` listing every lane with its `freshness_sla_seconds`, `required` flag, `blocking` flag, and `refresh_route`.

### Acceptance Criteria
- [ ] Schema covers all 8 states with descriptions.
- [ ] Schema includes `progress`, `latest_as_of`, `freshness_seconds`, `freshness_sla_seconds`, `gaps`, `next_action`.
- [ ] Lane registry lists all 8 lanes from the v2 spec with correct SLAs.
- [ ] Schema validated with `jsonschema` in CI.

### Definition of Done
- [ ] `config/lane_state.schema.json` committed
- [ ] `config/lane_registry.json` committed
- [ ] CI validation passing

---

## P1-05 · API Response Schema

**Epic:** Data Contracts | **Phase:** 1 | **Priority:** P0 | **Complexity:** M
**Depends on:** P1-03, P1-04 | **Blocks:** P3-01 through P3-06

### User Story
As a frontend developer, I need a complete OpenAPI 3.0 spec for all API endpoints before I write a single line of UI code, so I can build against a stable contract even before the backend is ready.

### Technical Design
Create `api/openapi.yaml` covering:
- `GET /api/analyze/single?ticker=AVGO`
- `POST /api/analyze/portfolio` with body `{"tickers": [...]}`
- `GET /api/scan?universe=sp500&direction=bullish&pass=1`
- `GET /api/scan?universe=sp500&direction=bullish&pass=2&shortlist=AVGO,NVDA,...`
- `GET /api/universes` — list available universes with performance tier
- `GET /api/health` — system health and lane states
- `GET /api/alerts` — confirmed alert feed
- `GET /api/macro` — current FRED macro context
- `GET /api/events/scan` — SSE stream for progressive scan updates

Include all response shapes (success, partial, error), HTTP status codes, and header requirements. All models defined as reusable `$ref` components.

### Acceptance Criteria
- [ ] All 9 endpoints are defined in `openapi.yaml`.
- [ ] Every response model has all fields from v2 spec Section 11.
- [ ] Error responses (404, 206, 503) have correct shapes.
- [ ] SSE endpoint is documented with event payload schema.
- [ ] File validates with `openapi-spec-validator` in CI.
- [ ] Stale-while-revalidate fields (`data_state`, `last_cycle_at`, `estimated_completion_seconds`) are present.

### Definition of Done
- [ ] `api/openapi.yaml` committed and passing CI validation
- [ ] Reviewed by lead developer and frontend developer
- [ ] Used as the mock API source for frontend development (P3-08 onwards)

---

## P1-06 · Database DDL & Migration Scripts

**Epic:** Data Contracts | **Phase:** 1 | **Priority:** P0 | **Complexity:** M
**Depends on:** P1-01, P1-02, P1-03 | **Blocks:** P2-01, P2-05, P2-06

### User Story
As a data engineer, I need complete SQLite DDL scripts with all tables, indexes, and constraints so that Phase 2 can start immediately without any schema ambiguity.

### Technical Design
Create `db/migrations/001_initial_schema.sql` with all tables from v2 spec Section 12:

- `ticker_profiles` — with liquidity bucket, thresholds, ADV, last_updated
- `baseline_cache` — with (ticker, as_of_date, time_bucket, metric) composite PK, median, mad, session_count, earnings_excluded_count
- `unusual_activity_observations` — with all fields; `raw_print_refs_json` limited to top-20 prints with `truncated` boolean
- `unusual_activity_signal_results` — with `schema_version` column; JSONB stored as SQLite TEXT
- `scan_universes` and `universe_tickers` — with `removed_date` nullable for history retention
- `activity_alerts` — with `dedup_key` unique index
- `earnings_calendar` — (ticker, report_date, confirmed)
- `macro_context` — (series_id, value, as_of_date)
- `scheduled_job_log` — (job_name, started_at, completed_at, status, detail)

Include indexes for all frequently queried columns.

Use `Alembic` for migration management even with SQLite — establishes the pattern for future schema evolution.

### Acceptance Criteria
- [ ] All 10 tables present with correct column names and types.
- [ ] Composite primary keys correct (especially `baseline_cache`).
- [ ] `schema_version` column on `unusual_activity_signal_results`.
- [ ] `dedup_key` unique index on `activity_alerts`.
- [ ] All foreign key relationships defined (SQLite PRAGMA foreign_keys=ON).
- [ ] Alembic migration applies cleanly on empty SQLite database.
- [ ] Migration is idempotent (safe to run twice).

### Definition of Done
- [ ] `db/migrations/001_initial_schema.sql` committed
- [ ] Alembic env configured and `alembic upgrade head` succeeds
- [ ] `pytest tests/db/test_schema.py` — asserts all tables exist with correct columns

---

## P1-07 · Replay Clock Interface Specification

**Epic:** Data Contracts | **Phase:** 1 | **Priority:** P1 | **Complexity:** XS
**Depends on:** None | **Blocks:** P2-22

### User Story
As a developer building signal computation, I need a clock abstraction injected at initialization so that all freshness checks and baseline queries work correctly in both live and replay modes.

### Technical Design
Create `docs/replay-clock-spec.md` and `app/core/clock.py`:

```python
from abc import ABC, abstractmethod
from datetime import datetime, timezone

class AbstractClock(ABC):
    @abstractmethod
    def now(self) -> datetime:
        """Return current UTC datetime. Must be timezone-aware."""
        ...

class LiveClock(AbstractClock):
    def now(self) -> datetime:
        return datetime.now(timezone.utc)

class ReplayClock(AbstractClock):
    def __init__(self, as_of: datetime):
        assert as_of.tzinfo is not None, "ReplayClock requires timezone-aware datetime"
        self._as_of = as_of
    def now(self) -> datetime:
        return self._as_of
```

**Rules (documented):**
- No module may call `datetime.now()` or `datetime.utcnow()` directly. All time access via injected clock.
- A `ruff` linting rule (or `grep` CI check) asserts no bare `datetime.utcnow()` calls exist in `app/` directory.

### Acceptance Criteria
- [ ] `app/core/clock.py` committed with both classes.
- [ ] `docs/replay-clock-spec.md` explains the pattern and the no-direct-datetime rule.
- [ ] CI check (`grep -r "datetime.utcnow\|datetime.now()" app/`) fails if any match is found.
- [ ] Both classes pass a unit test asserting timezone-awareness.

### Definition of Done
- [ ] Code and docs committed
- [ ] CI grep check active
- [ ] Unit tests passing

---

## P1-08 · UX Terminology Policy & Component Inventory

**Epic:** UX Contracts | **Phase:** 1 | **Priority:** P1 | **Complexity:** S
**Depends on:** None | **Blocks:** P3-08 through P3-20

### User Story
As a frontend developer, I need a complete list of every term allowed/forbidden in the UI and a component inventory listing every UI component to be built, so I can start wireframing and writing copy without ambiguity.

### Technical Design
Create two documents:

**`docs/ux-terminology-policy.md`** — complete allowed/forbidden term list from v2 spec Section 18, plus:
- Tier labels: "Tier A — Actionable", "Tier B — Review", "Tier C — Context only", "Tier D — Suppressed"
- Indicator labels: "B: Xσ above own history", "A: Xth percentile of [Universe]"
- Lane state labels verbatim from the state contract
- Direction labels: "Buyer-side pressure", "Seller-side pressure", "Mixed", "Undetermined"
- Band labels: "Elevated", "Unusual", "Extreme" (not "normal" — normal is silent)

**`docs/component-inventory.md`** — every UI component:
| Component | Mode(s) | Inputs | Output |
|---|---|---|---|
| ModeSelector | All | none | selected mode |
| UniverseSelector | Scan | universe list + perf tier | selected universe |
| MarketRegimeBanner | All | FRED macro context | regime display |
| BLUFCard | All | signal result | headline card |
| IndicatorRow | All | A, B, C per metric | indicator chips |
| EvidenceCardSet | All | 8 evidence types | expandable cards |
| CorroborationPanel | All | corroboration flags | flag display |
| UserActionsPanel | All | ticker, tier, state | action buttons |
| ScanResultsTable | Scan | shortlist results | sortable table |
| PortfolioTable | Portfolio | all ticker results | ranked table |
| LaneStatePanel | All | lane states | health display |
| ProgressBar | Scan | Pass 2 completion | progress indicator |
| DeltaIndicator | All | current vs prior cycle | delta chip |

### Acceptance Criteria
- [ ] All forbidden terms from v2 spec Section 18 are listed.
- [ ] All 13 UI components are listed with inputs and outputs.
- [ ] Both documents committed to repo.

### Definition of Done
- [ ] `docs/ux-terminology-policy.md` committed
- [ ] `docs/component-inventory.md` committed
- [ ] Reviewed by lead developer and frontend developer

---

## P1-09 · Universe Constituent File Format Standard

**Epic:** Data Contracts | **Phase:** 1 | **Priority:** P1 | **Complexity:** XS
**Depends on:** None | **Blocks:** P2-02

### User Story
As a data engineer, I need a standard file format for universe constituent JSON files so the loader and weekly updater know exactly what to produce and validate.

### Technical Design
Create `config/universe_file.schema.json` and example file `data/universes/sp500.json`:

```json
{
  "universe_id": "sp500",
  "label": "S&P 500",
  "category": "index",
  "parent_universe_id": null,
  "last_updated": "2026-06-06",
  "source": "financial_modeling_prep",
  "source_url": "https://financialmodelingprep.com/api/v3/sp500_constituent",
  "ticker_count": 503,
  "performance_tier": "standard",
  "tickers": [
    {
      "symbol": "AVGO",
      "name": "Broadcom Inc.",
      "exchange": "NASDAQ",
      "gics_sector": "Information Technology",
      "gics_industry": "Semiconductors & Semiconductor Equipment",
      "added_date": "2023-03-20",
      "removed_date": null
    }
  ]
}
```

### Acceptance Criteria
- [ ] Schema covers all required fields with types and constraints.
- [ ] Example files for at least 3 universes (DJIA, NASDAQ-100, S&P 500) committed.
- [ ] Schema validates with `jsonschema` in CI.

### Definition of Done
- [ ] Schema and example files committed
- [ ] CI validation passing

---
---

# PHASE 2 — DATA & FEATURE ENGINE

*Backend Python services. All tickets produce tested, deployed code running on Pi 5. No UI work.*

---

## P2-01 · Project Scaffold

**Epic:** Infrastructure | **Phase:** 2 | **Priority:** P0 | **Complexity:** M
**Depends on:** P1-06, P1-07 | **Blocks:** All Phase 2 tickets

### User Story
As a developer, I need a working FastAPI + SQLite + APScheduler project skeleton on the Pi 5 with systemd service, logging, and CI, so every subsequent ticket has a clean base to build on.

### Technical Design
Directory structure:
```
app/
  core/
    clock.py          # P1-07
    db.py             # SQLite connection pool (WAL mode)
    config.py         # pydantic-settings from .env
    logging.py        # structlog JSON logger
  lanes/              # one module per lane
  signals/            # one module per signal component
  indicators/         # A, B, C computers
  api/
    routes/           # one router per endpoint group
    models/           # Pydantic response models (from OpenAPI spec)
  scheduler/          # APScheduler job definitions
  replay/             # ReplayClock + replay harness
config/               # JSON policy and registry files
data/universes/       # Universe constituent files
db/migrations/        # Alembic migrations
tests/                # pytest, mirroring app/ structure
deploy/
  uta-agent.service   # systemd unit file
  cloudflared.service # cloudflared service reference
```

Key setup:
- `pyproject.toml` with all dependencies pinned.
- `.env.example` with all required env vars documented.
- SQLite in WAL mode: `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;`
- APScheduler with `AsyncIOScheduler` (compatible with FastAPI async).
- `structlog` for JSON-formatted logs → `journald`.
- `pytest` with `pytest-asyncio` for async tests.
- GitHub Actions (or local `act`) CI: lint (ruff), type check (mypy), test (pytest), schema validation.

### Acceptance Criteria
- [ ] `uvicorn app.main:app` starts without error on Pi 5 (ARM64).
- [ ] `GET /api/health` returns `{"status": "ok", "db": "connected"}`.
- [ ] SQLite database created with all tables on first run (`alembic upgrade head`).
- [ ] APScheduler starts with no jobs scheduled (jobs added in later tickets).
- [ ] systemd unit file installs and starts the service (`sudo systemctl start uta-agent`).
- [ ] `pytest tests/` passes with zero failures.
- [ ] `ruff check app/` passes with zero violations.
- [ ] CI grep check (`datetime.utcnow`) finds zero matches.

### Definition of Done
- [ ] Repo initialized with structure above
- [ ] Pi 5 can run the service via systemd
- [ ] All CI checks passing
- [ ] `.env.example` fully documented
- [ ] `README.md` covers: install steps, env vars, systemd setup, running tests

### Testing Requirements
- `test_health.py` — asserts `/api/health` returns 200 with expected shape.
- `test_db.py` — asserts all tables exist after migration.
- `test_clock.py` — asserts `LiveClock.now()` is timezone-aware; `ReplayClock` returns fixed time.

---

## P2-02 · Universe Constituent Loader & Weekly Updater

**Epic:** Data Pipeline | **Phase:** 2 | **Priority:** P1 | **Complexity:** M
**Depends on:** P2-01, P1-09 | **Blocks:** P2-05, P2-16, P3-10

### User Story
As a user running a scan, I need the agent to know which tickers belong to which universe so it can scope its analysis correctly and surface my chosen universe's constituent list.

### Technical Design
- `app/lanes/universe_loader.py`
  - `load_universe_from_file(universe_id: str) -> UniverseManifest` — reads from `data/universes/{universe_id}.json`, validates against schema.
  - `get_universe_tickers(universe_id: str, as_of_date: date) -> list[str]` — returns active tickers (where `removed_date IS NULL OR removed_date > as_of_date`).
  - `upsert_universe_to_db(manifest: UniverseManifest)` — writes to `scan_universes` and `universe_tickers` tables.

- `app/scheduler/jobs/update_universes.py` — APScheduler job, runs every Sunday 02:00 ET:
  - For each configured universe: fetches fresh constituent list from data provider (FMP or Polygon free tier).
  - Diffs against stored list; marks removed tickers with `removed_date`.
  - Writes updated JSON file and updates DB.
  - Logs job completion to `scheduled_job_log`.

- `GET /api/universes` endpoint returns all universes with `performance_tier`, `ticker_count`, `last_updated`, `label`.

### Acceptance Criteria
- [ ] All 20+ predefined universes load without error.
- [ ] Removed tickers get `removed_date` set (not deleted).
- [ ] `get_universe_tickers(as_of_date=past_date)` returns historically correct list (excludes tickers removed before that date).
- [ ] `GET /api/universes` returns list with `performance_tier` (🟢/🟡/🔴 encoded as `fast`/`standard`/`extended`).
- [ ] Weekly job logs to `scheduled_job_log` with start and end times.
- [ ] If data provider is unavailable, job uses cached file and logs a warning (does not fail).

### Definition of Done
- [ ] Code committed and tested
- [ ] APScheduler job registered and tested via manual trigger
- [ ] `pytest tests/lanes/test_universe_loader.py` passes

### Testing Requirements
- **Unit:** `test_universe_loader.py` — load each example universe file, assert ticker count, assert schema validation.
- **Unit:** `test_historical_membership.py` — ticker removed on date D is absent from `get_universe_tickers(as_of_date=D+1)` but present for `as_of_date=D-1`.
- **Integration:** Mock FMP API, assert weekly update diffs correctly and sets `removed_date`.

### QA Checklist
- [ ] Scan with `universe=sp500` uses exactly the S&P 500 constituent list, not all NASDAQ/NYSE tickers.
- [ ] `last_updated` field in API response reflects the actual file date.
- [ ] Universe with `last_updated` > 14 days ago triggers a warning in `GET /api/universes`.

---

## P2-03 · Earnings Calendar Fetcher

**Epic:** Data Pipeline | **Phase:** 2 | **Priority:** P1 | **Complexity:** S
**Depends on:** P2-01 | **Blocks:** P2-06

### User Story
As a baseline builder, I need to know which sessions are earnings sessions for each ticker so I can exclude them from baseline calculations and label them in evidence cards.

### Technical Design
- `app/lanes/earnings_calendar.py`
  - Fetches from FMP free tier: `GET /api/v3/earning_calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&apikey={key}`
  - Stores in `earnings_calendar(ticker, report_date, confirmed, source, fetched_at)`.
  - APScheduler job: daily 06:00 ET, fetches next 90 days + backfills last 30 days.

- `is_earnings_session(ticker: str, session_date: date) -> bool` — used by baseline builder.

### Acceptance Criteria
- [ ] Earnings dates stored for all tickers in all configured universes.
- [ ] `is_earnings_session` returns `True` for a known earnings date, `False` otherwise.
- [ ] Daily job logs to `scheduled_job_log`.
- [ ] If FMP unavailable, job retries once after 60s and then skips, logging a warning.

### Definition of Done
- [ ] Code committed, APScheduler job registered, tests passing.

### Testing Requirements
- **Unit:** Mock FMP response, assert upsert writes correct rows.
- **Unit:** `test_is_earnings_session` — known earnings date returns True; prior day returns False.

---

## P2-04 · FRED Macro Context Fetcher

**Epic:** Data Pipeline | **Phase:** 2 | **Priority:** P2 | **Complexity:** S
**Depends on:** P2-01 | **Blocks:** P3-11

### User Story
As a user viewing signals, I need a market regime banner (VIX, yield curve, Fed Funds Rate) so I know whether to interpret bullish signals cautiously or confidently.

### Technical Design
- `app/lanes/fred_macro.py`
  - Fetches 3 FRED series via `https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}`:
    - `VIXCLS` (VIX Close)
    - `T10Y2Y` (10Y-2Y Yield Spread)
    - `FEDFUNDS` (Fed Funds Rate)
  - Stores latest value per series in `macro_context(series_id, value, as_of_date, fetched_at)`.
  - APScheduler job: daily 07:00 ET.
  - `get_current_macro_context() -> MacroContext` — returns latest values with regime classification:
    - `risk_on`: VIX < 18
    - `neutral`: VIX 18–25
    - `risk_off`: VIX 25–35
    - `crisis`: VIX > 35

- `GET /api/macro` returns current macro context with regime label and interpretation note.

### Acceptance Criteria
- [ ] All 3 series fetched and stored correctly.
- [ ] Regime classification matches v2 spec thresholds.
- [ ] `GET /api/macro` returns correct shape.
- [ ] Crisis regime (VIX > 35) emits a `crisis_mode: true` flag in the response.

### Definition of Done
- [ ] Code committed, job registered, tests passing.

### Testing Requirements
- **Unit:** Mock FRED CSV, assert correct parsing and regime classification for each threshold boundary.
- **Unit:** Assert VIX 35.01 → `crisis`, VIX 34.99 → `risk_off`.

---

## P2-05 · Ticker Profile Builder

**Epic:** Data Pipeline | **Phase:** 2 | **Priority:** P0 | **Complexity:** M
**Depends on:** P2-01, P2-02, P1-06 | **Blocks:** P2-09, P2-10

### User Story
As the block detector and anomaly computer, I need each ticker's liquidity bucket, ADV, and per-bucket thresholds precomputed so I can apply the correct thresholds at signal time without recomputing them from scratch.

### Technical Design
- `app/signals/ticker_profiles.py`
  - `build_ticker_profile(ticker: str, as_of_date: date, clock: AbstractClock) -> TickerProfile`
  - Reads 20-day ADV from `massive_daily_bars` lane (or from Massive API).
  - Assigns `liquidity_bucket` per the ADV thresholds in v2 spec Section 6.2.
  - Computes `notional_floor`, `share_floor`, `relative_multiple` per bucket.
  - Stores in `ticker_profiles` table.

- APScheduler job: nightly 23:30 ET — rebuilds profiles for all tickers in any active universe.
- `get_ticker_profile(ticker: str) -> TickerProfile` — fast DB read; used by all signal computers.

**Liquidity bucket assignment:**
```python
def assign_bucket(adv: float) -> str:
    if adv < 10_000_000: return "micro"
    elif adv < 100_000_000: return "small"
    elif adv < 1_000_000_000: return "mid"
    elif adv < 10_000_000_000: return "large"
    else: return "mega"
```

### Acceptance Criteria
- [ ] All 5 liquidity buckets correctly assigned with exact ADV thresholds.
- [ ] Profiles stored for all tickers in configured universes after nightly job.
- [ ] `get_ticker_profile` returns cached result in < 5ms (DB read, no computation).
- [ ] Ticker with no ADV data is assigned `micro` bucket with a `data_quality: estimated` flag.

### Definition of Done
- [ ] Code committed, job registered, tests passing.

### Testing Requirements
- **Unit:** Test each bucket boundary: ADV = $9.99M → micro; $10M → small; etc.
- **Unit:** `test_thresholds.py` — AVGO (mega) gets $5M notional floor, 3× multiple.

---

## P2-06 · Baseline Cache Builder

**Epic:** Data Pipeline | **Phase:** 2 | **Priority:** P0 | **Complexity:** L
**Depends on:** P2-01, P2-03, P1-02 | **Blocks:** P2-15, P2-10, P2-12, P2-13

### User Story
As the B indicator computer, I need precomputed median and MAD values per (ticker, time_bucket, metric) so that B-scores are computed in milliseconds at signal time without reprocessing raw data.

### Technical Design
- `app/signals/baseline_builder.py`
  - For each ticker with sufficient history:
    1. Load daily bars and tick slices from the 20 sessions before `as_of_date`.
    2. Filter out earnings sessions using `is_earnings_session`.
    3. For each time bucket, compute per-session values for each metric.
    4. Compute median and MAD using `numpy.median` and `statsmodels.robust.mad`.
    5. Upsert to `baseline_cache`.
  - `get_baseline(ticker, as_of_date, time_bucket, metric) -> BaselineStats` — fast DB read.

- APScheduler job: nightly 23:00 ET — full rebuild for all tracked tickers.
- Handles `insufficient_history` when usable sessions < 10.
- `replay_mode`: receives `as_of_date` parameter; never reads from dates ≥ `as_of_date`.

### Acceptance Criteria
- [ ] Baseline computed for all 6 time buckets + 1 pre-market bucket.
- [ ] Earnings sessions excluded from window.
- [ ] `get_baseline` raises `InsufficientHistoryError` if < 10 sessions available.
- [ ] Rebuild completes for 500 tickers in < 10 minutes on Pi 5 (benchmark required).
- [ ] Replay mode: passing `as_of_date=2026-01-15` uses data strictly before `2026-01-15`.

### Definition of Done
- [ ] Code committed, job registered, all tests passing.
- [ ] Pi 5 benchmark result documented in `docs/performance-benchmarks.md`.

### Testing Requirements
- **Unit:** `test_baseline_builder.py` — 10 synthetic sessions, assert median and MAD correct.
- **Unit:** Earnings session excluded — assert the session with earnings is not in the window.
- **Unit:** Replay mode — assert `as_of_date` boundary is strictly `<`.
- **Integration:** Full run for AVGO using real/fixture data; assert output in DB.

### QA Checklist
- [ ] Ticker with exactly 10 sessions passes; ticker with 9 sessions returns `insufficient_history`.
- [ ] Earnings session on day 5 of 20 is excluded; count shows 19 usable sessions.

---

## P2-07 · Raw Print Normalizer & Condition Code Filter

**Epic:** Signal Engine | **Phase:** 2 | **Priority:** P0 | **Complexity:** M
**Depends on:** P2-01, P1-01, P2-05 | **Blocks:** P2-08, P2-09, P2-10

### User Story
As a signal computer, I need a clean, normalized list of prints for each ticker with condition codes applied, venues classified, and sessions labeled, so I am never computing signals on non-directional or excluded data.

### Technical Design
- `app/signals/print_normalizer.py`
  - `normalize_prints(raw_prints: list[RawPrint], policy: ConditionCodePolicy, clock: AbstractClock) -> NormalizedPrintSet`
  - Applies condition code policy v1: hard exclude, session bucket, flag.
  - Computes `notional = price × size`.
  - Classifies session: `pre_market` (04:00–09:30), `regular` (09:30–16:00), `after_hours`, `extended_hours`.
  - Classifies venue: `trf_off_exchange`, `trf_retail_internalized`, `trf_ats`, `trf_unclassified`, `lit_exchange`.
  - Assigns time bucket per exchange timestamp (or participant timestamp with fallback flag).
  - Returns `NormalizedPrintSet` with: eligible prints, excluded count, flag counts, metadata.

- `ConditionCodePolicy` loaded from `condition_code_policy_v1.json` at startup — read once, cached.

### Acceptance Criteria
- [ ] Hard-excluded prints never appear in `NormalizedPrintSet.eligible_prints`.
- [ ] `excluded_count` matches the number of hard-excluded prints in input.
- [ ] Each eligible print has: `session`, `venue`, `time_bucket`, `notional`, `flags`.
- [ ] Prints with no condition code are classified as `eligible`.
- [ ] Policy version is recorded in output metadata.
- [ ] All 5 venue types correctly classified.

### Definition of Done
- [ ] Code committed, all unit tests passing.

### Testing Requirements
- **Unit:** `test_normalizer.py` — synthetic print set with one of each condition code; assert each is in the correct output category.
- **Unit:** `test_venue_classification.py` — prints with/without `trf_id`, with/without origination code.
- **Unit:** `test_time_bucket_assignment.py` — print at 09:35 ET → `open`; print at 12:00 ET → `midday`.
- **Property test:** Any print in `eligible_prints` must have all required fields non-null.

### QA Checklist
- [ ] Average-price prints (W) never appear in notional calculations.
- [ ] ISO sweep prints (F) appear in volume count but not in `focus_block_classification`.
- [ ] Opening prints (O) appear in volume but not in block detection.

---

## P2-08 · Trade Signing Engine

**Epic:** Signal Engine | **Phase:** 2 | **Priority:** P0 | **Complexity:** M
**Depends on:** P2-07 | **Blocks:** P2-12, P2-11

### User Story
As the pressure computer, I need each eligible print signed as buyer-initiated or seller-initiated (or unknown) with a confidence level, so that directional signals are based on the best available evidence.

### Technical Design
- `app/signals/trade_signing.py`
  - `sign_prints(prints: list[NormalizedPrint], clock: AbstractClock) -> list[SignedPrint]`
  - For each print:
    1. **Quote rule:** If bid/ask available and print is not at midpoint → sign by comparing price to mid: above mid = buy, below mid = sell.
    2. **Midpoint:** If price = (bid + ask) / 2 within tick tolerance → `signed=unknown, method=midpoint_excluded`.
    3. **Tick test (Lee-Ready full):** If no bid/ask → compare to prior trade price. Up-tick = buy, down-tick = sell. Zero-tick: apply reverse tick test.
    4. **Unknown:** If neither method yields a result → `signed=unknown, method=unknown`.
  - Returns `signing_method_mix`: `{quote_rule_pct, tick_test_pct, midpoint_excluded_pct, unknown_pct}`.

### Acceptance Criteria
- [ ] Quote rule takes priority over tick test for every print with bid/ask.
- [ ] Midpoint prints classified as `unknown, method=midpoint_excluded` — never as buy or sell.
- [ ] Full Lee-Ready: zero-tick uses prior non-zero tick direction.
- [ ] `signing_method_mix` percentages sum to 1.0.
- [ ] When `signing_confidence < 0.50`, a `low_confidence` flag is set on the result.

### Definition of Done
- [ ] Code committed, all tests passing.

### Testing Requirements
- **Unit:** `test_quote_rule.py` — price above midpoint → buy; below → sell; at midpoint → unknown.
- **Unit:** `test_tick_test.py` — up-tick → buy; down-tick → sell; zero-tick → uses prior direction.
- **Unit:** `test_signing_confidence.py` — 100% unknown → confidence = 0.0; 100% quote rule → 1.0.
- **Unit:** `test_midpoint_excluded.py` — midpoint prints appear in `midpoint_excluded_pct` only.

### QA Checklist
- [ ] 100% unknown signing → directional signal emits `undetermined`, not `bullish` or `bearish`.
- [ ] Signing method mix percentages always sum to 1.0.

---

## P2-09 · Block / TRF Detector

**Epic:** Signal Engine | **Phase:** 2 | **Priority:** P0 | **Complexity:** M
**Depends on:** P2-07, P2-05 | **Blocks:** P2-11

### User Story
As the block trade signal computer, I need a list of focus prints for each ticker (large prints + TRF prints + provider-confirmed blocks) with their notional, venue, and size, so I can compute block concentration and directional pressure.

### Technical Design
- `app/signals/block_detector.py`
  - `detect_focus_prints(prints: NormalizedPrintSet, profile: TickerProfile, confirmed_alerts: list[Alert]) -> FocusPrintSet`
  - Applies per-bucket thresholds from `ticker_profiles`.
  - Classifies each print as: `large_print`, `trf_focus`, `provider_confirmed_block`, or `standard`.
  - `focus_print = large_print OR trf_focus OR provider_confirmed_block`.
  - Returns: focus prints list, total_notional, focus_notional, focus_count, largest_print_notional, largest_print_multiple.

### Acceptance Criteria
- [ ] AVGO (mega bucket) requires notional >= $5M to qualify as absolute block.
- [ ] Relative threshold applied against 20-day baseline median trade notional (from `baseline_cache`).
- [ ] Both absolute AND relative thresholds must be met for `large_print`.
- [ ] TRF prints qualify as focus regardless of size (if in `trf_off_exchange`, `trf_ats`, or `trf_unclassified`).
- [ ] Provider-confirmed blocks qualify regardless of size.
- [ ] Opening and closing prints (flagged in P2-07) do not qualify as `large_print`.

### Definition of Done
- [ ] Code committed, all tests passing.

### Testing Requirements
- **Unit:** For each of the 5 buckets: test a print at exactly the notional floor (qualifies) and just below (does not).
- **Unit:** `test_trf_detection.py` — `exchange=4 AND trf_id present` → `trf_focus = True`.
- **Unit:** Opening print with large notional → `large_print = False`.

### QA Checklist
- [ ] Large lit-exchange print is labeled "Large print" not "TRF/off-exchange".
- [ ] TRF print below notional floor is still classified as `trf_focus`.

---

## P2-10 · Volume / Notional / Count Anomaly Computer

**Epic:** Signal Engine | **Phase:** 2 | **Priority:** P0 | **Complexity:** M
**Depends on:** P2-07, P2-06 | **Blocks:** P2-15, P2-17

### User Story
As the tier classifier, I need volume, notional, and trade count ratios vs. baseline for each ticker and time bucket, along with anomaly band labels, so I can classify tickers as Elevated / Unusual / Extreme.

### Technical Design
- `app/signals/anomaly_computer.py`
  - `compute_anomaly(prints: NormalizedPrintSet, baseline: BaselineStats, time_bucket: str) -> AnomalyResult`
  - Computes: `volume_ratio`, `notional_ratio`, `trade_count_ratio`.
  - Labels anomaly band per v2 spec: Attention / Strong / Extreme / Normal.
  - Normal band is silent (not shown in UX).
  - Anomaly B-score is computed by P2-15 (B indicator). This ticket outputs raw ratios only.

### Acceptance Criteria
- [ ] `volume_ratio = session_volume / median_baseline_volume[time_bucket]`.
- [ ] Band `Extreme` requires BOTH `notional_ratio >= 3.0×` AND B >= 3.0σ (B computed later — band label confirmed in P2-15).
- [ ] `Normal` band produces no output in the signal result.
- [ ] Returns `None` if baseline has `insufficient_history`.

### Definition of Done
- [ ] Code committed, all tests passing.

### Testing Requirements
- **Unit:** session_volume = 2× median → `volume_ratio = 2.0`.
- **Unit:** Insufficient history baseline → returns `None`, does not raise.

---

## P2-11 · Block Trade Signal Computer

**Epic:** Signal Engine | **Phase:** 2 | **Priority:** P0 | **Complexity:** M
**Depends on:** P2-09, P2-08 | **Blocks:** P2-15, P2-17

### User Story
As the B/C indicator computers, I need the four block trade metrics (focus_notional_share, focus_trade_count, largest_print_multiple, block_directional_pressure) for each ticker so indicators can assess how unusual this block activity is vs. history and vs. peers.

### Technical Design
- `app/signals/block_signal.py`
  - `compute_block_signal(focus_prints: FocusPrintSet, signed_prints: list[SignedPrint]) -> BlockSignalResult`
  - `focus_notional_share = focus_notional / total_notional` — naturally [0,1].
  - `focus_trade_count = len(focus_prints)`.
  - `largest_print_multiple = largest_focus_notional / median_trade_notional[20-day]`.
  - `block_directional_pressure = signed_focus_notional / focus_notional` — preserves sign.
  - Returns all four metrics; direction sign preserved separately from magnitude.

### Acceptance Criteria
- [ ] `focus_notional_share` is always in [0, 1].
- [ ] `block_directional_pressure` sign correctly reflects buyer/seller side.
- [ ] Zero focus prints → all metrics are 0 or None; no division-by-zero errors.
- [ ] `largest_print_multiple` uses 20-day median from baseline cache, not session median.

### Definition of Done
- [ ] Code committed, all tests passing.

### Testing Requirements
- **Unit:** Zero focus prints → `focus_notional_share = 0`, `block_directional_pressure = None`.
- **Unit:** All focus prints buyer-signed → `block_directional_pressure = 1.0`.

---

## P2-12 · Buy/Sell Pressure Computer

**Epic:** Signal Engine | **Phase:** 2 | **Priority:** P0 | **Complexity:** M
**Depends on:** P2-08 | **Blocks:** P2-15, P2-17

### User Story
As the tier classifier, I need three independent directional pressure readings (notional, volume, pre-market) with signing confidence, so I can assess whether flow direction is reliable.

### Technical Design
- `app/signals/pressure_computer.py`
  - `compute_pressure(signed_prints: list[SignedPrint], session: str, clock: AbstractClock) -> PressureResult`
  - Three readings:
    - `net_notional_pressure = signed_notional / total_notional` ∈ [-1,+1]
    - `net_volume_pressure = signed_volume / total_volume` ∈ [-1,+1]
    - `pre_market_pressure = signed_premarket_notional / total_premarket_notional` ∈ [-1,+1] (None if no pre-market prints)
  - Pre-market decay: `pre_market_pressure_effective = pre_market_pressure × exp(−λ × minutes_since_open)` where λ = ln(2)/60. Applied when `clock.now()` is after 09:30 ET.
  - `signing_confidence = quote_rule_pct × 1.0 + tick_test_pct × 0.6`.
  - `low_confidence_flag = signing_confidence < 0.50`.

### Acceptance Criteria
- [ ] All three pressures in [-1, +1].
- [ ] Pre-market pressure at exactly 60 minutes after open = 0.5 × original (half-life verified).
- [ ] Pre-market pressure at 120 minutes after open ≈ 0.25 × original.
- [ ] `low_confidence_flag` set correctly.
- [ ] Zero eligible prints → all pressures return `None`.

### Definition of Done
- [ ] Code committed, all tests passing.

### Testing Requirements
- **Unit:** `test_decay.py` — inject `ReplayClock` at 10:30 ET (60 min after open), assert decay factor = 0.5.
- **Unit:** All prints unknown signed → `signing_confidence = 0.0`, `low_confidence_flag = True`.
- **Unit:** 50% quote rule, 50% tick test → `signing_confidence = 0.80`.

### QA Checklist
- [ ] Pre-market pressure at 13:00 ET is negligible (< 5% of original).
- [ ] Signing confidence < 0.50 triggers "Low confidence — indicative only" label in UX.

---

## P2-13 · Pre-Market Signal Computer

**Epic:** Signal Engine | **Phase:** 2 | **Priority:** P1 | **Complexity:** S
**Depends on:** P2-12, P2-06 | **Blocks:** P2-15

### User Story
As the tier classifier, I need pre-market specific anomaly metrics (volume ratio, notional ratio, gap direction) so I can assess whether pre-market activity is structurally unusual for this ticker.

### Technical Design
- `app/signals/premarket_signal.py`
  - Reads `massive_premarket_trade_slices` lane.
  - Computes pre-market volume ratio vs. pre-market-specific baseline (not regular-session baseline).
  - `gap_direction = (pre_market_last_price − prior_close) / prior_close`.
  - Returns: `premarket_volume_ratio`, `premarket_notional_ratio`, `pre_market_pressure` (from P2-12), `gap_direction`, `gap_pct`.

### Acceptance Criteria
- [ ] Pre-market baseline is the pre-market window from prior sessions (not full day).
- [ ] `gap_direction` is positive for gap-up, negative for gap-down.
- [ ] No pre-market prints → all metrics return `None`, not 0.

### Definition of Done
- [ ] Code committed, all tests passing.

---

## P2-14 · Market Flow Trend Computer

**Epic:** Signal Engine | **Phase:** 2 | **Priority:** P2 | **Complexity:** S
**Depends on:** P2-12 | **Blocks:** P2-17

### User Story
As the tier classifier, I need a short-term trend in signed notional pressure (last 5 cycles vs. current) so I can detect whether pressure is building or fading.

### Technical Design
- `app/signals/flow_trend.py`
  - `compute_flow_trend(current_pressure: float, prior_cycle_pressures: list[float]) -> FlowTrendResult`
  - `pressure_delta = current_net_notional_pressure − median(last_5_cycles_pressure)`.
  - `participation = current_notional / median(last_5_cycles_notional)`.
  - Direction: bullish if delta > 0 with participation > 0.8×; bearish if delta < 0 with participation > 0.8×; neutral if low participation.
  - Prior cycle pressures read from `unusual_activity_signal_results` table.

### Acceptance Criteria
- [ ] Requires at least 3 prior cycles to emit a result (else `None`).
- [ ] Direction neutral when participation < 0.8×.
- [ ] `pressure_delta` sign preserved for direction.

---

## P2-15 · B Indicator Computer (Historical Z-score)

**Epic:** Indicator Engine | **Phase:** 2 | **Priority:** P0 | **Complexity:** M
**Depends on:** P2-06, P2-10, P2-11, P2-12, P2-13, P1-03 | **Blocks:** P2-19, P3-13

### User Story
As the tier classifier and UX renderer, I need B-scores (historical z-scores) for each signal metric so I know how statistically unusual this ticker's current activity is compared to its own history.

### Technical Design
- `app/indicators/b_indicator.py`
  - `compute_b_scores(metrics: SignalMetrics, baseline: BaselineStats) -> BScores`
  - For each metric: `B = (current_value − median_baseline) / (MAD_baseline × 1.4826)`.
  - Returns a dict of `{metric_name: b_score}` for all metrics defined in P1-03.
  - If baseline `MAD = 0` (perfectly consistent history), use a small floor (e.g., `max(MAD, 0.001 × median)`) to avoid division by zero.
  - B-scores are unbounded — no capping, no normalization.

### Acceptance Criteria
- [ ] Uses 1.4826 MAD scaling constant exactly.
- [ ] Zero-MAD baseline does not raise ZeroDivisionError.
- [ ] Returns `None` for any metric whose baseline has `insufficient_history`.
- [ ] B-score for a value exactly at median = 0.0.
- [ ] B-score for a value at median + 1 MAD ≈ 1.4826.

### Definition of Done
- [ ] Code committed, all tests passing.

### Testing Requirements
- **Unit:** Compute B-score for known median/MAD; assert mathematically correct.
- **Unit:** MAD = 0 → returns small positive B-score, no exception.
- **Unit:** All 8 metrics from P1-03 are present in output dict.

---

## P2-16 · A Indicator Computer (Universe Percentile)

**Epic:** Indicator Engine | **Phase:** 2 | **Priority:** P1 | **Complexity:** S
**Depends on:** P2-10, P2-11, P2-12, P1-03 | **Blocks:** P2-19, P3-13

### User Story
As the tier classifier in Portfolio and Scan modes, I need A-scores (universe percentile) so I know how each ticker's metrics compare to all other tickers in the current session's scope.

### Technical Design
- `app/indicators/a_indicator.py`
  - `compute_a_scores(ticker_metrics: dict[str, SignalMetrics], mode: str) -> dict[str, AScores]`
  - For each metric: rank each ticker by its raw value within the universe.
  - `A = count(peers where metric < ticker.metric) / count(peers)`.
  - Returns `None` for all metrics when `mode = "single_ticker"`.
  - Cross-sectional: requires all tickers' metrics to be computed first (batch operation).
  - Efficient implementation: `scipy.stats.percentileofscore` or simple numpy rank.

### Acceptance Criteria
- [ ] Returns `None` for all metrics in single-ticker mode.
- [ ] A-score for the highest metric in the universe = 1.0 (or `(N-1)/N` depending on formula choice — document which is used).
- [ ] A-score for the lowest metric = 0.0.
- [ ] Universe of 1 ticker → A = `None` (no peer group).

### Definition of Done
- [ ] Code committed, all tests passing.

---

## P2-17 · C Ordering Score Computer

**Epic:** Indicator Engine | **Phase:** 2 | **Priority:** P1 | **Complexity:** S
**Depends on:** P2-10, P2-11, P2-12, P1-03 | **Blocks:** P2-19

### User Story
As the scan and portfolio result sorter, I need a C ordering score (internal, never shown) to rank tickers by most interesting first, so the user sees the highest-signal tickers at the top.

### Technical Design
- `app/indicators/c_score.py`

**Pass 1 (bars only):**
```python
def compute_c_screen(volume_ratio: float, daily_return: float) -> float:
    return volume_ratio * (1 + abs(daily_return))
```

**Pass 2 (full):**
```python
def compute_c_order(
    volume_ratio: float,
    net_notional_pressure: float,
    focus_notional_share: float,
    confirmed_alert_present: bool
) -> float:
    return (
        volume_ratio
        * (1 + abs(net_notional_pressure))
        * (1 + focus_notional_share)
        * (1 + 0.5 * int(confirmed_alert_present))
    )
```

### Acceptance Criteria
- [ ] 10× volume ticker always has higher `C_order` than 5× ticker with identical other inputs.
- [ ] Confirmed alert adds exactly 50% bonus to the formula.
- [ ] Zero pressure does not zero out the score (formula uses `1 + abs(pressure)`).
- [ ] C score is never stored in `unusual_activity_signal_results` — used only for sorting.

### Definition of Done
- [ ] Code committed, all tests passing.

---

## P2-18 · Corroboration Flag Evaluator

**Epic:** Signal Engine | **Phase:** 2 | **Priority:** P1 | **Complexity:** M
**Depends on:** P2-12, P2-09, P2-03, P2-04 | **Blocks:** P2-19

### User Story
As the tier classifier, I need all 6 corroboration flags evaluated for each ticker so I can determine whether a Tier B result qualifies for elevation to Tier A.

### Technical Design
- `app/signals/corroboration.py`
  - `evaluate_corroboration(signal: TickerSignalData, macro: MacroContext, alerts: list[Alert], clock: AbstractClock) -> CorroborationResult`
  - Evaluates all 6 flags per v2 spec Section 8.1:
    - `price_action_aligned`: price moved in direction of `net_notional_pressure` during analysis window.
    - `options_flow_aligned`: set by companion agent or provider alert type = `options`. Defaults `False` if not available.
    - `news_catalyst_present`: earnings or news event today from earnings calendar.
    - `provider_alert_confirmed`: `activity_alerts` table has a confirmed alert for this ticker/session.
    - `pre_and_regular_both_elevated`: both `pre_market B >= 1.5σ` AND `regular session B >= 1.5σ`.
    - `macro_regime_supports`: VIX < 25 for bullish signals; VIX < 25 for bearish signals in falling markets.
  - `corroboration_count` = count of Strong flags that are `True`.

### Acceptance Criteria
- [ ] All 6 flags present in output, each a boolean.
- [ ] `corroboration_count` excludes contextual flags (`news_catalyst_present`, `macro_regime_supports`).
- [ ] `options_flow_aligned` defaults to `False` when companion agent not connected.
- [ ] Alert direction conflict (alert says bullish, raw signal says bearish) → `provider_alert_confirmed = False`.

### Definition of Done
- [ ] Code committed, all tests passing.

### QA Checklist
- [ ] Alert with direction conflict does not set `provider_alert_confirmed = True`.
- [ ] News event alone does not elevate corroboration_count.

---

## P2-19 · Tier Classifier

**Epic:** Signal Engine | **Phase:** 2 | **Priority:** P0 | **Complexity:** M
**Depends on:** P2-15, P2-16, P2-17, P2-18 | **Blocks:** P3-02, P3-03, P3-05

### User Story
As the API layer, I need a final tier (A/B/C/D) and direction for each ticker so I can return structured results to the frontend.

### Technical Design
- `app/signals/tier_classifier.py`
  - `classify_tier(b_scores: BScores, a_scores: AScores | None, corroboration: CorroborationResult, lane_state: LaneState, mode: str) -> TierResult`
  - Implements both rule sets from v2 spec Section 7 (single-ticker and portfolio/scan).
  - Elevation rule: Tier B + confirmed alert + matching direction → Tier A.
  - Suppression rules: any suppression condition → Tier D.
  - Direction from v2 spec Section 10.3.

### Acceptance Criteria
- [ ] Single-ticker mode never uses A-scores in tier rules.
- [ ] Tier D when any suppression condition is true (checked before any other rule).
- [ ] Tier A requires `corroboration_count >= 1` (Strong flags only).
- [ ] Elevation: Tier B + confirmed alert + matching direction → Tier A (not higher).
- [ ] Direction `undetermined` when `abs(net_notional_pressure) < 0.60` AND `abs(block_directional_pressure) < 0.60`.
- [ ] Signing confidence < 0.50 forces direction to `low_confidence_indicative`.

### Definition of Done
- [ ] Code committed, all tests passing.

### Testing Requirements
- **Unit:** All 4 tier rules tested with boundary B-score values.
- **Unit:** Suppression conditions each individually force Tier D.
- **Unit:** Elevation: Tier B + alert → A; Tier C + alert → B (not A).
- **Unit:** Direction conflict between notional and block pressure → `mixed`.

### QA Checklist
- [ ] `signing_confidence < 0.50` → direction label "Low confidence — indicative only".
- [ ] `corroboration_count = 0` → cannot be Tier A.

---

## P2-20 · Confirmed Alert Importer & Deduplicator

**Epic:** Data Pipeline | **Phase:** 2 | **Priority:** P2 | **Complexity:** S
**Depends on:** P2-01 | **Blocks:** P2-18

### User Story
As a user with TradeVision or Unusual Whales alerts, I need the agent to import my provider alerts, deduplicate them, and make them available as corroboration evidence.

### Technical Design
- `app/lanes/alert_importer.py`
  - Supports CSV import (manual) and optional API polling (configurable per provider).
  - Validates required fields: `ticker`, `provider`, `alert_type`, `direction`, `session_date`, `alert_timestamp`.
  - `dedup_key = hash(ticker + session_date + direction + alert_type + provider)`.
  - Upserts to `activity_alerts` with `consumed = false` on insert.
  - Provider labels are stored as-is — never converted to agent verdicts.

### Acceptance Criteria
- [ ] Two identical alerts from the same provider insert as one row (dedup).
- [ ] Two alerts for same ticker from different providers insert as two rows (independent corroboration).
- [ ] Alert with no direction field is stored as `direction = null` and excluded from corroboration.
- [ ] Provider name is stored verbatim (e.g., "TradeVision", "Unusual Whales").

---

## P2-21 · Lane State Manager

**Epic:** Infrastructure | **Phase:** 2 | **Priority:** P0 | **Complexity:** M
**Depends on:** P2-01, P1-04 | **Blocks:** P3-20, all signal computers

### User Story
As any signal computer and the API layer, I need to query the current state of any lane for any ticker so I can decide whether to compute, suppress, or caution a result.

### Technical Design
- `app/lanes/lane_state_manager.py`
  - `get_lane_state(lane_id: str, ticker: str, clock: AbstractClock) -> LaneState`
  - Computes state by checking: source existence, freshness (vs. SLA from lane registry), coverage, and error flags.
  - State transitions: raw data exists → `source_available_not_analyzed` → derived agent runs → `ready` or `partial_usable`.
  - `LaneState` object includes all fields from P1-04 schema.
  - `is_suppressed(lane_state: LaneState) -> bool` — returns True for states that block scoring.

### Acceptance Criteria
- [ ] All 8 states reachable via test scenarios.
- [ ] Freshness check uses injected clock, not wall clock.
- [ ] `is_suppressed` returns True for `loading`, `source_unavailable`, `blocked`.
- [ ] `is_suppressed` returns False for `partial_usable` (context allowed, not suppressed).
- [ ] `next_action.route` points to valid API refresh route.

### Testing Requirements
- **Unit:** Each of the 8 states returned for correct input conditions.
- **Unit:** ReplayClock injected → freshness computed relative to replay time, not now.

### QA Checklist
- [ ] `loading` state → UI shows "Data is still loading"; no prior score shown as current.
- [ ] `partial_usable` state → tier capped at C; labeled "Usable — partial coverage".

---

## P2-22 · Replay Harness

**Epic:** Infrastructure | **Phase:** 2 | **Priority:** P1 | **Complexity:** L
**Depends on:** P1-07, P2-06, P2-07 through P2-19 | **Blocks:** P4-01

### User Story
As a quant validator, I need to replay the full signal computation pipeline at any historical timestamp using point-in-time data so I can evaluate signal quality without look-ahead bias.

### Technical Design
- `app/replay/harness.py`
  - `ReplaySession(as_of: datetime, universe: list[str])` — initializes with `ReplayClock(as_of)`.
  - Loads historical Parquet lane artifacts from `data/history/{date}/{lane_id}/{ticker}.parquet`.
  - Runs full pipeline (P2-07 through P2-19) with replay clock.
  - Stores results in `replay_signal_results` table with `replay_mode = true`, `replay_clock = as_of`.
  - Baseline queries use `as_of_date - 1` boundary (strictly before).
  - `run_replay(start_date, end_date, universe, universe_id)` — runs across a date range.

### Acceptance Criteria
- [ ] No live API calls made during replay (all data from historical Parquet).
- [ ] Baseline always uses data strictly before `as_of_date`.
- [ ] All signal results tagged `replay_mode = true`.
- [ ] `ReplayClock.now()` returns the replay timestamp throughout the pipeline.
- [ ] Results are reproducible: same input → same output (deterministic).

### Definition of Done
- [ ] Code committed, all tests passing.
- [ ] Successfully replays 30 days of data for a 10-ticker universe without error.

### QA Checklist
- [ ] Replay on 2026-01-15 uses baseline from sessions before 2026-01-15 only.
- [ ] Replay results do not appear in live dashboard queries.

---
---

# PHASE 3 — API & DASHBOARD

*FastAPI endpoints + web frontend. Runs on Pi 5, served via Cloudflare tunnel.*

---

## P3-01 · FastAPI Application Bootstrap & Routing

**Epic:** API | **Phase:** 3 | **Priority:** P0 | **Complexity:** S
**Depends on:** P2-01, P1-05 | **Blocks:** P3-02 through P3-06

### User Story
As a developer, I need all API routers mounted, CORS configured, and static file serving enabled so that frontend development can begin against real endpoints.

### Technical Design
- Wire all routers from `api/routes/` into `app/main.py`.
- Mount `StaticFiles` at `/` serving `frontend/` directory.
- CORS: allow Cloudflare domain origin only (configured via env var).
- OpenAPI docs served at `/docs` (disable in production via env flag).
- `GET /api/health` returns system status including DB, lane states summary, and scheduler status.

### Acceptance Criteria
- [ ] All 9 endpoints from OpenAPI spec return correct HTTP status codes (200/404/503 as appropriate for empty state).
- [ ] CORS only allows configured origin.
- [ ] `/api/health` returns `{"status": "ok", "db": "connected", "scheduler": "running"}`.
- [ ] Frontend `index.html` served at `/`.

---

## P3-02 · Single Ticker Analysis Endpoint

**Epic:** API | **Phase:** 3 | **Priority:** P0 | **Complexity:** M
**Depends on:** P2-19, P3-01, P1-05 | **Blocks:** P3-17

### User Story
As a user in single-ticker mode, I need `GET /api/analyze/single?ticker=AVGO` to return a full signal result so the UI can render the BLUF card and evidence cards.

### Technical Design
- `app/api/routes/single_ticker.py`
- Orchestrates: lane state check → normalize prints → sign → block detect → compute signals → B indicators → corroboration → tier classify → build BLUF text → return response.
- Uses `LiveClock` in production.
- Response matches OpenAPI schema from P1-05.
- BLUF text generated by `app/signals/bluf_generator.py` using templates parameterized by tier, direction, and top-2 most unusual metrics.

### Acceptance Criteria
- [ ] Response matches OpenAPI schema exactly (validated by `openapi-core` in test).
- [ ] `indicators.A = null` in response (single-ticker mode).
- [ ] BLUF text uses only allowed terminology from P1-08.
- [ ] Returns 404 with correct shape when ticker has no baseline.
- [ ] Returns 503 with correct shape when required lane is unavailable.
- [ ] Response time < 2 seconds on Pi 5 for a ticker with warm cache.

### Definition of Done
- [ ] Code committed, all tests passing.
- [ ] Pi 5 response time benchmark documented.

### Testing Requirements
- **Integration:** Mock Massive lane data, assert full response is schema-valid.
- **Integration:** Trigger each HTTP error condition (404, 206, 503); assert correct response shape.
- **Unit:** BLUF text generator uses no forbidden terms.

### QA Checklist
- [ ] TRF print → BLUF says "TRF/off-exchange" not "dark pool".
- [ ] All prints are average-price type → score suppressed, correct label.
- [ ] `signing_confidence < 0.50` → direction field shows "low_confidence_indicative".

---

## P3-03 · Portfolio Analysis Endpoint

**Epic:** API | **Phase:** 3 | **Priority:** P1 | **Complexity:** M
**Depends on:** P2-16, P2-19, P3-01 | **Blocks:** P3-18

### Technical Design
- `POST /api/analyze/portfolio` with body `{"tickers": ["AVGO","NVDA",...], "label": "My Portfolio"}`.
- Computes signals for all tickers in parallel (asyncio gather).
- Computes A-scores cross-sectionally across portfolio tickers.
- Returns array of ticker results sorted by `C_order` descending.
- Includes delta vs. last cycle (reads prior results from `unusual_activity_signal_results`).

### Acceptance Criteria
- [ ] A-scores reflect percentile within the portfolio, not a broader universe.
- [ ] Results sorted by `C_order` descending.
- [ ] Delta indicator present for each ticker (null if no prior cycle).
- [ ] Max 50 tickers in one request; returns 400 if exceeded.
- [ ] Response < 10 seconds for 20-ticker portfolio on Pi 5.

---

## P3-04 · Scan Pass 1 Endpoint (Fast Screen)

**Epic:** API | **Phase:** 3 | **Priority:** P1 | **Complexity:** M
**Depends on:** P2-17, P2-06, P3-01 | **Blocks:** P3-19

### Technical Design
- `GET /api/scan?universe=sp500&direction=bullish&pass=1`
- Uses only `baseline_cache` and `massive_daily_bars` (no live tick slices).
- Computes `C_screen` for all universe tickers.
- Applies direction filter from `daily_return` direction.
- Returns top 50 ranked by `C_screen`, labeled `preliminary: true`, `pass2_status: "pending"`.
- Performance target: < 30 seconds for S&P 500 (503 tickers) on Pi 5.

### Acceptance Criteria
- [ ] Returns results within 30 seconds for 🟡 Standard universe.
- [ ] All results labeled `preliminary: true`.
- [ ] Direction filter applied (bullish/bearish/both).
- [ ] Returns `performance_tier` and `estimated_pass2_seconds` in response.

---

## P3-05 · Scan Pass 2 Endpoint (Deep Analysis)

**Epic:** API | **Phase:** 3 | **Priority:** P1 | **Complexity:** M
**Depends on:** P2-19, P3-04 | **Blocks:** P3-19

### Technical Design
- `GET /api/scan?universe=sp500&direction=bullish&pass=2&shortlist=AVGO,NVDA,...`
- Pulls live trade slices for shortlisted tickers only.
- Runs full pipeline (P2-07 through P2-19) for each shortlist ticker.
- Computes A-scores cross-sectionally within shortlist.
- Returns results sorted by `C_order`; each result has `preliminary: false`.
- SSE stream at `GET /api/events/scan?session_id=...` pushes each ticker result as it completes.

### Acceptance Criteria
- [ ] Only pulls Massive live slices for shortlisted tickers (max 50).
- [ ] SSE stream emits one event per completed ticker.
- [ ] Full results replace preliminary results (same schema shape).
- [ ] A-scores computed within shortlist, not full universe.

---

## P3-06 · Server-Sent Events (SSE) for Progressive Updates

**Epic:** API | **Phase:** 3 | **Priority:** P1 | **Complexity:** S
**Depends on:** P3-01 | **Blocks:** P3-19

### Technical Design
- `app/api/routes/events.py` using FastAPI's `EventSourceResponse` (or `StreamingResponse` with `text/event-stream`).
- Events: `{"event": "ticker_complete", "data": {"ticker": "AVGO", "tier": "A", ...}}`.
- `{"event": "scan_complete", "data": {"total": 28, "completed": 28}}`.
- `{"event": "error", "data": {"ticker": "NVDA", "reason": "lane_unavailable"}}`.
- Client reconnects automatically via `EventSource` browser API.

### Acceptance Criteria
- [ ] SSE connection stays open for the full scan duration.
- [ ] Each ticker emits one `ticker_complete` event when Pass 2 finishes.
- [ ] `scan_complete` event emitted after all tickers done.
- [ ] Connection closes cleanly when scan is done.

---

## P3-07 · Cloudflare Tunnel & Zero Trust Configuration

**Epic:** Infrastructure | **Phase:** 3 | **Priority:** P0 | **Complexity:** S
**Depends on:** P3-01 | **Blocks:** All frontend tickets

### Technical Design
- Install `cloudflared` on Pi 5 as a systemd service.
- Configure tunnel to route `https://yourdomain.com` → `http://localhost:8000`.
- Cloudflare Access policy: email-based OTP or GitHub SSO (user's existing setup).
- `deploy/cloudflared.service` committed to repo.
- SSL terminates at Cloudflare edge — no cert management on Pi 5.
- Health check: Cloudflare monitors `GET /api/health`.

### Acceptance Criteria
- [ ] App accessible at Cloudflare domain from any browser.
- [ ] Unauthenticated request returns Cloudflare Access login, not the app.
- [ ] HTTPS enforced (HTTP redirected to HTTPS by Cloudflare).
- [ ] Pi 5 LAN IP not exposed publicly (no port forwarding required).
- [ ] `cloudflared` restarts automatically on reboot.

---

## P3-08 · Frontend Foundation (HTML/CSS/HTMX/Alpine.js)

**Epic:** Frontend | **Phase:** 3 | **Priority:** P0 | **Complexity:** M
**Depends on:** P3-07, P1-05, P1-08 | **Blocks:** P3-09 through P3-20

### Technical Design
- `frontend/index.html` — single-page shell served by FastAPI.
- CDN imports: HTMX 1.9+, Alpine.js 3.x, Tailwind CSS (CDN play), Chart.js 4.x.
- No Node.js, no build step. All JS inline or in `frontend/js/`.
- Design system: Tailwind utility classes only. Dark-mode-first (trading dashboard convention).
- Layout: top nav (mode selector, regime banner), main content area, right sidebar (lane health panel).
- All API calls via HTMX `hx-get`/`hx-post` or Alpine.js `fetch`. No jQuery.
- `frontend/js/api.js` — thin wrapper for all API calls with error handling.
- `frontend/js/sse.js` — EventSource wrapper for scan SSE stream.

### Acceptance Criteria
- [ ] Loads and renders without error on Chrome, Firefox, Safari (latest).
- [ ] Mobile layout functional at 375px width (Tailwind responsive classes).
- [ ] No forbidden terms appear anywhere in the HTML/JS source.
- [ ] Page loads in < 2 seconds over Cloudflare tunnel on a standard internet connection.

---

## P3-09 · Mode Selector Component

**Epic:** Frontend | **Phase:** 3 | **Priority:** P0 | **Complexity:** XS
**Depends on:** P3-08 | **Blocks:** P3-17, P3-18, P3-19

### Technical Design
- Three tab buttons: "Single Ticker", "Portfolio", "Scan / Discovery".
- Alpine.js state: `activeMode`. Switches main content area via `x-show`.
- Mode stored in `localStorage` so it persists on refresh.
- URL hash updated: `#single`, `#portfolio`, `#scan` — deep-linkable.

### Acceptance Criteria
- [ ] Clicking each tab switches to correct view.
- [ ] Active mode persists across page refresh.
- [ ] URL hash updated on mode change.
- [ ] Keyboard navigable (tab + enter).

---

## P3-10 · Universe Selector Component

**Epic:** Frontend | **Phase:** 3 | **Priority:** P1 | **Complexity:** S
**Depends on:** P3-08, P2-02 | **Blocks:** P3-19

### Technical Design
- Dropdown tree: Index → Sector (sub-selector appears) → Exchange → Custom.
- Fetches universe list from `GET /api/universes`.
- Shows performance tier indicator (🟢/🟡/🔴) and ticker count next to each option.
- Shows estimated scan time below selector when a universe is chosen.
- Custom list: textarea for manual ticker entry; validates each symbol format.

### Acceptance Criteria
- [ ] Performance tier indicator visible for every universe option.
- [ ] Estimated time shown before scan starts.
- [ ] Sector selector only appears after an index is selected.
- [ ] Custom list validates that symbols are 1–5 uppercase letters.

---

## P3-11 · Market Regime Banner Component

**Epic:** Frontend | **Phase:** 3 | **Priority:** P2 | **Complexity:** S
**Depends on:** P3-08, P2-04 | **Blocks:** None

### Technical Design
- Fixed banner below top nav.
- Color-coded: green (risk-on), yellow (neutral), orange (risk-off), red (crisis).
- Shows: VIX value, yield curve spread, Fed Funds Rate, regime label, interpretation note.
- Fetches from `GET /api/macro`. Refreshes every 5 minutes via HTMX polling.
- In crisis regime: banner is full-width red, text "All signals are context-only in crisis conditions."

### Acceptance Criteria
- [ ] Correct color for each of the 4 regimes.
- [ ] Crisis banner overrides all other color states.
- [ ] Refreshes without full page reload.
- [ ] Interpretation note uses only allowed terminology.

---

## P3-12 · BLUF Card Component

**Epic:** Frontend | **Phase:** 3 | **Priority:** P0 | **Complexity:** M
**Depends on:** P3-08, P1-08 | **Blocks:** P3-17, P3-18, P3-19

### Technical Design
- Reusable Alpine.js component: `<bluf-card :result="tickerResult">`.
- Shows: ticker, tier badge (color-coded A/B/C/D), direction chip, "What happened", "Why it matters", "What to check", "Limitations" sections.
- Tier badge colors: A=green, B=blue, C=yellow, D=grey.
- Direction chip: ↑ Buyer-side (green), ↓ Seller-side (red), ↔ Mixed (yellow), ? Undetermined (grey).
- Expandable: clicking card reveals evidence cards beneath.
- Regime context injected into "Limitations" section when VIX > 25.

### Acceptance Criteria
- [ ] No forbidden terms appear in any BLUF text or labels.
- [ ] Tier D cards are visually de-emphasized (grey, no color badge).
- [ ] Crisis regime adds limitation note to every card regardless of tier.
- [ ] Card is keyboard-accessible (expand/collapse via Enter).

---

## P3-13 · A/B/C Indicator Display Component

**Epic:** Frontend | **Phase:** 3 | **Priority:** P0 | **Complexity:** M
**Depends on:** P3-08, P1-03 | **Blocks:** P3-17, P3-18, P3-19

### Technical Design
- Compact indicator row below tier badge:
  ```
  B: 3.8σ vol | 2.9σ focus     A: 97th pct (S&P 500)     C: 9.8× notional
  ```
- B-scores shown per metric (volume, focus, pressure). Only the two highest shown in summary; full list in expanded view.
- A shown as "Xth percentile of [Universe Label] (N tickers)" — never without universe context.
- A hidden (not shown) in single-ticker mode.
- C shown as the two highest raw metric values.
- Tooltip on hover explains each indicator in plain English.

### Acceptance Criteria
- [ ] A section absent in single-ticker mode (not "N/A" label — completely absent).
- [ ] Universe label always present when A is shown.
- [ ] B-score precision: 1 decimal place (3.8σ, not 3.84782σ).
- [ ] C shown in natural units (×, $M, %, count) — never as a dimensionless score.

---

## P3-14 · Evidence Card Set (8 Types)

**Epic:** Frontend | **Phase:** 3 | **Priority:** P1 | **Complexity:** L
**Depends on:** P3-08, P1-08 | **Blocks:** P3-17, P3-18, P3-19

### Technical Design
Eight collapsible evidence cards, rendered from the `evidence_cards` array in the API response:

1. **Volume Anomaly** — ratio, band label, baseline median, B-score, time bucket.
2. **Block / TRF Activity** — focus count, focus notional ($M), largest print multiple, venue classification, B-score.
3. **Directional Pressure** — net notional pressure (%), net volume pressure (%), signing method mix bar chart, confidence badge.
4. **Pre-Market Activity** — volume ratio, pressure, gap direction (↑/↓), decay state ("Decayed 74% since open").
5. **Market Flow Trend** — pressure delta, participation, trend direction chip.
6. **Confirmed Alerts** — provider name, type, direction, timestamp, confidence level (Confirmed / Probable / Contextual).
7. **Macro Context** — VIX, yield curve, Fed Funds Rate, regime label, interpretation note.
8. **Data Health** — lane ID, state badge, latest source timestamp, coverage %, excluded print count, policy version, refresh button.

Each card has a "Show calculation" link that expands raw formula inputs.

### Acceptance Criteria
- [ ] All 8 card types render without error even when data for that card is `null`/unavailable.
- [ ] "Show calculation" link shows formula inputs, not code.
- [ ] Venue always labeled "TRF/off-exchange" — never "dark pool".
- [ ] Signing method mix shown as a horizontal bar (chart or CSS bar).
- [ ] Pre-market decay shown as a percentage.

---

## P3-15 · Corroboration Flag Display Component

**Epic:** Frontend | **Phase:** 3 | **Priority:** P1 | **Complexity:** S
**Depends on:** P3-08, P1-08 | **Blocks:** P3-17, P3-18, P3-19

### Technical Design
- Six flag rows with ✅/⬜/⚠️ indicators.
- Strong flags (✅ when true): price action aligned, options flow aligned, provider alert confirmed, pre+regular both elevated.
- Contextual flags (ℹ️ icon): news catalyst, macro regime.
- Each flag has a short plain-English explanation.
- "Corroboration count: X of 4 strong signals confirmed."

### Acceptance Criteria
- [ ] `options_flow_aligned: false` shows as ⬜, not as an error.
- [ ] Contextual flags shown with ℹ️, not ✅ — they don't count toward corroboration.
- [ ] Corroboration count visible and correct.

---

## P3-16 · User Actions Panel

**Epic:** Frontend | **Phase:** 3 | **Priority:** P2 | **Complexity:** M
**Depends on:** P3-08 | **Blocks:** P3-17, P3-18, P3-19

### Technical Design
Ten action buttons per ticker result:
1. **Refresh this lane** — triggers `POST /api/lanes/{lane_id}/refresh`.
2. **Show raw prints** — opens a modal with paginated print table.
3. **Show calculation** — expands formula detail in evidence card.
4. **Explain this tier** — opens a plain-English modal explaining why the tier was assigned.
5. **Compare to prior cycle** — shows delta indicators for B-scores and C metrics.
6. **Mark as reviewed** — local state (localStorage); adds a "✓ Reviewed" badge.
7. **Add to watchlist** — sends `POST /api/watchlist/add`.
8. **Use as supporting evidence** — sends intent to paper-trade module (Phase 5).
9. **Ignore for this cycle** — local state; suppresses the card until next refresh.
10. **Open candidate detail** — navigates to full-screen analysis page.

### Acceptance Criteria
- [ ] All 10 actions functional.
- [ ] "Mark as reviewed" and "Ignore for this cycle" persist in localStorage.
- [ ] "Refresh this lane" shows a loading state while request is in flight.
- [ ] "Explain this tier" modal uses only allowed terminology.

---

## P3-17 · Single Ticker Mode Full UI

**Epic:** Frontend | **Phase:** 3 | **Priority:** P0 | **Complexity:** M
**Depends on:** P3-09, P3-11, P3-12, P3-13, P3-14, P3-15, P3-16 | **Blocks:** None

### Technical Design
- Ticker search input with debounced autocomplete (searches against universe ticker list).
- On submit: `GET /api/analyze/single?ticker=AVGO`.
- Loading state: skeleton cards.
- On result: BLUF card → Indicator row (B + C only; no A) → Evidence cards (collapsed) → Corroboration panel → User actions.
- No scan/portfolio components shown in this mode.

### Acceptance Criteria
- [ ] Ticker not in any universe returns a message: "No baseline available for {ticker}. A baseline build has been triggered."
- [ ] A-scores completely absent from the page.
- [ ] All evidence cards present; cards with null data show "Data not available" gracefully.
- [ ] Page functional without JavaScript disabled for critical content (progressive enhancement).

---

## P3-18 · Portfolio Mode Full UI

**Epic:** Frontend | **Phase:** 3 | **Priority:** P1 | **Complexity:** M
**Depends on:** P3-09, P3-11, P3-12, P3-13, P3-15, P3-16 | **Blocks:** None

### Technical Design
- Portfolio management panel: add/remove tickers; save portfolio with a name.
- On analyze: `POST /api/analyze/portfolio`.
- Results table: sortable by C_order (default), B-score, A-score, tier.
- Delta indicator per row: "↑ +0.4σ since last cycle" or "↓ −0.2σ".
- Click any row to expand full BLUF + evidence cards.
- "Analyze now" button + auto-refresh toggle (every 5 minutes).

### Acceptance Criteria
- [ ] Portfolio saved to localStorage and reloaded on page refresh.
- [ ] Table sortable by each column header.
- [ ] Delta indicator shows `—` when no prior cycle exists.
- [ ] A-scores labeled "of your portfolio today (N holdings)".
- [ ] Auto-refresh shows a countdown timer to next refresh.

---

## P3-19 · Scan Mode Full UI with Progressive Loading

**Epic:** Frontend | **Phase:** 3 | **Priority:** P1 | **Complexity:** L
**Depends on:** P3-09, P3-10, P3-11, P3-12, P3-13, P3-06 | **Blocks:** None

### Technical Design
- Universe selector (P3-10) + direction filter (Bullish / Bearish / Both) + Scan button.
- Performance tier shown before scan starts with estimated time.
- On scan start:
  1. Calls `GET /api/scan?pass=1` — renders preliminary results table immediately.
  2. Opens SSE connection to `GET /api/events/scan?session_id=...`.
  3. As SSE events arrive, replaces preliminary rows with full Pass 2 results.
  4. Progress bar updates per SSE event.
- Pass 1 rows labeled "Preliminary — live data loading" with a spinner.
- Pass 2 rows replace inline — no page reload.
- "Stop scan" button closes SSE connection and halts Pass 2.

### Acceptance Criteria
- [ ] Pass 1 results visible within 30 seconds for S&P 500.
- [ ] Pass 2 updates arrive progressively (not all at once at the end).
- [ ] Progress bar accurately reflects Pass 2 completion.
- [ ] "Stop scan" halts SSE and stops further Pass 2 requests.
- [ ] Preliminary rows clearly distinguished from confirmed rows.
- [ ] 🔴 Extended universe shows a time warning before scan starts.

---

## P3-20 · Data Health & Lane State Panel

**Epic:** Frontend | **Phase:** 3 | **Priority:** P1 | **Complexity:** S
**Depends on:** P3-08, P2-21 | **Blocks:** None

### Technical Design
- Collapsible sidebar panel: "Data Health".
- Shows all active lanes with state badge (Ready / Loading / Needs Refresh / etc.).
- Each lane shows: last updated time, freshness, coverage %.
- Refresh button per lane calls `POST /api/lanes/{lane_id}/refresh`.
- Auto-polls `GET /api/health` every 60 seconds; updates badges without reload.
- Critical lanes that are unavailable show a prominent warning at the top of the panel.

### Acceptance Criteria
- [ ] All lane states from P1-04 correctly styled.
- [ ] "Analysis needs refresh" state shows a distinct yellow badge.
- [ ] "Provider unavailable" state shows red badge with refresh button.
- [ ] Panel accessible via keyboard.
- [ ] Lane state updates within 60 seconds of an actual state change.

---
---

# PHASE 4 — VALIDATION & CALIBRATION

*Statistical validation before Phase 5. No new features. Phase 5 is locked until P4-08 passes.*

---

## P4-01 · Historical Data Replay Integration

**Epic:** Validation | **Phase:** 4 | **Priority:** P0 | **Complexity:** L
**Depends on:** P2-22 | **Blocks:** P4-02

### User Story
As a quant validator, I need the replay harness connected to real historical Massive lane artifacts so I can run a full backtest of the signal pipeline.

### Technical Design
- Load historical Parquet files from `data/history/` (populated from Massive historical exports).
- Run `ReplaySession` across 6–12 months of data for the S&P 500 universe.
- Store all replay results in `replay_signal_results`.
- Log replay progress to `scheduled_job_log`.
- Command: `python -m app.replay.run --start 2025-01-01 --end 2025-12-31 --universe sp500`.

### Acceptance Criteria
- [ ] Full 12-month replay completes without errors.
- [ ] All signal results tagged `replay_mode = true`.
- [ ] No live Massive API calls during replay (verified by mock/network intercept in test).
- [ ] Replay logs show per-day completion timestamps.

---

## P4-02 · Outcome Evaluation Framework

**Epic:** Validation | **Phase:** 4 | **Priority:** P0 | **Complexity:** L
**Depends on:** P4-01 | **Blocks:** P4-03, P4-05, P4-08

### User Story
As a quant validator, I need a framework that evaluates forward returns at 4 horizons for each signal tier so I can assess whether Tier A signals have positive predictive value.

### Technical Design
- `app/validation/outcome_evaluator.py`
- For each replay signal result: join to forward price data at T+30min, T+60min, close, T+1day.
- Compute: mean return, win rate, MAE (Max Adverse Excursion), realized volatility.
- Separate results by: tier (A/B/C/D), direction (bullish/bearish), liquidity bucket, macro regime.
- Output: `validation/outcomes_{run_id}.csv` + summary report `validation/summary_{run_id}.md`.

### Acceptance Criteria
- [ ] All 4 return horizons computed for every signal result with a valid forward price.
- [ ] Results segmented by tier, direction, liquidity bucket, and macro regime.
- [ ] MAE computed for each signal.
- [ ] Summary report includes: mean return per tier/horizon, win rate, sample size, liquidity bucket breakdown.

---

## P4-03 · BH FDR Correction Procedure

**Epic:** Validation | **Phase:** 4 | **Priority:** P0 | **Complexity:** M
**Depends on:** P4-02 | **Blocks:** P4-08

### Technical Design
- `app/validation/fdr_correction.py`
- Runs statistical tests (t-test for mean return > 0) for all component/horizon combinations.
- Applies Benjamini-Hochberg correction at FDR = 0.10.
- Reports which components have BH-adjusted p < 0.10.
- Output: `validation/fdr_results_{run_id}.csv`.

### Acceptance Criteria
- [ ] BH correction applied across all metric × horizon × tier combinations.
- [ ] Report clearly identifies which components pass FDR gate.
- [ ] Components failing FDR gate flagged for weight reduction or removal.

---

## P4-04 · Look-Ahead Bias Audit Tool

**Epic:** Validation | **Phase:** 4 | **Priority:** P0 | **Complexity:** S
**Depends on:** P4-01 | **Blocks:** P4-08

### Technical Design
- `app/validation/lookahead_audit.py`
- For a sample of replay runs: assert that no baseline metric uses data from >= `as_of_date`.
- Assert that no raw print in the signal computation has a timestamp >= `as_of_date`.
- Assert that earnings exclusion uses only past earnings dates.
- Output: pass/fail with a list of any violations found.

### Acceptance Criteria
- [ ] Zero violations in a full audit of the 12-month replay.
- [ ] Tool runs in < 5 minutes on Pi 5.
- [ ] Any violation causes the tool to exit with non-zero code (CI-compatible).

---

## P4-05 · Tier Threshold Calibration by Liquidity Bucket

**Epic:** Validation | **Phase:** 4 | **Priority:** P1 | **Complexity:** M
**Depends on:** P4-02, P4-03 | **Blocks:** P4-08

### Technical Design
- Using outcome evaluation results: test whether B-score thresholds (1.0σ, 1.5σ, 2.0σ, 2.5σ) are predictive at each liquidity bucket.
- Recommend adjusted thresholds if mega-cap names systematically underperform Tier A criteria at 2.5σ.
- Output: `validation/threshold_calibration_{run_id}.md` with recommended adjustments.

### Acceptance Criteria
- [ ] Analysis run separately for each of the 5 liquidity buckets.
- [ ] Adjusted thresholds documented with supporting statistics.
- [ ] Recommendations feed into a configuration update (not a code change) in `config/tier_thresholds.json`.

---

## P4-06 · B-Score Stability Measurement

**Epic:** Validation | **Phase:** 4 | **Priority:** P1 | **Complexity:** S
**Depends on:** P4-01 | **Blocks:** P4-08

### Technical Design
- For consecutive cycle pairs in the replay: compute correlation of B-scores for tickers that had no new data between cycles.
- Target: correlation >= 0.90 (from acceptance criteria).
- Output: mean correlation per lane, per liquidity bucket.

### Acceptance Criteria
- [ ] Mean B-score stability >= 0.90 for all liquidity buckets.
- [ ] Any bucket below 0.90 flagged for investigation.

---

## P4-07 · Lane Availability SLA Dashboard

**Epic:** Validation | **Phase:** 4 | **Priority:** P2 | **Complexity:** S
**Depends on:** P2-21 | **Blocks:** P4-08

### Technical Design
- Query `scheduled_job_log` + lane state history: compute % of cycles where required lanes were `ready`.
- Target: >= 95% of cycles with all required lanes ready.
- Output: simple HTML report accessible at `/admin/sla`.

### Acceptance Criteria
- [ ] SLA % computed per lane, per week.
- [ ] Weeks below 95% highlighted in red.

---

## P4-08 · Acceptance Criteria Gate Report

**Epic:** Validation | **Phase:** 4 | **Priority:** P0 | **Complexity:** S
**Depends on:** P4-02, P4-03, P4-04, P4-05, P4-06, P4-07 | **Blocks:** Phase 5 (all tickets)

### User Story
As the product owner, I need a single gate report that confirms all acceptance criteria from the v2 spec have been met before Phase 5 begins.

### Technical Design
- `app/validation/gate_report.py` — reads all validation outputs and produces a single `validation/gate_report.md`.
- Gate criteria (all must pass):
  - [ ] IR >= 0.30 for Tier A signals (30-min horizon, OOS)
  - [ ] False positive rate <= 40% (Tier A bullish, next-close negative)
  - [ ] Precision at top decile >= 55% (30-min forward)
  - [ ] B-score stability >= 0.90
  - [ ] Lane availability SLA >= 95%
  - [ ] Look-ahead bias audit: 0 violations
  - [ ] FDR correction: at least 2 components pass BH gate

### Acceptance Criteria
- [ ] All 7 gate criteria evaluated with pass/fail result.
- [ ] Report includes raw statistics supporting each pass/fail.
- [ ] Report is committed to repo as a Phase 5 prerequisite artifact.
- [ ] Phase 5 tickets cannot be started until this report shows all 7 passing.

---
---

# PHASE 5 — PAPER-TRADING INTEGRATION

*Integration with the parent Trading Agency. Only begins after P4-08 passes.*

---

## P5-01 · Tier A Signal Exposure to Candidate Ranking

**Epic:** Paper-Trading | **Phase:** 5 | **Priority:** P0 | **Complexity:** M
**Depends on:** P4-08 | **Blocks:** P5-02

### User Story
As the Trading Agency, I need Tier A signals from the Unusual Trading Activity Agent to be available as supporting evidence for paper-trade candidate ranking, so unusual institutional activity can contribute to conviction.

### Technical Design
- Expose `GET /api/signals/unusual-activity?cycle_id=...` for the parent agency to consume.
- Tier A and Tier B results published to a shared signal bus (or direct API call from parent agency).
- Tier D results never exposed to the parent agency.
- Max contribution to candidate score: capped at a configurable limit (default: 15% of total candidate score). Configured in `config/paper_trading_integration.json`.

### Acceptance Criteria
- [ ] Only Tier A and Tier B results are exposed to parent agency.
- [ ] Tier D results produce no signal in the parent agency.
- [ ] Contribution cap is configurable without code change.
- [ ] Lane state `not ready` → no signal emitted (not a zero score).

---

## P5-02 · Corroboration Gate Enforcement

**Epic:** Paper-Trading | **Phase:** 5 | **Priority:** P0 | **Complexity:** S
**Depends on:** P5-01 | **Blocks:** None

### Technical Design
- Before any Tier A signal contributes to a paper-trade decision: `corroboration_count >= 1` is enforced at the integration layer (not only in the classifier).
- If corroboration count drops to 0 between cycles, the contribution is reduced to Tier B level.

### Acceptance Criteria
- [ ] Tier A signal with `corroboration_count = 0` is treated as Tier B in paper-trade contribution.
- [ ] This enforcement is logged and visible in the candidate detail page.

---

## P5-03 · Caution Display Integration

**Epic:** Paper-Trading | **Phase:** 5 | **Priority:** P1 | **Complexity:** S
**Depends on:** P5-01 | **Blocks:** None

### Technical Design
- When unusual activity signal is `caution` (Tier C or low confidence), show a compact caution line in the paper-trade Execution Preview UI:
  - "Unusual activity detected but direction is uncertain — treat as context only."
  - Never block the paper-trade workflow — caution only, no gating.

### Acceptance Criteria
- [ ] Caution line appears in Execution Preview for Tier C signals.
- [ ] Caution line does not appear for Tier D (suppressed) signals.
- [ ] No paper-trade decision is blocked by unusual activity alone.

---

## P5-04 · Candidate Detail Page Integration

**Epic:** Paper-Trading | **Phase:** 5 | **Priority:** P1 | **Complexity:** M
**Depends on:** P5-01, P3-12, P3-14 | **Blocks:** None

### Technical Design
- Embed the BLUF card + full evidence card set for the relevant ticker in the parent agency's Candidate Detail page.
- Reuses P3-12 and P3-14 components via iframe or web component.
- No new signal computation — reads from `unusual_activity_signal_results` for the current cycle.

### Acceptance Criteria
- [ ] BLUF card visible in Candidate Detail page.
- [ ] All 8 evidence cards accessible (collapsed by default; expandable).
- [ ] Corroboration panel visible.
- [ ] Data health lane state shown.

---

## P5-05 · Scan "Add to Paper-Trade Watchlist" Action

**Epic:** Paper-Trading | **Phase:** 5 | **Priority:** P2 | **Complexity:** S
**Depends on:** P3-19, P5-01 | **Blocks:** None

### Technical Design
- "Add to paper-trade watchlist" action (from P3-16) sends `POST /api/watchlist/add` with ticker and signal snapshot.
- Watchlist visible in Portfolio mode; watchlist tickers analyzed at every cycle.
- Watchlist stored in SQLite; max 50 tickers.

### Acceptance Criteria
- [ ] Adding a ticker from scan results adds it to the watchlist.
- [ ] Watchlist tickers appear in Portfolio mode on next page load.
- [ ] Max 50 tickers enforced; user shown message if limit reached.

---

## Dependency Map Summary

```
Phase 1 (all contracts) → Phase 2 (all backend)
P2-01 (scaffold) → all other P2 tickets
P2-07 → P2-08 → P2-09, P2-12
P2-09, P2-08 → P2-11, P2-12
P2-06 → P2-15 (B indicator)
P2-10, P2-11, P2-12 → P2-15, P2-16, P2-17
P2-15, P2-16, P2-17, P2-18 → P2-19 (tier classifier)
P2-19 → P3-02, P3-03, P3-05
P3-01 → all P3 API tickets
P3-08 → all frontend component tickets
P3-09, P3-10, P3-11, P3-12, P3-13, P3-14, P3-15, P3-16 → P3-17, P3-18, P3-19
P4-01 through P4-07 → P4-08
P4-08 → all Phase 5 tickets
```

---

## Complexity Summary

| Phase | Tickets | XS | S | M | L | XL | Est. dev-days |
|---|---|---|---|---|---|---|---|
| Phase 1 — Contracts | 9 | 3 | 4 | 2 | 0 | 0 | ~12 |
| Phase 2 — Data Engine | 22 | 1 | 7 | 11 | 3 | 0 | ~55 |
| Phase 3 — API & Dashboard | 20 | 1 | 7 | 9 | 3 | 0 | ~50 |
| Phase 4 — Validation | 8 | 1 | 3 | 3 | 1 | 0 | ~18 |
| Phase 5 — Paper-Trading | 5 | 0 | 2 | 2 | 0 | 1 | ~14 |
| **Total** | **64** | | | | | | **~149 dev-days** |

*Estimates assume one developer. Parallelism within a phase (where dependencies allow) can significantly reduce calendar time.*

---

## Global QA Gates (Must Pass Before Each Phase Completes)

| Phase | Gate |
|---|---|
| Phase 1 | All contract files committed; CI schema validation passing; reviewed by lead developer |
| Phase 2 | All signal unit tests passing; Pi 5 baseline rebuild benchmark < 10 min for 500 tickers; replay harness produces reproducible results |
| Phase 3 | All API responses schema-valid; no forbidden terms in UI; Cloudflare tunnel accessible; mobile layout functional |
| Phase 4 | All 7 acceptance criteria in P4-08 pass; gate report committed to repo |
| Phase 5 | Tier D signals never reach paper-trade module; no paper-trade decision blocked by unusual activity alone |
