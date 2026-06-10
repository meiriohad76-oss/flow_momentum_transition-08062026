const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const PROVIDER_CONFIG = {
  finnhub: {
    minuteLimitKey: "finnhubMaxRequestsPerMinute",
    dayLimitKey: "finnhubMaxRequestsPerDay",
    minuteReserveKey: "finnhubReserveRequestsPerMinute",
    dayReserveKey: "finnhubReserveRequestsPerDay",
    defaultMinuteLimit: 45,
    defaultDayLimit: 0,
    defaultMinuteReserve: 2,
    defaultDayReserve: 0
  },
  fmp: {
    minuteLimitKey: "fmpMaxRequestsPerMinute",
    dayLimitKey: "fmpMaxRequestsPerDay",
    minuteReserveKey: "fmpReserveRequestsPerMinute",
    dayReserveKey: "fmpReserveRequestsPerDay",
    defaultMinuteLimit: 0,
    defaultDayLimit: 200,
    defaultMinuteReserve: 0,
    defaultDayReserve: 25
  },
  marketaux: {
    minuteLimitKey: "marketauxMaxRequestsPerMinute",
    dayLimitKey: "marketauxMaxRequestsPerDay",
    minuteReserveKey: "marketauxReserveRequestsPerMinute",
    dayReserveKey: "marketauxReserveRequestsPerDay",
    defaultMinuteLimit: 0,
    defaultDayLimit: 80,
    defaultMinuteReserve: 0,
    defaultDayReserve: 10
  },
  twelvedata: {
    minuteLimitKey: "twelveDataMaxRequestsPerMinute",
    dayLimitKey: "twelveDataMaxRequestsPerDay",
    minuteReserveKey: "twelveDataReserveRequestsPerMinute",
    dayReserveKey: "twelveDataReserveRequestsPerDay",
    defaultMinuteLimit: 7,
    defaultDayLimit: 700,
    defaultMinuteReserve: 1,
    defaultDayReserve: 50
  },
  alphavantage: {
    minuteLimitKey: "alphaVantageMaxRequestsPerMinute",
    dayLimitKey: "alphaVantageMaxRequestsPerDay",
    minuteReserveKey: "alphaVantageReserveRequestsPerMinute",
    dayReserveKey: "alphaVantageReserveRequestsPerDay",
    defaultMinuteLimit: 5,
    defaultDayLimit: 20,
    defaultMinuteReserve: 1,
    defaultDayReserve: 2
  },
  polygon: {
    minuteLimitKey: "polygonMaxRequestsPerMinute",
    dayLimitKey: "polygonMaxRequestsPerDay",
    minuteReserveKey: "polygonReserveRequestsPerMinute",
    dayReserveKey: "polygonReserveRequestsPerDay",
    defaultMinuteLimit: 4,
    defaultDayLimit: 0,
    defaultMinuteReserve: 1,
    defaultDayReserve: 0
  },
  massive: {
    minuteLimitKey: "massiveMaxRequestsPerMinute",
    dayLimitKey: "massiveMaxRequestsPerDay",
    minuteReserveKey: "massiveReserveRequestsPerMinute",
    dayReserveKey: "massiveReserveRequestsPerDay",
    defaultMinuteLimit: 4,
    defaultDayLimit: 0,
    defaultMinuteReserve: 1,
    defaultDayReserve: 0
  }
};

export class ProviderQuotaSkippedError extends Error {
  constructor(provider, reason, snapshot = null) {
    super(`${provider} skipped before provider limit: ${reason}`);
    this.name = "ProviderQuotaSkippedError";
    this.provider = provider;
    this.reason = reason;
    this.snapshot = snapshot;
    this.quotaSkipped = true;
    this.status = 429;
  }
}

