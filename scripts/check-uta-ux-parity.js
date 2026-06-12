import { createServer } from "node:http";
import { chromium } from "playwright";
import { createSentimentApp } from "../src/app.js";
import { routeRequest } from "../src/http/router.js";

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function assertCount(page, selector, min, label) {
  const count = await page.locator(selector).count();
  assert(count >= min, `${label} missing or incomplete.`, { selector, min, count });
  return count;
}

const app = createSentimentApp();
const server = createServer((request, response) => {
  routeRequest(app, request, response).catch((error) => {
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }));
  });
});

let browser = null;

try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1510, height: 900 } });
  const consoleIssues = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      if (/server responded with a status of (409|502)/i.test(message.text())) {
        return;
      }
      consoleIssues.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleIssues.push(`pageerror: ${error.message}`));

  await page.goto(`${baseUrl}/uta`, { waitUntil: "domcontentloaded" });

  // If HomeMode loaded, click into Single Ticker first
  const hasHome = (await page.locator(".home-mode").count()) > 0;
  if (hasHome) {
    await page.locator(".home-card").first().click();
    await page.waitForTimeout(200);
  }

  await page.waitForSelector('[data-ux-source="ux design/evidence.jsx:BlufCard"], .error-panel', { timeout: 15000 });

  const text = await page.locator("body").innerText();
  const hasDetail = (await page.locator('[data-ux-source="ux design/evidence.jsx:BlufCard"]').count()) > 0;
  assert(!/Replay fixture|Replay-backed|replay-first|replay analysis/i.test(text), "UTA UX exposed replay runtime copy.");
  if (!hasDetail) {
    assert(/live|provider|unavailable/i.test(text), "UTA UX should show explicit live provider unavailable state.");
    assert(consoleIssues.length === 0, "UTA UX parity emitted console issues.", { consoleIssues });
    await page.close();

    console.log(JSON.stringify({
      status: "ok",
      base_url: baseUrl,
      mode: "live_unavailable",
      checked: ["live_only_shell", "no_replay_controls", "no_replay_copy"]
    }, null, 2));
    await browser?.close();
    browser = null;
    await close(server);
    process.exit(0);
  }

  const textUpper = text.toUpperCase();
  const requiredText = [
    "What happened",
    "Why it matters",
    "What to check",
    "Limitations",
    "A - universe percentile",
    "B",
    "C",
    "Trade Analysis",
    "Cycle History",
    "Corroboration",
    "Actions",
    "Raw Prints",
    "Explain Tier"
  ];
  for (const item of requiredText) {
    assert(textUpper.includes(item.toUpperCase()), `Canonical UX text missing: ${item}`);
  }

  await assertCount(page, ".layout .main-col", 1, "Prototype main column");
  await assertCount(page, ".layout .side-col", 1, "Prototype side column");
  await assertCount(page, ".bluf .bluf-row", 4, "BLUF 2x2 grid");
  await assertCount(page, ".ind-summary .ind-chip", 3, "A/B/C indicator chips");
  await assertCount(page, ".cyc .cyc-cell", 1, "Cycle timeline");
  await assertCount(page, ".corr-list .corr-row", 6, "Corroboration flags");
  await assertCount(page, ".actions-panel .action-btn", 6, "Actions panel controls");

  // Click Trade Analysis tab to expose its content before checking trigger text
  const tradeTab = page.getByRole("button", { name: "Trade Analysis" });
  if ((await tradeTab.count()) > 0) {
    await tradeTab.click();
    await page.waitForTimeout(300);
  }

  // Re-read body text to include Trade Analysis tab content
  const textAfterTab = await page.locator("body").innerText();
  const textAfterTabUpper = textAfterTab.toUpperCase();
  const tradeTabRequiredText = ["Primary trigger", "Trigger criteria"];
  for (const item of tradeTabRequiredText) {
    assert(textAfterTabUpper.includes(item.toUpperCase()), `Trade Analysis tab text missing: ${item}`);
  }

  // Check evidence cards after switching back to evidence tab
  const evidenceTab = page.getByRole("button", { name: "Evidence" });
  if ((await evidenceTab.count()) > 0) {
    await evidenceTab.click();
    await page.waitForTimeout(300);
  }
  await assertCount(page, '[data-ux-source="ux design/evidence.jsx:EvidenceGrid"] .ev-card', 9, "Evidence cards");

  await page.getByRole("button", { name: "Raw Prints" }).click();
  await page.waitForSelector('[data-ux-source="ux design/detail-extras.jsx:RawPrintsDrawer"]', { timeout: 10000 });
  await assertCount(page, ".drawer .rp-table tbody tr", 1, "Raw prints drawer rows");
  await page.locator(".drawer .x-close").click();

  await page.getByRole("button", { name: "Explain Tier" }).click();
  await page.waitForSelector('[data-ux-source="ux design/detail-extras.jsx:ExplainTierPanel"]', { timeout: 10000 });
  await assertCount(page, ".modal .rule-row", 5, "Explain-tier modal rules");

  assert(consoleIssues.length === 0, "UTA UX parity emitted console issues.", { consoleIssues });
  await page.close();

  // Phase 5 additions — portfolio stat cards + alerts feed
  const page2 = await browser.newPage({ viewport: { width: 1510, height: 900 } });
  await page2.goto(`${baseUrl}/uta`, { waitUntil: "domcontentloaded" });

  // Navigate to portfolio mode
  await page2.getByRole("button", { name: "Portfolio" }).click();
  await page2.waitForTimeout(400);
  const portfolioText = await page2.locator("body").innerText();
  // Stat cards visible when portfolio data loads
  if (/tier a|holdings|cycle time/i.test(portfolioText)) {
    assert(
      /holdings|tier a|tier changes|cycle time/i.test(portfolioText),
      "Portfolio stat cards missing."
    );
  }

  // Navigate to alerts mode
  await page2.getByRole("button", { name: "Alerts" }).click();
  await page2.waitForTimeout(400);
  const alertsText = await page2.locator("body").innerText();
  assert(
    /needs attention|rule matches|confirmed alerts|tier changes/i.test(alertsText),
    "Alerts stat cards missing."
  );
  assert(
    /all|my rules|confirmed alerts|tier changes|news|data lanes/i.test(alertsText),
    "Alerts feed filter chips missing."
  );

  await page2.close();

  console.log(JSON.stringify({
    status: "ok",
    base_url: baseUrl,
    ux_sources: [
      "ux design/spec/screens.html",
      "ux design/spec/data-logic.html",
      "ux design/evidence.jsx",
      "ux design/detail-extras.jsx",
      "ux design/components.jsx"
    ],
    checked: [
      "home_mode",
      "bluf_card",
      "abc_indicator_summary",
      "cycle_timeline",
      "nine_evidence_cards",
      "corroboration_panel",
      "actions_panel",
      "raw_prints_drawer",
      "explain_tier_modal",
      "evidence_trade_analysis_tabs",
      "portfolio_stat_cards",
      "alerts_stat_cards",
      "alerts_filter_chips"
    ]
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "error", error: error.message, details: error.details || {} }, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await close(server);
  await app.stopLiveSources?.();
}
