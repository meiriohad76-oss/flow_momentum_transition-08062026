// src/uta/src/alerts.tsx
import React, { useState } from "react";
import { fmtDate, ruleMatches } from "./utils.js";
import { Pill, SectionHeader, MetricTile } from "./components.js";
import type { UtaTickerResult, HistoryResult, UserStateResult, UtaRule } from "./types.js";

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
  const feedRows = [
    ...(history?.rows || []).map((row) => ({
      id: row.id || `${row.ticker}-${row.generated_at}`,
      title: `${row.ticker || "UTA"} ${row.tier ? `Tier ${row.tier}` : "cycle"}`,
      detail: `${row.mode || "cycle"} / ${row.direction || "n/a"} / ${fmtDate(row.generated_at || row.created_at)}`,
      source: "cycle"
    })),
    ...(history?.audit_log || []).map((row, index) => ({
      id: String(row.id || `audit-${index}`),
      title: String(row.event || row.type || "Audit event"),
      detail: JSON.stringify(row).slice(0, 120),
      source: "audit"
    }))
  ].slice(0, 10);

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
    <section className="mode-stack">
      <div className="two-column">
        <section className="panel">
          <SectionHeader title="Activity Feed" meta={`${feedRows.length} events`} />
          <div className="compact-list">
            {feedRows.map((row) => (
              <div className="compact-row" key={row.id}>
                <div>
                  <b>{row.title}</b>
                  <span>{row.detail}</span>
                </div>
                <Pill tone={row.source === "cycle" ? "good" : "neutral"}>{row.source}</Pill>
              </div>
            ))}
            {!feedRows.length ? <p className="empty">No UTA activity yet.</p> : null}
          </div>
        </section>
        <section className="panel">
          <SectionHeader title="Live Match Preview" meta={activeData ? activeData.ticker : "no ticker"} />
          <div className="metric-grid">
            <MetricTile label="Ticker" value={activeData?.ticker || "N/A"} />
            <MetricTile label="Tier" value={activeData ? `Tier ${activeData.tier}` : "N/A"} />
            <MetricTile label="Direction" value={activeData?.direction || "N/A"} />
          </div>
          <div className="compact-list preview-list">
            {rules.map((rule) => (
              <div className="compact-row" key={rule.id}>
                <div>
                  <b>{rule.name}</b>
                  <span>Min Tier {rule.min_tier} / {rule.direction}</span>
                </div>
                <Pill tone={ruleMatches(rule, activeData) ? "good" : "neutral"}>
                  {ruleMatches(rule, activeData) ? "match" : "no match"}
                </Pill>
              </div>
            ))}
            {!rules.length ? <p className="empty">No rules configured.</p> : null}
          </div>
          <div className="action-row">
            <button type="button" onClick={onReviewed}>Reviewed</button>
            <button type="button" className="secondary" onClick={onIgnored}>Ignored</button>
          </div>
        </section>
      </div>

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
    </section>
  );
}