function nowUtcDayStart(now = Date.now()) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function numberFromConfig(config, key, fallback = 0) {
  const value = Number(config?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function isQuotaError(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || error || "").toLowerCase();
  return (
    status === 429 ||
    /\b429\b|rate.?limit|too many requests|api credits|daily limit|quota|usage limit|exceeded|premium endpoint/.test(message)
  );
}

function quotaCooldownMs(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (/daily limit|api credits|quota|usage limit|exceeded/.test(message)) {
    return 6 * 60 * 60 * 1000;
  }
  return 15 * 60 * 1000;
}

export function createProviderQuotaManager({ config = {}, store = null } = {}) {
  const state = new Map();
  const strict = String(config.providerQuotaStrict ?? "true").toLowerCase() !== "false";

  function providerState(provider) {
    const key = String(provider || "").toLowerCase();
    if (!state.has(key)) {
      state.set(key, {
        minuteWindowStart: Date.now(),
        minuteUsed: 0,
        dayWindowStart: nowUtcDayStart(),
        dayUsed: 0,
        cooldownUntil: 0,
        cooldownReason: null,
        skips: 0,
        requests: 0,
        failures: 0
      });
    }
    return state.get(key);
  }

  function limits(provider) {
    const normalized = String(provider || "").toLowerCase();
    const spec = PROVIDER_CONFIG[normalized] || {};
    return {
      provider: normalized,
      minuteLimit: numberFromConfig(config, spec.minuteLimitKey, spec.defaultMinuteLimit || 0),
      dayLimit: numberFromConfig(config, spec.dayLimitKey, spec.defaultDayLimit || 0),
      minuteReserve: numberFromConfig(config, spec.minuteReserveKey, spec.defaultMinuteReserve || 0),
      dayReserve: numberFromConfig(config, spec.dayReserveKey, spec.defaultDayReserve || 0)
    };
  }

  function rollWindows(row, now = Date.now()) {
    if (now - row.minuteWindowStart >= MINUTE_MS) {
      row.minuteWindowStart = now;
      row.minuteUsed = 0;
    }
    const dayStart = nowUtcDayStart(now);
    if (row.dayWindowStart !== dayStart || now - row.dayWindowStart >= DAY_MS) {
      row.dayWindowStart = dayStart;
      row.dayUsed = 0;
    }
    if (row.cooldownUntil && row.cooldownUntil <= now) {
      row.cooldownUntil = 0;
      row.cooldownReason = null;
    }
  }

  function snapshotProvider(provider) {
    const normalized = String(provider || "").toLowerCase();
    const row = providerState(normalized);
    rollWindows(row);
    const limit = limits(normalized);
    const minuteRemaining = limit.minuteLimit
      ? Math.max(0, limit.minuteLimit - limit.minuteReserve - row.minuteUsed)
      : null;
    const dayRemaining = limit.dayLimit
      ? Math.max(0, limit.dayLimit - limit.dayReserve - row.dayUsed)
      : null;
    return {
      provider: normalized,
      strict,
      minute_limit: limit.minuteLimit || null,
      minute_reserve: limit.minuteLimit ? limit.minuteReserve : null,
      minute_used: row.minuteUsed,
      minute_remaining_before_reserve: minuteRemaining,
      day_limit: limit.dayLimit || null,
      day_reserve: limit.dayLimit ? limit.dayReserve : null,
      day_used: row.dayUsed,
      day_remaining_before_reserve: dayRemaining,
      cooldown_seconds_remaining: row.cooldownUntil
        ? Math.max(0, Math.ceil((row.cooldownUntil - Date.now()) / 1000))
        : 0,
      cooldown_reason: row.cooldownReason,
      requests: row.requests,
      failures: row.failures,
      skips: row.skips
    };
  }

  function updateStoreSnapshot() {
    if (!store?.health) {
      return;
    }
    store.health.providerQuota = {
      strict,
      providers: Object.keys(PROVIDER_CONFIG).map((provider) => snapshotProvider(provider))
    };
  }

  function canUse(provider, cost = 1) {
    const normalized = String(provider || "").toLowerCase();
    if (!normalized || !strict) {
      return { ok: true, snapshot: null };
    }
    const row = providerState(normalized);
    rollWindows(row);
    const limit = limits(normalized);
    const now = Date.now();

    if (row.cooldownUntil && row.cooldownUntil > now) {
      return {
        ok: false,
        reason: `cooldown active after ${row.cooldownReason || "provider quota error"}`,
        snapshot: snapshotProvider(normalized)
      };
    }

    if (limit.minuteLimit && row.minuteUsed + cost > Math.max(0, limit.minuteLimit - limit.minuteReserve)) {
      return {
        ok: false,
        reason: `minute budget reserved (${row.minuteUsed}/${limit.minuteLimit}, reserve ${limit.minuteReserve})`,
        snapshot: snapshotProvider(normalized)
      };
    }

    if (limit.dayLimit && row.dayUsed + cost > Math.max(0, limit.dayLimit - limit.dayReserve)) {
      return {
        ok: false,
        reason: `daily budget reserved (${row.dayUsed}/${limit.dayLimit}, reserve ${limit.dayReserve})`,
        snapshot: snapshotProvider(normalized)
      };
    }

    return { ok: true, snapshot: snapshotProvider(normalized) };
  }

  function recordSkip(provider, reason) {
    const row = providerState(provider);
    rollWindows(row);
    row.skips += 1;
    updateStoreSnapshot();
    return new ProviderQuotaSkippedError(provider, reason, snapshotProvider(provider));
  }

  function recordRequest(provider, cost = 1) {
    const row = providerState(provider);
    rollWindows(row);
    row.minuteUsed += cost;
    row.dayUsed += cost;
    row.requests += 1;
    updateStoreSnapshot();
  }

  function recordFailure(provider, error) {
    const row = providerState(provider);
    rollWindows(row);
    row.failures += 1;
    if (isQuotaError(error)) {
      row.cooldownUntil = Date.now() + quotaCooldownMs(error);
      row.cooldownReason = error.message || "provider quota error";
    }
    updateStoreSnapshot();
  }

  async function run(provider, fn, { cost = 1 } = {}) {
    const normalized = String(provider || "").toLowerCase();
    const allowed = canUse(normalized, cost);
    if (!allowed.ok) {
      throw recordSkip(normalized, allowed.reason);
    }
    recordRequest(normalized, cost);
    try {
      return await fn();
    } catch (error) {
      recordFailure(normalized, error);
      throw error;
    }
  }

  function snapshot() {
    updateStoreSnapshot();
    return store?.health?.providerQuota || {
      strict,
      providers: Object.keys(PROVIDER_CONFIG).map((provider) => snapshotProvider(provider))
    };
  }

  return {
    canUse,
    recordSkip,
    recordRequest,
    recordFailure,
    run,
    snapshot
  };
}
