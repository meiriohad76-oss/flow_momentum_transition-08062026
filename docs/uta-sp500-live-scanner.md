# UTA Automatic S&P 500 Live Scanner

The UTA scan endpoint supports a full automatic S&P 500 live pass when the caller uses live source mode and leaves the ticker list blank:

```powershell
Invoke-RestMethod "https://uta.ahaddashboards.uk/api/uta/scan?source=live&universe=sp500&direction=bullish&pass=1"
```

## Data Sources

- Universe: cached S&P 500 constituents from `UTA_SP500_UNIVERSE_URL`.
- Pass 1 market activity: Massive grouped daily bars across recent sessions.
- Pass 2 evidence: Massive per-ticker trade prints for the shortlist only.

## Runtime Shape

Pass 1 does not fetch trade prints for all 500 names. It uses grouped daily bars so the whole universe can be ranked with roughly one request per recent market date. This keeps the Raspberry Pi profile realistic and avoids 500 per-ticker history calls.

Pass 2 resolves only the shortlist with trade prints:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "https://uta.ahaddashboards.uk/api/uta/scan/pass2" `
  -ContentType "application/json" `
  -Body '{"shortlist":["MSFT","NVDA"],"source":"live","direction":"bullish"}'
```

## Safety Rules

- Live mode never falls back to replay rows silently.
- Missing Massive credentials return `live_unavailable`.
- Pass 1 rows are preliminary because direction is resolved from signed flow in pass 2.
- Scheduler remains manual; this scanner has no paper-trading effect.

## Config

- `UTA_SP500_UNIVERSE_URL`
- `UTA_SP500_UNIVERSE_CACHE_PATH`
- `UTA_SP500_UNIVERSE_CACHE_MS`
- `UTA_LIVE_SCAN_GROUPED_DAYS`
- `UTA_LIVE_SCAN_BASELINE_SESSIONS`
- `UTA_LIVE_SCAN_MAX_RESULTS`
- `UTA_LIVE_SCAN_SHORTLIST_LIMIT`
