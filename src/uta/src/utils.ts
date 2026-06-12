// src/uta/src/utils.ts
import type { UtaTickerResult, UtaRule } from "./types.js";

export const LIVE_SOURCE_MODE = "live";
export const DEFAULT_PORTFOLIO = ["AVGO", "NVDA", "MSFT"];
export const SAFE_TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,15}$/;

export function fmtMoney(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${Math.round(n / 1_000_000).toLocaleString()}M`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function fmtPct(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${Math.round(n * 100)}%`;
}

export function fmtNumber(value: unknown, digits = 1): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return n.toFixed(digits);
}

export function fmtDate(value?: string | null): string {
  if (!value) return "N/A";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function tickerList(value: string): string[] {
  return value.split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 25);
}

export function tierRank(tier?: string): number {
  return { A: 4, B: 3, C: 2, D: 1 }[String(tier || "D").toUpperCase() as "A" | "B" | "C" | "D"] || 0;
}

export function setupTone(status?: string): string {
  if (status === "review_candidate") return "good";
  if (status === "watch_only") return "warn";
  if (status === "blocked") return "bad";
  if (status === "no_directional_setup") return "neutral";
  return "neutral";
}

export function setupLabel(status?: string): string {
  return String(status || "resolved").replaceAll("_", " ");
}

export function ruleMatches(rule: UtaRule, result?: UtaTickerResult | null): boolean {
  if (!rule.enabled || !result) return false;
  if (result.tier === "D") return false;
  return tierRank(result.tier) >= tierRank(rule.min_tier || "A") &&
    (rule.direction === "any" || rule.direction === result.direction);
}

export function invariantWarnings(data: UtaTickerResult): string[] {
  const w: string[] = [];
  if (data.mode === "single_ticker" && data.indicators.A !== null) w.push("Single ticker mode must render A as N/A.");
  if (data.tier !== "D" && data.calculation_metadata.direction_source !== "signed_flow") w.push("Direction source is not signed_flow.");
  if (Object.prototype.hasOwnProperty.call(data, "composite_score")) w.push("Composite score detected.");
  if (data.calculation_metadata.price_is_corroboration_only !== true) w.push("Price corroboration policy missing.");
  return w;
}

export async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
  return payload;
}

export async function apiGet<T>(url: string): Promise<T> {
  return readJson<T>(await fetch(url, { headers: { accept: "application/json" } }));
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  return readJson<T>(await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body)
  }));
}
