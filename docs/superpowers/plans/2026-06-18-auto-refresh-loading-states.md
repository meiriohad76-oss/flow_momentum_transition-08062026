# Auto-Refresh + Loading States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-configurable auto-refresh timer to Single Ticker mode and replace the "Loading…" text with an animated skeleton layout.

**Architecture:** `autoRefreshInterval` state in `App` drives a `useEffect` timer; a settings popover on the `⚙` button exposes the control. `SingleSkeleton` in `modes.tsx` renders whenever `single.status === "loading"`, replacing both the old muted-panel text and `TickerDetail`.

**Tech Stack:** React 18, TypeScript, CSS custom properties (no new dependencies)

---

## File Map

| File | Change |
|---|---|
| `src/uta/src/styles.css` | Add `.sk-block`, `@keyframes skeleton-pulse`, `.settings-pop` |
| `src/uta/src/modes.tsx` | Add `SingleSkeleton`; update `SingleMode` to render it |
| `src/uta/src/app.tsx` | Add `autoRefreshInterval` state + timer + `showSettingsPop`; update `TopBar` |

---

## Task 1: Skeleton CSS

**Files:**
- Modify: `src/uta/src/styles.css`

- [ ] **Step 1: Add skeleton animation and block styles**

Find the comment `/* TopBar */` in styles.css (around line 245). Add the following block immediately before it:

```css
/* ── Skeleton loading state ─────────────────────────────── */
@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.4; }
  50%       { opacity: 0.8; }
}
.sk-block {
  background: var(--ink-3);
  border-radius: 6px;
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}
.sk-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 12px;
}
.sk-row {
  display: flex;
  gap: 12px;
}
.sk-tile {
  flex: 1;
  height: 56px;
  border-radius: 8px;
}
.sk-line-lg { height: 22px; border-radius: 4px; width: 60%; }
.sk-line-md { height: 14px; border-radius: 4px; width: 40%; }
.sk-line-sm { height: 12px; border-radius: 4px; width: 25%; }
.sk-line-full { height: 14px; border-radius: 4px; width: 100%; }
```

- [ ] **Step 2: Add settings popover style**

Immediately after the `.density-pop` block (around line 355), add:

```css
.settings-pop {
  position: absolute;
  top: 56px;
  right: 4px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: var(--panel);
  box-shadow: var(--shadow);
  padding: 12px;
  min-width: 180px;
}
.settings-pop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.8rem;
  color: var(--ink-2);
}
.settings-pop-row label {
  font-weight: 500;
  white-space: nowrap;
}
.settings-pop-row select {
  background: var(--bg);
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  color: var(--ink-1);
  font-size: 0.8rem;
  padding: 2px 6px;
  cursor: pointer;
}
.settings-pop-divider {
  border: none;
  border-top: 1px solid var(--line);
  margin: 2px 0;
}
.settings-pop .action-btn {
  width: 100%;
  font-size: 0.8rem;
  padding: 6px 10px;
}
```

- [ ] **Step 3: Build to verify no CSS errors**

```bash
npm run build:uta
```

