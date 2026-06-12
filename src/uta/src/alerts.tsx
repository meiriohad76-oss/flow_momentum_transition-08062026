// src/uta/src/alerts.tsx
import React, { useMemo, useState } from "react";
import { fmtDate, ruleMatches, tierRank } from "./utils.js";
import { Pill, SectionHeader, MetricTile, TierBadge, DirTag } from "./components.js";
import type { UtaTickerResult, HistoryResult, UserStateResult, UtaRule } from "./types.js";

function AlertsStatCards({
  needsAttention,
  ruleMatches: ruleMatchCount,
  confirmedAlerts,
  tierChanges
}: {
  needsAttention: number;
  ruleMatches: number;
  confirmedAlerts: number;
  tierChanges: number;
}) {
  return (
    <div className="port-stat-cards">
      <div className={`port-stat-card ${needsAttention > 0 ? "psc-accent" : ""}`}>
        <span className="psc-label">Needs attention</span>
        <strong className="psc-value">{needsAttention}</strong>
        <span className="psc-detail">Tier A or rule-matched</span>
      </div>
      <div className="port-stat-card">
        <span className="psc-label">Rule matches</span>
        <strong className="psc-value">{ruleMatchCount}</strong>
        <span className="psc-detail">active rules fired</span>
      </div>
      <div className="port-stat-card">
        <span className="psc-label">Confirmed alerts</span>
        <strong className="psc-value">{confirmedAlerts}</strong>
        <span className="psc-detail">provider-confirmed</span>
      </div>
      <div className={`port-stat-card ${tierChanges > 0 ? "psc-warn" : ""}`}>
        <span className="psc-label">Tier changes</span>
        <strong className="psc-value">{tierChanges}</strong>
        <span className="psc-detail">this cycle</span>
      </div>
    </div>
  );
}

type FeedKind = "alert" | "tierup" | "tierdown" | "news" | "lane" | "rule";

type FeedEvent = {
  id: string;
  kind: FeedKind;
  ticker?: string;
  title: string;
  tier?: string;
  direction?: string;
  ts: string;
};

const KIND_META: Record<FeedKind, { icon: string; colour: string; label: string }> = {
  alert:    { icon: "◆", colour: "var(--accent)",  label: "Confirmed alerts" },
  tierup:   { icon: "▲", colour: "var(--buy)",     label: "Tier changes" },
  tierdown: { icon: "▼", colour: "var(--warn)",    label: "Tier changes" },
  news:     { icon: "◉", colour: "var(--blue)",    label: "News" },
  lane:     { icon: "⚠", colour: "var(--sell)",   label: "Data lanes" },
  rule:     { icon: "◈", colour: "#a07be0",        label: "My rules" }
};

type FeedFilter = "all" | "rules" | "alerts" | "tier" | "news" | "lane";

const FILTER_LABELS: Record<FeedFilter, string> = {
  all:    "All",
  rules:  "My rules",
  alerts: "Confirmed alerts",
  tier:   "Tier changes",
  news:   "News",
  lane:   "Data lanes"
};

