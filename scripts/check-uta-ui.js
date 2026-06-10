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

async function expectNoPageOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    return root.scrollWidth > root.clientWidth + 2;
  });
  assert(!overflow, `UTA shell has unintended horizontal overflow at ${label}.`);
}

async function collectConsole(page, consoleIssues) {
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      if (/server responded with a status of (409|502)/i.test(message.text())) {
        return;
      }
      consoleIssues.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleIssues.push(`pageerror: ${error.message}`));
}

async function runResponsiveLoad(browser, baseUrl, viewport) {
  const consoleIssues = [];
  const page = await browser.newPage({ viewport });
  await collectConsole(page, consoleIssues);
  await page.goto(`${baseUrl}/uta`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tier-ring, .error-panel", { timeout: 15000 });
  const text = await page.locator("body").innerText();
  const hasDetail = (await page.locator(".tier-ring").count()) > 0;

  assert(text.includes("Unusual Trading Activity Agent"), "UTA shell title missing.", { viewport });
  assert(!/Replay fixture|Replay-backed|replay-first|replay analysis/i.test(text), "UTA shell exposed replay runtime copy.", { viewport, text });
  if (hasDetail) {
    assert(text.includes("AVGO"), "UTA shell did not render requested ticker.", { viewport });
    assert(text.toLowerCase().includes("a - universe percentile"), "UTA shell did not render A indicator.", { viewport });
    assert(text.includes("N/A"), "Single mode did not render A as N/A.", { viewport });
    assert(text.includes("Direction source: signed_flow"), "UTA shell did not disclose signed-flow direction source.", { viewport });
    assert(text.includes("Raw Prints"), "Raw prints surface missing.", { viewport });
    assert(text.includes("Explain Tier"), "Explain tier surface missing.", { viewport });
  } else {
    assert(/live|provider|unavailable/i.test(text), "UTA shell should show explicit live provider unavailable state.", { viewport, text });
  }
  await expectNoPageOverflow(page, `${viewport.width}x${viewport.height}`);

  assert(consoleIssues.length === 0, "UTA UI emitted console issues during responsive load.", { viewport, consoleIssues });
  await page.close();
}

async function runWorkflow(browser, baseUrl) {
  const consoleIssues = [];
  const page = await browser.newPage({ viewport: { width: 1510, height: 900 } });
  await collectConsole(page, consoleIssues);
  await page.goto(`${baseUrl}/uta`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tier-ring, .error-panel", { timeout: 15000 });

  await page.getByRole("button", { name: "Portfolio" }).click();
  await page.waitForSelector("text=Portfolio Rank", { timeout: 10000 });
  let text = await page.locator("body").innerText();
  assert(text.includes("Portfolio Rank"), "Portfolio mode did not render rank table.");
  assert(/relative to your portfolio|relative to this live sample/i.test(text), "Portfolio A scope copy missing.");

  await page.getByRole("button", { name: "Scan" }).click();
  await page.getByRole("button", { name: "Pass 1" }).click();
  await page.waitForSelector("text=preliminary", { timeout: 10000 });
  text = await page.locator("body").innerText();
  assert(text.includes("Scan Pass 1"), "Scan pass 1 panel missing.");
  assert(text.includes("preliminary"), "Scan preliminary label missing.");

  await page.getByRole("button", { name: "Pass 2" }).click();
  await page.waitForSelector("text=resolved", { timeout: 10000 });
  text = await page.locator("body").innerText();
  assert(text.includes("Scan Pass 2"), "Scan pass 2 panel missing.");
  assert(text.includes("resolved"), "Scan resolved label missing.");

  await page.getByRole("button", { name: "Alerts" }).click();
  await page.waitForSelector("text=Rule Editor", { timeout: 10000 });
  text = await page.locator("body").innerText();
  assert(text.includes("Activity Feed"), "Alerts activity feed missing.");
  assert(text.includes("Live Match Preview"), "Alerts live match preview missing.");
  assert(text.includes("Tier A bullish flow"), "Default UTA rule missing.");
  await page.getByRole("button", { name: "Add Rule" }).click();
  await page.waitForSelector("text=Tier B or better bullish", { timeout: 10000 });
  await page.getByRole("button", { name: "Reviewed" }).click();
  await page.getByRole("button", { name: "Ignored" }).click();
  text = await page.locator("body").innerText();
  assert(text.includes("user rule"), "User-created rule did not render.");

  await page.getByRole("button", { name: "Runtime" }).click();
  await page.waitForSelector("text=Scheduler", { timeout: 10000 });
  text = await page.locator("body").innerText();
  assert(text.includes("manual/dry-run"), "Scheduler dry-run/manual policy missing.");
  assert(text.includes("Pi heavy auto-start off"), "Pi runtime policy missing.");
  assert(text.includes("SSE"), "SSE runtime surface missing.");
  assert(!/Replay fixture|Replay-backed|replay-first|replay analysis/i.test(text), "Runtime exposed replay copy.");

  await expectNoPageOverflow(page, "workflow desktop");
  assert(consoleIssues.length === 0, "UTA UI emitted console issues during workflow.", { consoleIssues });
  await page.close();
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
  const viewports = [
    { width: 1510, height: 900 },
    { width: 1024, height: 900 },
    { width: 390, height: 840 }
  ];

  for (const viewport of viewports) {
    await runResponsiveLoad(browser, baseUrl, viewport);
  }
  await runWorkflow(browser, baseUrl);

  console.log(JSON.stringify({
    status: "ok",
    base_url: baseUrl,
    console_issues: 0,
    viewports: viewports.map((viewport) => `${viewport.width}x${viewport.height}`),
    workflows: ["single", "portfolio", "scan_pass1", "scan_pass2", "alerts_rules", "runtime"]
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "error", error: error.message, details: error.details || {} }, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await close(server);
  await app.stopLiveSources?.();
}