Expected: `✓ built in Xs` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/uta/src/styles.css
git commit -m "feat(ux): add skeleton CSS and settings popover styles"
```

---

## Task 2: SingleSkeleton Component

**Files:**
- Modify: `src/uta/src/modes.tsx`

- [ ] **Step 1: Add `SingleSkeleton` component**

Open `src/uta/src/modes.tsx`. Find the line `export function SingleMode(` and insert the following component immediately before it:

```tsx
function SingleSkeleton() {
  return (
    <section className="mode-stack">
      {/* BLUF card skeleton */}
      <div className="sk-card">
        <div className="sk-row" style={{ alignItems: "center", gap: 16 }}>
          <div className="sk-block" style={{ width: 48, height: 48, borderRadius: 8, flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="sk-block sk-line-lg" />
            <div className="sk-block sk-line-md" />
          </div>
        </div>
        {/* Stat tiles */}
        <div className="sk-row">
          <div className="sk-block sk-tile" />
          <div className="sk-block sk-tile" />
          <div className="sk-block sk-tile" />
        </div>
        {/* Indicator grid placeholder */}
        <div className="sk-block" style={{ height: 80, borderRadius: 8 }} />
      </div>
      {/* Evidence card skeletons */}
      {[0, 1, 2].map((i) => (
        <div key={i} className="sk-card">
          <div className="sk-row" style={{ alignItems: "center" }}>
            <div className="sk-block" style={{ width: 20, height: 20, borderRadius: 4, flexShrink: 0 }} />
            <div className="sk-block sk-line-md" style={{ flex: 1 }} />
            <div className="sk-block sk-line-sm" />
          </div>
          <div className="sk-block sk-line-full" />
          <div className="sk-block sk-line-md" />
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 2: Update `SingleMode` to render skeleton**

Inside `SingleMode`, find this block:

```tsx
  return (
    <section className="mode-stack">
      <form className="command-bar" onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onAnalyze(ticker.trim().toUpperCase() || "AVGO");
      }}>
        <label htmlFor="single-ticker">Ticker</label>
        <input id="single-ticker" value={ticker} onChange={(event) => setTicker(event.target.value)} autoComplete="off" />
        <button type="submit">Analyze</button>
      </form>
      {data.status === "loading" ? <section className="panel muted-panel">{data.message}</section> : null}
      {data.status === "error" ? <section className="panel error-panel">{data.message}</section> : null}
      {data.data ? (
        <TickerDetail
          data={data.data}
          history={history}
          isWatchlisted={isWatchlisted}
          onRefreshLane={onRefreshLane}
          onRevalidate={onRevalidate}
          onToggleWatchlist={onToggleWatchlist}
        />
      ) : null}
    </section>
  );
```

Replace with:

```tsx
  if (data.status === "loading") {
    return (
      <>
        <form className="command-bar" onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onAnalyze(ticker.trim().toUpperCase() || "AVGO");
        }}>
          <label htmlFor="single-ticker">Ticker</label>
          <input id="single-ticker" value={ticker} onChange={(event) => setTicker(event.target.value)} autoComplete="off" />
          <button type="submit">Analyze</button>
        </form>
        <SingleSkeleton />
      </>
    );
  }

  return (
    <section className="mode-stack">
      <form className="command-bar" onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onAnalyze(ticker.trim().toUpperCase() || "AVGO");
      }}>
        <label htmlFor="single-ticker">Ticker</label>
        <input id="single-ticker" value={ticker} onChange={(event) => setTicker(event.target.value)} autoComplete="off" />
        <button type="submit">Analyze</button>
      </form>
      {data.status === "error" ? <section className="panel error-panel">{data.message}</section> : null}
      {data.data ? (
        <TickerDetail
          data={data.data}
          history={history}
          isWatchlisted={isWatchlisted}
          onRefreshLane={onRefreshLane}
          onRevalidate={onRevalidate}
          onToggleWatchlist={onToggleWatchlist}
        />
      ) : null}
    </section>
  );
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npm run build:uta
```

Expected: `✓ built in Xs` with no errors.

- [ ] **Step 4: Deploy to Pi and verify skeleton renders**

On Pi:
```bash
cd ~/flow_momentum_transition-08062026 && git pull && sudo fuser -k 3000/tcp && npm start
```

Click Analyze on AVGO — should see animated gray skeleton blocks instead of "Loading AVGO from live providers..." text.

- [ ] **Step 5: Commit**

```bash
git add src/uta/src/modes.tsx
git commit -m "feat(ux): replace loading text with skeleton layout in SingleMode"
```

---

## Task 3: Auto-Refresh State + Timer in App

**Files:**
- Modify: `src/uta/src/app.tsx`

- [ ] **Step 1: Add `autoRefreshInterval` state**

Inside `export function App()`, after the `showRuntime` state line:

```tsx
const [showRuntime, setShowRuntime] = React.useState(false);
```

Add:

```tsx
const [autoRefreshInterval, setAutoRefreshInterval] = React.useState<0 | 3 | 5 | 10>(() => {
  const stored = Number(localStorage.getItem("uta_autorefresh_v1"));
  return ([0, 3, 5, 10] as const).includes(stored as 0 | 3 | 5 | 10) ? (stored as 0 | 3 | 5 | 10) : 5;
});
const [showSettingsPop, setShowSettingsPop] = React.useState(false);
```

- [ ] **Step 2: Persist `autoRefreshInterval` to localStorage**

After the existing `useEffect` for density (around line 256):

```tsx
React.useEffect(() => {
  localStorage.setItem("uta_autorefresh_v1", String(autoRefreshInterval));
}, [autoRefreshInterval]);
```

- [ ] **Step 3: Add the auto-refresh timer `useEffect`**

After the localStorage persistence effect from Step 2:

```tsx
React.useEffect(() => {
  if (autoRefreshInterval === 0 || mode !== "single") return;
  const ms = autoRefreshInterval * 60 * 1000;
  const id = setInterval(() => {
    loadSingle(activeTicker).catch((err) =>
      setSingle((prev) => ({ status: "error", data: prev.data, message: err.message }))
    );
  }, ms);
  return () => clearInterval(id);
}, [autoRefreshInterval, activeTicker, mode]);
```

- [ ] **Step 4: Build to verify no TypeScript errors**

```bash
npm run build:uta
```

Expected: `✓ built in Xs`. If you see "loadSingle is not defined in useEffect scope", move the `useEffect` to after the `loadSingle` function definition (around line 290 in the original file).

- [ ] **Step 5: Commit**

```bash
git add src/uta/src/app.tsx
git commit -m "feat(ux): add autoRefreshInterval state and timer useEffect"
```

---

## Task 4: Settings Popover in TopBar

**Files:**
- Modify: `src/uta/src/app.tsx`

- [ ] **Step 1: Add new props to `TopBar` signature**

Find the `TopBar` function definition (line 13). Update the props destructuring and type:

```tsx
function TopBar({
  mode, onMode, onHome, onSearch, onOpenWatchlist, onOpenRuntime,
  watchlistCount, alertCount, syncState, syncTime, themeToggle, densityControl,
  autoRefresh, onAutoRefreshChange, showSettingsPop, onToggleSettingsPop
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  onHome: () => void;
  onSearch: (sym: string) => void;
  onOpenWatchlist: () => void;
  onOpenRuntime: () => void;
  watchlistCount: number;
  alertCount: number;
  syncState: "live" | "revalidating" | "error";
  syncTime?: string;
  themeToggle: () => void;
  densityControl: () => void;
  autoRefresh: 0 | 3 | 5 | 10;
  onAutoRefreshChange: (v: 0 | 3 | 5 | 10) => void;
  showSettingsPop: boolean;
  onToggleSettingsPop: () => void;
}) {
```

- [ ] **Step 2: Replace `⚙` button and add settings popover JSX**

Inside `TopBar`'s return, find:

```tsx
        <button className="secondary icon-button" type="button" onClick={onOpenRuntime} title="Operator">⚙</button>
```

Replace with:

```tsx
        <button
          className="secondary icon-button"
          type="button"
          onClick={onToggleSettingsPop}
          title="Settings"
        >⚙</button>
        {showSettingsPop && (
          <div className="settings-pop">
            <div className="settings-pop-row">
              <label htmlFor="auto-refresh-select">Auto-refresh</label>
              <select
                id="auto-refresh-select"
                value={autoRefresh}
                onChange={(e) => onAutoRefreshChange(Number(e.target.value) as 0 | 3 | 5 | 10)}
              >
                <option value={0}>Off</option>
                <option value={3}>3 min</option>
                <option value={5}>5 min</option>
                <option value={10}>10 min</option>
              </select>
            </div>
            <hr className="settings-pop-divider" />
            <div className="settings-pop-row">
              <button
                type="button"
                className="action-btn"
                onClick={() => { onToggleSettingsPop(); onOpenRuntime(); }}
              >
                Operator panel
              </button>
            </div>
          </div>
        )}
```

- [ ] **Step 3: Pass new props to `TopBar` in `App` return**

Find the `<TopBar` usage (around line 488). Add the four new props:

```tsx
      <TopBar
        mode={mode}
        onMode={(m) => setMode(m)}
        onHome={() => setMode("home")}
        onSearch={(sym) => {
          setMode("single");
          loadSingle(sym).catch((err) => setSingle({ status: "error", data: single.data, message: err.message }));
        }}
        onOpenWatchlist={() => setShowWatchlist(true)}
        onOpenRuntime={() => setShowRuntime(true)}
        watchlistCount={watchlistCount}
        alertCount={0}
        syncState="live"
        syncTime={single.data ? fmtDate(single.data.generated_at).split(",")[1]?.trim() : undefined}
        themeToggle={toggleTheme}
        densityControl={() => setShowDensityPop((v) => !v)}
        autoRefresh={autoRefreshInterval}
        onAutoRefreshChange={(v) => { setAutoRefreshInterval(v); setShowSettingsPop(false); }}
        showSettingsPop={showSettingsPop}
        onToggleSettingsPop={() => setShowSettingsPop((v) => !v)}
      />
```

- [ ] **Step 4: Add Escape key handler for settings popover**

Find the existing Escape key `useEffect` (around line 242):

```tsx
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setShowRuntime(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
```

Replace with:

```tsx
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowRuntime(false);
        setShowSettingsPop(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
```

- [ ] **Step 5: Build to verify no TypeScript errors**

```bash
npm run build:uta
```

Expected: `✓ built in Xs` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/uta/src/app.tsx
git commit -m "feat(ux): add settings popover with auto-refresh control to TopBar"
```

---

## Task 5: Final Build, Deploy, and Verify

- [ ] **Step 1: Full build**

```bash
npm run build:uta
```

Expected: `✓ built in Xs`.

- [ ] **Step 2: Push to remote**

```bash
git push origin main
```

- [ ] **Step 3: Deploy to Pi**

```bash
cd ~/flow_momentum_transition-08062026 && git pull && sudo fuser -k 3000/tcp && npm start
```

- [ ] **Step 4: Verify skeleton**

Open the dashboard → Single Ticker → click Analyze on AVGO.
Expected: animated gray skeleton blocks appear for ~3–8 seconds, then real data replaces them. No "Loading AVGO…" text visible.

- [ ] **Step 5: Verify settings popover**

Click the `⚙` button in the top-right nav.
Expected: a small popover with "Auto-refresh" dropdown (Off / 3 min / 5 min / 10 min) and "Operator panel" button. Selecting an interval closes the popover and stores the setting. Press Escape — popover should close.

- [ ] **Step 6: Verify auto-refresh**

Set interval to 3 min. Wait 3 minutes (or temporarily change `autoRefreshInterval * 60 * 1000` to `15 * 1000` in app.tsx, build, test, then revert).
Expected: skeleton appears automatically, then fresh data loads. "BLUF · AS OF [new time]" updates and stale indicator clears.

- [ ] **Step 7: Verify auto-refresh pauses on mode switch**

Set interval to 3 min, switch to Portfolio tab.
Expected: no auto-analysis fires while in Portfolio mode.

- [ ] **Step 8: Verify localStorage persistence**

Set interval to 10 min. Hard-refresh the page (Ctrl+Shift+R).
Expected: popover still shows 10 min after reload.
