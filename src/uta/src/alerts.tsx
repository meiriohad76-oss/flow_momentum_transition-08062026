// src/uta/src/alerts.tsx
import React, { useMemo, useState } from "react";
import { fmtDate, ruleMatches } from "./utils.js";
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