function ActivityFeed({
  events,
  filter,
  onFilter
}: {
  events: FeedEvent[];
  filter: FeedFilter;
  onFilter: (f: FeedFilter) => void;
}) {
  const counts: Partial<Record<FeedFilter, number>> = { all: events.length };
  for (const ev of events) {
    if (ev.kind === "alert")    counts.alerts = (counts.alerts || 0) + 1;
    if (ev.kind === "tierup" || ev.kind === "tierdown") counts.tier = (counts.tier || 0) + 1;
    if (ev.kind === "news")     counts.news = (counts.news || 0) + 1;
    if (ev.kind === "lane")     counts.lane = (counts.lane || 0) + 1;
    if (ev.kind === "rule")     counts.rules = (counts.rules || 0) + 1;
  }

  const visible = filter === "all"
    ? events
    : events.filter((ev) => {
        if (filter === "alerts") return ev.kind === "alert";
        if (filter === "tier")   return ev.kind === "tierup" || ev.kind === "tierdown";
        if (filter === "news")   return ev.kind === "news";
        if (filter === "lane")   return ev.kind === "lane";
        if (filter === "rules")  return ev.kind === "rule";
        return true;
      });

  return (
    <div className="activity-feed">
      <div className="feed-filters">
        {(Object.keys(FILTER_LABELS) as FeedFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`feed-filter-chip ${filter === f ? "active" : "secondary"}`}
            onClick={() => onFilter(f)}
          >
            {FILTER_LABELS[f]}
            {counts[f] != null && counts[f]! > 0 && (
              <span className="feed-filter-count">{counts[f]}</span>
            )}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <div className="feed-empty">
          {filter === "rules"
            ? <span>No rule matches. <button type="button" className="secondary" style={{ marginLeft: 8 }}>Create a rule →</button></span>
            : <span>No {FILTER_LABELS[filter].toLowerCase()} this cycle.</span>}
        </div>
      ) : (
        <div className="feed-rows">
          {visible.map((ev) => {
            const meta = KIND_META[ev.kind];
            return (
              <div className="feed-row" key={ev.id}>
                <span className="feed-icon" style={{ color: meta.colour }}>{meta.icon}</span>
                <div className="feed-body">
                  <div className="feed-title">
                    {ev.ticker && <span className="feed-sym mono">{ev.ticker}</span>}
                    {ev.title}
                  </div>
                  <div className="feed-meta">
                    <span className="feed-ts">{fmtDate(ev.ts)}</span>
                    {ev.tier && <TierBadge tier={ev.tier} size="sm" />}
                    {ev.direction && <DirTag direction={ev.direction} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type RuleEditorState = {
  name: string;
  scope: "all" | "portfolio" | "watchlist";
  direction: "bullish" | "bearish" | "any";
  min_tier: "A" | "B" | "C";
  min_b_score: number;
  min_a_rank: number;
  min_c_ratio: number;
  require_provider_alert: boolean;
};

function RuleEditor({
  initial,
  onSave,
  onCancel,
  liveResults
}: {
  initial?: Partial<RuleEditorState>;
  onSave: (rule: RuleEditorState) => void;
  onCancel: () => void;
  liveResults: UtaTickerResult[];
}) {
  const [state, setState] = useState<RuleEditorState>({
    name: "",
    scope: "all",
    direction: "any",
    min_tier: "B",
    min_b_score: 1.5,
    min_a_rank: 50,
    min_c_ratio: 1.5,
    require_provider_alert: false,
    ...initial
  });

  function update<K extends keyof RuleEditorState>(key: K, value: RuleEditorState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  // Live match preview
  const matchCount = liveResults.filter((r) => {
    if (r.tier === "D") return false;
    if (tierRank(r.tier) < tierRank(state.min_tier)) return false;
    if (state.direction !== "any" && r.direction !== state.direction) return false;
    if (Number(r.indicators.B.notional_zscore ?? 0) < state.min_b_score) return false;
    if (Number(r.indicators.C.notional_ratio ?? 0) < state.min_c_ratio) return false;
    if (state.require_provider_alert && !r.trade_analysis?.corroboration?.provider_alert_confirmed) return false;
    return true;
  }).length;

  return (
    <div className="rule-editor">
      <div className="rule-ed-field">
        <label className="rule-ed-label">Rule name</label>
        <input
          type="text"
          value={state.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="e.g. Tier B bullish with provider alert"
        />
      </div>
      <div className="rule-ed-field">
        <label className="rule-ed-label">Scope</label>
        <div className="dir-seg">
          {(["all", "portfolio", "watchlist"] as const).map((s) => (
            <button key={s} type="button" className={`dir-seg-btn ${state.scope === s ? "active" : "secondary"}`}
              onClick={() => update("scope", s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="rule-ed-field">
        <label className="rule-ed-label">Direction</label>
        <div className="dir-seg">
          {(["bullish", "bearish", "any"] as const).map((d) => (
            <button key={d} type="button" className={`dir-seg-btn ${state.direction === d ? "active" : "secondary"}`}
              onClick={() => update("direction", d)}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="rule-ed-field">
        <label className="rule-ed-label">Min tier</label>
        <div className="dir-seg">
          {(["A", "B", "C"] as const).map((t) => (
            <button key={t} type="button" className={`dir-seg-btn ${state.min_tier === t ? "active" : "secondary"}`}
              onClick={() => update("min_tier", t)}>
              Tier {t}
            </button>
          ))}
        </div>
      </div>
      <div className="rule-ed-field">
        <label className="rule-ed-label">
          Min B-score (σ) — <strong>{state.min_b_score.toFixed(1)}σ</strong>
        </label>
        <input
          type="range" min={0} max={4} step={0.1}
          value={state.min_b_score}
          onChange={(e) => update("min_b_score", Number(e.target.value))}
          className="rule-slider"
        />
        <div className="rule-slider-ticks"><span>0σ</span><span>2σ</span><span>4σ</span></div>
      </div>
      <div className="rule-ed-field">
        <label className="rule-ed-label">
          Min A rank (percentile) — <strong>{state.min_a_rank}th</strong>
        </label>
        <input
          type="range" min={0} max={100} step={5}
          value={state.min_a_rank}
          onChange={(e) => update("min_a_rank", Number(e.target.value))}
          className="rule-slider"
        />
        <div className="rule-slider-ticks"><span>0</span><span>50th</span><span>100th</span></div>
      </div>
      <div className="rule-ed-field">
        <label className="rule-ed-label">
          Min notional ratio (×) — <strong>{state.min_c_ratio.toFixed(1)}×</strong>
        </label>
        <input
          type="range" min={1} max={10} step={0.25}
          value={state.min_c_ratio}
          onChange={(e) => update("min_c_ratio", Number(e.target.value))}
          className="rule-slider"
        />
        <div className="rule-slider-ticks"><span>1×</span><span>5×</span><span>10×</span></div>
      </div>
      <div className="rule-ed-field rule-ed-toggle">
        <label className="rule-ed-label">
          <input
            type="checkbox"
            checked={state.require_provider_alert}
            onChange={(e) => update("require_provider_alert", e.target.checked)}
          />
          Provider alert required
        </label>
      </div>
      <div className="rule-match-preview">
        Matches <strong>{matchCount}</strong> ticker{matchCount !== 1 ? "s" : ""} right now
      </div>
      <div className="rule-ed-actions">
        <button type="button" onClick={() => onSave(state)} disabled={!state.name.trim()}>
          Save rule
        </button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function RulesDrawer({
  rules,
  onClose,
  onSaveRule,
  onToggleRule,
  onDeleteRule,
  liveResults
}: {
  rules: UtaRule[];
  onClose: () => void;
  onSaveRule: (rule: UtaRule) => void;
  onToggleRule: (id: string, enabled: boolean) => void;
  onDeleteRule: (id: string) => void;
  liveResults: UtaTickerResult[];
}) {
  const [editing, setEditing] = useState<string | null>(null); // null = list, "new" = new rule

  function handleSave(state: RuleEditorState) {
    const rule: UtaRule = {
      id: editing === "new" ? `rule_${Date.now()}` : editing!,
      name: state.name,
      enabled: true,
      min_tier: state.min_tier,
      direction: state.direction,
      source: "user"
    };
    onSaveRule(rule);
    setEditing(null);
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer rules-drawer">
        <div className="drawer-head">
          <span className="dt">Alert Rules</span>
          <span className="ds">{rules.length} active</span>
          <button className="x-close icon-button secondary" type="button" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          {editing !== null ? (
            <RuleEditor
              initial={editing === "new" ? undefined : { name: rules.find((r) => r.id === editing)?.name }}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
              liveResults={liveResults}
            />
          ) : (
            <>
              <button type="button" onClick={() => setEditing("new")} style={{ marginBottom: 16 }}>
                + New rule
              </button>
              <div className="rule-list">
                {rules.length === 0 && (
                  <p className="empty">No rules yet. Create one to get notified about signals that match your criteria.</p>
                )}
                {rules.map((rule) => {
                  const matches = liveResults.filter((r) => ruleMatches(rule, r)).length;
                  return (
                    <div className="rule-card" key={rule.id}>
                      <div className="rule-card-head">
                        <label className="rule-toggle">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={(e) => onToggleRule(rule.id, e.target.checked)}
                          />
                          <span className="rule-name">{rule.name}</span>
                        </label>
                        <span className={`pill ${matches > 0 ? "good" : "neutral"}`}>
                          {matches} match{matches !== 1 ? "es" : ""}
                        </span>
                        <button type="button" className="secondary icon-button" onClick={() => setEditing(rule.id)}>✎</button>
                        <button type="button" className="secondary icon-button" onClick={() => onDeleteRule(rule.id)}>×</button>
                      </div>
                      <div className="rule-chips">
                        <span className="pill neutral">Tier {rule.min_tier}+</span>
                        <span className="pill neutral">{rule.direction}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export function AlertsMode({
  userState,
  history,
  activeData,
  onRulesChange,
  onReviewed,
  onIgnored
}: {
  userState: UserStateResult | null;
  history: HistoryResult | null;
  activeData?: UtaTickerResult;
  onRulesChange: (rules: UtaRule[]) => void;
  onReviewed: () => void;
  onIgnored: () => void;
}) {
  const rules = userState?.state.rules || [];
  const [draft, setDraft] = useState({
    name: "Tier B or better bullish",
    min_tier: "B",
    direction: "bullish"
  });
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
  const [showRulesDrawer, setShowRulesDrawer] = useState(false);

  // Build typed events from history rows
  const feedEvents = useMemo((): FeedEvent[] => {
    const rows = history?.rows || [];
    return rows.map((row, i) => {
      const kind: FeedKind = row.tier === "A" ? "tierup" : "tierdown";
      return {
        id: row.id || String(i),
        kind,
        ticker: row.ticker,
        title: `Tier ${row.tier || "D"} · ${row.direction || "undetermined"}`,
        tier: row.tier,
        direction: row.direction,
        ts: row.generated_at || row.created_at || new Date().toISOString()
      };
    });
  }, [history]);

  const needsAttention = feedEvents.filter((e) => e.tier === "A" || e.tier === "B").length;
  const ruleMatchCount = rules.filter((rule) => ruleMatches(rule, activeData)).length;
  const confirmedAlerts = feedEvents.filter((e) => e.kind === "alert").length;
  const tierChanges = feedEvents.filter((e) => e.kind === "tierup" || e.kind === "tierdown").length;

  function addRule() {
    const nextRule: UtaRule = {
      id: `user-rule-${Date.now()}`,
      name: draft.name.trim() || "Untitled UTA rule",
      enabled: true,
      min_tier: draft.min_tier,
      direction: draft.direction,
      source: "user"
    };
    onRulesChange([...rules, nextRule]);
  }

  function toggleRule(rule: UtaRule) {
    onRulesChange(rules.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item));
  }

  function deleteRule(rule: UtaRule) {
    onRulesChange(rules.filter((item) => item.id !== rule.id));
  }

  return (
    <div className="mode-stack">
      <AlertsStatCards
        needsAttention={needsAttention}
        ruleMatches={ruleMatchCount}
        confirmedAlerts={confirmedAlerts}
        tierChanges={tierChanges}
      />
      <ActivityFeed
        events={feedEvents}
        filter={feedFilter}
        onFilter={setFeedFilter}
      />
      <button type="button" className="secondary" onClick={() => setShowRulesDrawer(true)}>
        Rules {rules.length > 0 ? `(${rules.length})` : ""}
      </button>
      {showRulesDrawer && (
        <RulesDrawer
          rules={userState?.state.rules || []}
          onClose={() => setShowRulesDrawer(false)}
          onSaveRule={(rule) => {
            const current = userState?.state.rules || [];
            const next = current.some((r) => r.id === rule.id)
              ? current.map((r) => r.id === rule.id ? rule : r)
              : [...current, rule];
            onRulesChange(next);
          }}
          onToggleRule={(id, enabled) => {
            const next = (userState?.state.rules || []).map((r) =>
              r.id === id ? { ...r, enabled } : r
            );
            onRulesChange(next);
          }}
          onDeleteRule={(id) => {
            onRulesChange((userState?.state.rules || []).filter((r) => r.id !== id));
          }}
          liveResults={activeData ? [activeData] : []}
        />
      )}

      <section className="panel">
        <SectionHeader title="Rule Editor" meta="user rules only" />
        <div className="command-bar inline-editor">
          <label htmlFor="rule-name">Name</label>
          <input
            id="rule-name"
            className="wide-input"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <label htmlFor="rule-tier">Min tier</label>
          <select id="rule-tier" value={draft.min_tier} onChange={(event) => setDraft({ ...draft, min_tier: event.target.value })}>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
          <label htmlFor="rule-direction">Direction</label>
          <select id="rule-direction" value={draft.direction} onChange={(event) => setDraft({ ...draft, direction: event.target.value })}>
            <option value="bullish">Bullish</option>
            <option value="bearish">Bearish</option>
            <option value="any">Any</option>
          </select>
          <button type="button" onClick={addRule}>Add Rule</button>
        </div>
        <div className="rule-table">
          {rules.map((rule) => (
            <div className="rule-row" key={rule.id}>
              <div>
                <b>{rule.name}</b>
                <span>{rule.source === "default" ? "default rule" : "user rule"} / min Tier {rule.min_tier} / {rule.direction}</span>
              </div>
              <div className="action-row">
                <Pill tone={rule.enabled ? "good" : "neutral"}>{rule.enabled ? "enabled" : "disabled"}</Pill>
                <button type="button" className="secondary" onClick={() => toggleRule(rule)}>
                  {rule.enabled ? "Disable" : "Enable"}
                </button>
                {rule.source === "default" ? null : (
                  <button type="button" className="secondary" onClick={() => deleteRule(rule)}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
