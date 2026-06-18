# Auto-Refresh + Loading States Design
**Date:** 2026-06-18  
**Scope:** `src/uta/src/app.tsx`, `src/uta/src/modes.tsx`, `src/uta/src/styles.css`

---

## Overview

Two related UX improvements to the Single Ticker analysis cycle:
1. **Auto-refresh** — timer re-runs analysis automatically at a user-configured interval
2. **Loading states** — skeleton layout replaces the "Loading…" text panel during any analysis run

---

## 1. Auto-Refresh Timer

### State
- `autoRefreshInterval: 0 | 3 | 5 | 10` in `App` component
- Initialized from `localStorage` key `uta_autorefresh_v1`, default `5`
- `0` means off
- Written back to `localStorage` on every change

### Behavior
- A single `useEffect` watches `[autoRefreshInterval, activeTicker, mode]`
- On mount or dependency change: clear any previous interval; if `autoRefreshInterval > 0` and `mode === "single"`, set a new `setInterval` that calls `loadSingle(activeTicker)`
- Cleanup function clears the interval
- Auto-refresh is **paused** when not in Single Ticker mode (interval is never set for other modes)
- Manual Analyze resets the timer (the `useEffect` re-runs when `activeTicker` changes, which `loadSingle` already sets)

---

## 2. Settings UI

### Placement
Inside `TopBar`. The `⚙` button gains a small **inline popover** (same pattern as the existing density popover `density-pop`).

### Popover contents
Two rows:
- **Auto-refresh:** `<select>` with options: Off / 3 min / 5 min / 10 min
- **Operator panel:** button that opens the existing runtime overlay (moves the current `⚙` click behavior here)

### Interaction
- `⚙` click toggles `showSettingsPop` state (same pattern as `showDensityPop`)
- Dismisses on Escape (via existing keyboard handler) or outside click
- `autoRefreshInterval` and setter passed as props: `TopBar` receives `autoRefresh: 0 | 3 | 5 | 10` and `onAutoRefreshChange: (v: 0 | 3 | 5 | 10) => void`
- `onOpenRuntime` moves from direct `⚙` click to a button inside the popover

---

## 3. Skeleton Component

### Component: `SingleSkeleton` in `modes.tsx`

Renders when `single.status === "loading"` — replaces `TickerDetail` entirely (old data not shown during loading or refresh).

### Layout
```
┌─────────────────────────────────────────┐
│ [████ BLUF-head skeleton ████████████]  │
│ [████] [████] [████]  ← 3 stat tiles   │
│ [████████████████████████████████████]  │ ← indicator grid
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ [██ ev-card skeleton ████████████████]  │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ [██ ev-card skeleton ████████████████]  │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ [██ ev-card skeleton ████████████████]  │
└─────────────────────────────────────────┘
```

### Animation
Single CSS keyframe `@keyframes skeleton-pulse`: opacity 0.4 → 0.8 → 0.4, duration 1.4s, ease-in-out, infinite. Applied via class `.sk-block` on all skeleton elements.

### Removal of old behavior
- The `{data.status === "loading" ? <section className="panel muted-panel">{data.message}</section> : null}` line in `SingleMode` is removed
- `RevalidationBar` stays (thin top bar, low-cost visual signal)

---

## Files Changed

| File | Change |
|---|---|
| `app.tsx` | Add `autoRefreshInterval` state + localStorage persistence; `useEffect` timer; `showSettingsPop` state; pass new props to `TopBar`; update `TopBar` component |
| `modes.tsx` | Add `SingleSkeleton` component; update `SingleMode` to render it when loading |
| `styles.css` | Add `.settings-pop`, `.sk-block`, `@keyframes skeleton-pulse` |

---

## Out of Scope
- Auto-refresh for Portfolio or Scan modes
- Server-push / SSE-driven refresh
- Configurable thresholds beyond the 4 fixed options
