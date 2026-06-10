import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "node:url";
import { parseJsonBody, sendJson, sendText } from "../utils/helpers.js";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function sseWrite(response, event) {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function serveStaticFile(publicDir, response, pathname) {
  const requested =
    pathname === "/"
      ? "index.html"
      : pathname === "/uta" || pathname === "/uta/" || (pathname.startsWith("/uta/") && !path.extname(pathname))
        ? "uta/index.html"
        : pathname.replace(/^\/+/, "");
  const filePath = path.join(publicDir, requested);

  try {
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) {
      sendText(response, 404, "Not Found");
      return;
    }

    const extension = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not Found");
  }
}

export async function routeRequest(app, request, response) {
  const { pathname, query } = parse(request.url, true);

  if (pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, app.getHealth());
    return;
  }

  if (pathname === "/api/ready" && request.method === "GET") {
    const readiness = app.getReadiness();
    sendJson(response, readiness.ready ? 200 : 503, readiness);
    return;
  }

  if (pathname === "/api/performance" && request.method === "GET") {
    sendJson(response, 200, app.getPerformance());
    return;
  }

  if (pathname === "/api/runtime-reliability" && request.method === "GET") {
    sendJson(response, 200, app.getRuntimeReliability());
    return;
  }

  if (pathname === "/api/system/doctor" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getSystemDoctor({
        window: query.window || app.config.defaultWindow,
        limit: query.limit ? Number(query.limit) : 25,
        minConviction: query.minConviction !== undefined ? Number(query.minConviction) : undefined
      }));
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/runtime-reliability/actions" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        const result = await app.runRuntimeReliabilityAction(payload);
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/config" && request.method === "GET") {
    sendJson(response, 200, app.getConfig());
    return;
  }

  if (pathname === "/api/uta/single" && request.method === "GET") {
    const result = await app.runUtaCycle({ mode: "single", ticker: query.ticker || "", query, reason: "api_single" });
    sendJson(response, result.status, { ...result.payload, runtime_cycle: result.cycle });
    return;
  }

  if (pathname === "/api/uta/portfolio" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", async () => {
      const payload = parseJsonBody(body) || {};
      const result = await app.runUtaCycle({ mode: "portfolio", tickers: payload.tickers || ["AVGO"], body: payload, reason: "api_portfolio" });
      sendJson(response, result.status, { ...result.payload, runtime_cycle: result.cycle });
    });
    return;
  }

  if (pathname === "/api/uta/scan" && request.method === "GET") {
    const result = await app.runUtaCycle({ mode: "scan_pass1", query, reason: "api_scan_pass1" });
    sendJson(response, result.status, { ...result.payload, runtime_cycle: result.cycle });
    return;
  }

  if (pathname === "/api/uta/scan/pass2" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", async () => {
      const payload = parseJsonBody(body) || {};
      const result = await app.runUtaCycle({ mode: "scan_pass2", tickers: payload.shortlist || ["AVGO"], body: payload, reason: "api_scan_pass2" });
      sendJson(response, result.status, { ...result.payload, runtime_cycle: result.cycle });
    });
    return;
  }

  if (pathname === "/api/uta/universes" && request.method === "GET") {
    sendJson(response, 200, app.getUtaUniverses());
    return;
  }

  if (pathname === "/api/uta/lane-states" && request.method === "GET") {
    sendJson(response, 200, app.getUtaLaneStates());
    return;
  }

  if (pathname === "/api/uta/runtime" && request.method === "GET") {
    sendJson(response, 200, app.getUtaRuntimeStatus());
    return;
  }

  if (pathname === "/api/uta/providers" && request.method === "GET") {
    sendJson(response, 200, app.getUtaProviderStatus());
    return;
  }

  if (pathname === "/api/uta/providers/preflight" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        sendJson(response, 200, await app.runUtaProviderPreflight(payload));
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/uta/history" && request.method === "GET") {
    sendJson(response, 200, app.getUtaHistory({
      ticker: query.ticker || "",
      mode: query.mode || "",
      limit: query.limit ? Number(query.limit) : 50
    }));
    return;
  }

  if (pathname === "/api/uta/scheduler" && request.method === "GET") {
    sendJson(response, 200, app.getUtaScheduler());
    return;
  }

  if (pathname === "/api/uta/scheduler" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = parseJsonBody(body) || {};
      sendJson(response, 200, app.updateUtaScheduler(payload));
    });
    return;
  }

  if (pathname === "/api/uta/revalidate" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", async () => {
      const payload = parseJsonBody(body) || {};
      const result = await app.revalidateUta(payload);
      sendJson(response, result.status, { ...result.payload, runtime_cycle: result.cycle });
    });
    return;
  }

  if (pathname?.startsWith("/api/uta/lanes/") && pathname?.endsWith("/refresh") && request.method === "POST") {
    const laneId = decodeURIComponent(pathname.slice("/api/uta/lanes/".length, -"/refresh".length));
    const result = app.refreshUtaLane(laneId);
    sendJson(response, result.status, result.payload);
    return;
  }

  if (pathname?.startsWith("/api/uta/user-state") && request.method === "GET") {
    const scope = pathname === "/api/uta/user-state" ? "" : decodeURIComponent(pathname.slice("/api/uta/user-state/".length));
    sendJson(response, 200, app.getUtaUserState(scope));
    return;
  }

  if (pathname?.startsWith("/api/uta/user-state") && request.method === "POST") {
    const scope = pathname === "/api/uta/user-state" ? "" : decodeURIComponent(pathname.slice("/api/uta/user-state/".length));
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = parseJsonBody(body) || {};
      sendJson(response, 200, app.updateUtaUserState(scope, payload));
    });
    return;
  }

  if (pathname === "/api/uta/stream" && request.method === "GET") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });

    response.write(": uta connected\n\n");
    sseWrite(response, {
      type: "uta_snapshot",
      runtime: app.getUtaRuntimeStatus(),
      lane_states: app.getUtaLaneStates()
    });

    const listener = (event) => {
      if (String(event.type || "").startsWith("uta_")) {
        sseWrite(response, event);
      }
    };
    app.store.bus.on("event", listener);
    request.on("close", () => {
      app.store.bus.off("event", listener);
    });
    return;
  }

  if (pathname === "/api/settings/market-flow" && request.method === "GET") {
    sendJson(response, 200, app.getMarketFlowSettings());
    return;
  }

  if (pathname === "/api/settings/market-flow" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        const settings = await app.updateMarketFlowSettings(payload, {
          persist: String(payload.persist ?? "true").toLowerCase() !== "false"
        });
        sendJson(response, 200, { ok: true, settings });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/settings/fundamental-screener" && request.method === "GET") {
    sendJson(response, 200, app.getScreenerSettings());
    return;
  }

  if (pathname === "/api/settings/fundamental-screener" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        const screener = await app.updateScreenerSettings(payload, {
          persist: String(payload.persist ?? "true").toLowerCase() !== "false"
        });
        sendJson(response, 200, { ok: true, screener });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/settings/portfolio-policy" && request.method === "GET") {
    sendJson(response, 200, app.getPortfolioPolicySettings());
    return;
  }

  if (pathname === "/api/settings/portfolio-policy" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        const policy = await app.updatePortfolioPolicySettings(payload, {
          persist: String(payload.persist ?? "true").toLowerCase() !== "false"
        });
        sendJson(response, 200, { ok: true, policy });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/fundamentals/dashboard" && request.method === "GET") {
    sendJson(response, 200, app.getFundamentalsSnapshot({
      sector: query.sector || null,
      minConfidence: query.minConfidence ? Number(query.minConfidence) : null,
      search: query.search || "",
      onlyChanged: String(query.onlyChanged || "false").toLowerCase() === "true",
      screenStage: query.screenStage || null
    }));
    return;
  }

  if (pathname === "/api/fundamentals/changes" && request.method === "GET") {
    sendJson(response, 200, app.getFundamentalsChanges(query.limit ? Number(query.limit) : 12));
    return;
  }

  if (pathname === "/api/backtests/fundamentals" && request.method === "GET") {
    sendJson(response, 200, app.getFundamentalBacktest({
      horizonDays: query.horizonDays ? Number(query.horizonDays) : query.horizon_days ? Number(query.horizon_days) : undefined,
      minSample: query.minSample ? Number(query.minSample) : query.min_sample ? Number(query.min_sample) : undefined,
      allowSyntheticPrices:
        String(query.allowSyntheticPrices || query.allow_synthetic_prices || "false").toLowerCase() === "true"
    }));
    return;
  }

  if (pathname === "/api/fundamentals/sec-queue" && request.method === "GET") {
    sendJson(response, 200, app.getSecFundamentalsQueue({
      limit: query.limit ? Number(query.limit) : 20
    }));
    return;
  }

  if (pathname === "/api/fundamentals/refresh" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        const result = await app.refreshFundamentals({
          forceUniverse: String(payload.forceUniverse ?? "false").toLowerCase() === "true"
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 500, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/fundamentals/storage/summary" && request.method === "GET") {
    sendJson(response, 200, app.getFundamentalPersistenceSummary());
    return;
  }

  if (pathname?.startsWith("/api/fundamentals/storage/ticker/") && pathname?.endsWith("/filings") && request.method === "GET") {
    const parts = pathname.split("/");
    const ticker = decodeURIComponent(parts[parts.length - 2]).toUpperCase();
    sendJson(response, 200, {
      ticker,
      filings: app.getFundamentalPersistenceFilings(ticker, query.limit ? Number(query.limit) : 10)
    });
    return;
  }

  if (pathname?.startsWith("/api/fundamentals/storage/ticker/") && pathname?.includes("/facts/") && request.method === "GET") {
    const parts = pathname.split("/");
    const ticker = decodeURIComponent(parts[parts.length - 3]).toUpperCase();
    const canonicalField = decodeURIComponent(parts[parts.length - 1]);
    sendJson(response, 200, {
      ticker,
      canonical_field: canonicalField,
      series: app.getFundamentalPersistenceFactSeries(ticker, canonicalField, {
        periodType: query.periodType || null,
        limit: query.limit ? Number(query.limit) : 12
      })
    });
    return;
  }

  if (pathname?.startsWith("/api/fundamentals/storage/ticker/") && request.method === "GET") {
    const ticker = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
    sendJson(response, 200, app.getFundamentalPersistenceTicker(ticker));
    return;
  }

  if (pathname?.startsWith("/api/fundamentals/ticker/") && request.method === "GET") {
    const ticker = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
    const detail = app.getFundamentalsTickerDetail(ticker);
    if (!detail) {
      sendJson(response, 404, { error: `Fundamental snapshot for ${ticker} not found` });
      return;
    }
    sendJson(response, 200, detail);
    return;
  }

  if (pathname?.startsWith("/api/fundamentals/sector/") && request.method === "GET") {
    const sector = decodeURIComponent(pathname.split("/").pop());
    const detail = app.getFundamentalsSectorDetail(sector);
    if (!detail) {
      sendJson(response, 404, { error: `Fundamental sector ${sector} not found` });
      return;
    }
    sendJson(response, 200, detail);
    return;
  }

  if (pathname === "/api/sentiment/watchlist" && request.method === "GET") {
    sendJson(response, 200, app.getWatchlistSnapshot(query.window || app.config.defaultWindow, {
      label: query.label || null,
      minConfidence: query.minConfidence ? Number(query.minConfidence) : null,
      screenStage: query.screenStage || null
    }));
    return;
  }

  if (pathname?.startsWith("/api/sentiment/ticker/") && request.method === "GET") {
    const ticker = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
    const detail = await app.getTickerDetail(ticker);
    if (!detail) {
      sendJson(response, 404, { error: `Ticker ${ticker} not found` });
      return;
    }
    sendJson(response, 200, detail);
    return;
  }

  if (pathname?.startsWith("/api/sentiment/sector/") && request.method === "GET") {
    const sector = decodeURIComponent(pathname.split("/").pop());
    const detail = app.getSectorDetail(sector);
    if (!detail) {
      sendJson(response, 404, { error: `Sector ${sector} not found` });
      return;
    }
    sendJson(response, 200, detail);
    return;
  }

  if (pathname === "/api/news/recent" && request.method === "GET") {
    sendJson(response, 200, app.getRecentDocuments({
      ticker: query.ticker ? String(query.ticker).toUpperCase() : null,
      limit: query.limit ? Number(query.limit) : 20
    }));
    return;
  }

  if (pathname === "/api/events/high-impact" && request.method === "GET") {
    sendJson(response, 200, app.getHighImpactEvents(query.limit ? Number(query.limit) : 10));
    return;
  }

  if (pathname === "/api/signals/money-flow" && request.method === "GET") {
    sendJson(response, 200, app.getMoneyFlowSignals({
      ticker: query.ticker ? String(query.ticker).toUpperCase() : null,
      limit: query.limit ? Number(query.limit) : 30
    }));
    return;
  }

  if (pathname === "/api/evidence-quality" && request.method === "GET") {
    sendJson(response, 200, app.getEvidenceQuality({
      ticker: query.ticker ? String(query.ticker).toUpperCase() : null,
      tier: query.tier || null,
      limit: query.limit ? Number(query.limit) : 50
    }));
    return;
  }

  if (pathname === "/api/macro-regime" && request.method === "GET") {
    sendJson(response, 200, app.getMacroRegime({
      window: query.window || app.config.defaultWindow
    }));
    return;
  }

  if (pathname === "/api/macro-regime/history" && request.method === "GET") {
    sendJson(response, 200, {
      history: app.getMacroRegimeHistory(query.limit ? Number(query.limit) : 20)
    });
    return;
  }

  if (pathname === "/api/trade-setups" && request.method === "GET") {
    sendJson(response, 200, app.getTradeSetups({
      window: query.window || app.config.defaultWindow,
      limit: query.limit ? Number(query.limit) : 12,
      minConviction: query.minConviction ? Number(query.minConviction) : 0.35,
      action: query.action || null
    }));
    return;
  }

  if (pathname === "/api/final-selection" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getFinalSelection({
        window: query.window || app.config.defaultWindow,
        limit: query.limit ? Number(query.limit) : 12,
        minConviction: query.minConviction !== undefined ? Number(query.minConviction) : undefined
      }));
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname?.startsWith("/api/final-selection/ticker/") && request.method === "GET") {
    try {
      const ticker = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
      const detail = await app.getFinalSelectionTicker(ticker, {
        window: query.window || app.config.defaultWindow,
        limit: query.limit ? Number(query.limit) : 50,
        minConviction: query.minConviction !== undefined ? Number(query.minConviction) : undefined
      });
      if (!detail) {
        sendJson(response, 404, { error: `Final selection candidate for ${ticker} not found` });
        return;
      }
      sendJson(response, 200, detail);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/portfolio/policy" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getPortfolioPolicy());
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/trading-workflow/status" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getTradingWorkflowStatus({
        window: query.window || app.config.defaultWindow,
        limit: query.limit ? Number(query.limit) : 25,
        minConviction: query.minConviction !== undefined ? Number(query.minConviction) : undefined
      }));
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/agency/cycle" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getAgencyCycleStatus({
        window: query.window || app.config.defaultWindow,
        limit: query.limit ? Number(query.limit) : 25,
        minConviction: query.minConviction !== undefined ? Number(query.minConviction) : undefined
      }));
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/agency/cycle/advance" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        sendJson(response, 200, await app.advanceAgencyCycle({
          window: payload.window || query.window || app.config.defaultWindow,
          limit: payload.limit || (query.limit ? Number(query.limit) : 25),
          minConviction: payload.minConviction !== undefined ? Number(payload.minConviction) : undefined
        }));
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/agency/cycle/run" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        sendJson(response, 200, await app.runAgencyCycle({
          window: payload.window || query.window || app.config.defaultWindow,
          limit: payload.limit || (query.limit ? Number(query.limit) : 25),
          minConviction: payload.minConviction !== undefined ? Number(payload.minConviction) : undefined,
          includeHeavy:
            payload.includeHeavy === true ||
            payload.include_heavy === true ||
            String(payload.includeHeavy || payload.include_heavy || query.includeHeavy || "").toLowerCase() === "true",
          priceLimit: payload.priceLimit || payload.price_limit || (query.priceLimit ? Number(query.priceLimit) : undefined)
        }));
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/trade-setups/storage/summary" && request.method === "GET") {
    sendJson(response, 200, app.getTradeSetupStorageSummary());
    return;
  }

  if (pathname?.startsWith("/api/trade-setups/storage/ticker/") && request.method === "GET") {
    const ticker = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
    sendJson(response, 200, {
      ticker,
      setups: app.getTradeSetupStorageTicker(ticker, query.limit ? Number(query.limit) : 20)
    });
    return;
  }

  if (pathname?.startsWith("/api/trade-setups/ticker/") && request.method === "GET") {
    const ticker = decodeURIComponent(pathname.split("/").pop()).toUpperCase();
    const detail = app.getTradeSetupTicker(ticker, {
      window: query.window || app.config.defaultWindow
    });
    if (!detail) {
      sendJson(response, 404, { error: `Trade setup for ${ticker} not found` });
      return;
    }
    sendJson(response, 200, detail);
    return;
  }

  if (pathname === "/api/execution/status" && request.method === "GET") {
    sendJson(response, 200, app.getExecutionStatus());
    return;
  }

  if (pathname === "/api/risk/status" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getRiskSnapshot());
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/risk/evaluate" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        sendJson(response, 200, await app.evaluateExecutionRisk(payload));
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/positions/monitor" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getPositionMonitor({
        window: query.window || app.config.defaultWindow,
        limit: query.limit ? Number(query.limit) : 25
      }));
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/execution/account" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getBrokerAccount());
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/execution/positions" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getBrokerPositions());
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/execution/orders" && request.method === "GET") {
    try {
      sendJson(response, 200, await app.getBrokerOrders({
        status: query.status || "open",
        limit: query.limit ? Number(query.limit) : 50,
        nested: String(query.nested || "false").toLowerCase() === "true",
        symbols: query.symbols || null
      }));
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/execution/preview" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        sendJson(response, 200, await app.previewExecutionOrder(payload));
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/execution/orders" && request.method === "POST") {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        const payload = parseJsonBody(body) || {};
        sendJson(response, 200, await app.submitExecutionOrder(payload));
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (pathname === "/api/execution/state" && request.method === "GET") {
    sendJson(response, 200, app.getExecutionState());
    return;
  }

  if (pathname === "/api/execution/log" && request.method === "GET") {
    sendJson(response, 200, app.getExecutionLog());
    return;
  }

  if (pathname.startsWith("/api/execution/approve/") && request.method === "POST") {
    const approvalId = pathname.slice("/api/execution/approve/".length);
    try {
      const result = await app.approveExecution(approvalId);
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname.startsWith("/api/execution/reject/") && request.method === "POST") {
    const approvalId = pathname.slice("/api/execution/reject/".length);
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const parsed = parseJsonBody(body) || {};
      app.rejectExecution(approvalId, parsed.reason || "");
      sendJson(response, 200, { ok: true });
    });
    return;
  }

  if (pathname === "/api/execution/kill-switch" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const parsed = parseJsonBody(body) || {};
      app.setKillSwitch(Boolean(parsed.enabled));
      sendJson(response, 200, { ok: true, enabled: Boolean(parsed.enabled) });
    });
    return;
  }

  if (pathname === "/api/execution/sync" && request.method === "POST") {
    try {
      await app.syncExecution();
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/replay" && request.method === "POST") {
    let options = {};
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      options = parseJsonBody(body) || {};
      if (!app.config.seedDataInDecisions) {
        sendJson(response, 403, {
          status: "blocked",
          reason: "seed_data_disabled",
          message: "Sample replay is disabled for decision data. Set SEED_DATA_IN_DECISIONS=true only for offline testing."
        });
        return;
      }
      app.replay({
        reset: true,
        intervalMs: options.interval_ms ?? 350,
        preserveFundamentals: true
      }).catch(() => undefined);
      sendJson(response, 202, { status: "accepted" });
    });
    return;
  }

  if (pathname === "/api/stream" && request.method === "GET") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });

    response.write(": connected\n\n");
    sseWrite(response, {
      type: "snapshot",
      health: app.getHealth(),
      watchlist: app.getWatchlistSnapshot(app.config.defaultWindow),
      fundamentals: app.getFundamentalsSnapshot(),
      execution: app.getExecutionState(),
      uta: {
        universes: app.getUtaUniverses(),
        lane_states: app.getUtaLaneStates()
      }
    });

    const listener = (event) => sseWrite(response, event);
    app.store.bus.on("event", listener);
    request.on("close", () => {
      app.store.bus.off("event", listener);
    });
    return;
  }

  await serveStaticFile(app.config.publicDir, response, pathname);
}
