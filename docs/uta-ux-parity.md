# UTA UX Parity Contract

Canonical source: `ux design/`.

The UTA implementation must render the product anatomy defined by these files:

- `ux design/spec/screens.html`
- `ux design/spec/data-logic.html`
- `ux design/components.jsx`
- `ux design/evidence.jsx`
- `ux design/detail-extras.jsx`
- `ux design/modes.jsx`
- `ux design/scan.jsx`

Required Single Ticker surfaces:

- BLUF card with Tier badge, direction tag, anomaly band, confidence, and four rows: What happened, Why it matters, What to check, Limitations.
- A/B/C indicator summary with A shown as `N/A` in single-ticker mode.
- Cycle History timeline/ribbon, not only a plain list.
- Evidence grid with the nine canonical cards: Volume Anomaly, Block / Off-Exchange Activity, Directional Pressure, Pre-Market Activity, Market Flow Trend, Confirmed Alerts, Options Flow, Macro Context, Data Health.
- Corroboration panel with six flags and strong/moderate/contextual independence.
- Actions panel with Revalidate, Raw Prints, Explain Tier, Compare, Watchlist, and lane refresh controls.
- Raw Prints drawer opened from Actions.
- Explain Tier modal opened from Actions and populated from classifier payload.

Verification:

- Run `npm run check:uta-ux-parity`.
- This check fails if the implementation loses the canonical BLUF, A/B/C, evidence, corroboration, actions, drawer, or modal surfaces.
- This check is structural parity. Pixel-level parity still requires screenshot review against `ux design/spec/images/*.png`.
