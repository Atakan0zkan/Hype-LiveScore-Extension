import { getRequestOriginPolicy, getErrorMessage } from "./http.js";
import { isSupportedLeagueCode } from "./football-metadata.js";

const MONITOR_USER_AGENT = "HypeScore-HealthMonitor/1.0";

function recordUsageAnalytics(env, request, response, startedAt, error = null) {
  const dataset = env?.USAGE_ANALYTICS;
  if (!dataset || typeof dataset.writeDataPoint !== "function") {
    return;
  }

  try {
    const url = new URL(request.url);
    const originPolicy = getRequestOriginPolicy(request);
    // A non-secret traffic label, never authentication or an origin bypass.
    // Keep automated probes out of the product-usage dataset.
    if (request.method === "GET" && originPolicy.allowed &&
        url.searchParams.get("client") === "monitor" &&
        request.headers.get("User-Agent") === MONITOR_USER_AGENT) return;
    const endpoint = normalizeAnalyticsEndpoint(url.pathname);
    const client = normalizeAnalyticsClient(url.searchParams.get("client"));
    const clientVersion = normalizeClientVersion(url.searchParams.get("version"));
    const browser = parseBrowserFamily(request.headers.get("User-Agent") || "");
    const status = response?.status || (error ? 500 : 0);
    const leagueCode = normalizeLeagueCodeForAnalytics(
      url.searchParams.get("leagueCode"),
    );
    const durationMs = Math.max(0, Date.now() - startedAt);

    dataset.writeDataPoint({
      blobs: [
        endpoint,
        sanitizeAnalyticsDimension(request.cf?.country || "unknown", 8),
        client,
        clientVersion,
        browser.family,
        browser.major,
        status > 0 ? `${Math.floor(status / 100)}xx` : "unknown",
        sanitizeAnalyticsDimension(response?.headers?.get("X-Cache") || "BYPASS", 16),
        sanitizeAnalyticsDimension(response?.headers?.get("X-Data-Source") || "none", 48),
        leagueCode,
        originPolicy.reason,
        sanitizeAnalyticsDimension(request.cf?.colo || "unknown", 8),
        sanitizeAnalyticsDimension(request.method || "unknown", 12),
      ],
      doubles: [1, durationMs, status],
      indexes: [`${endpoint}:${client}`],
    });
  } catch (analyticsError) {
    console.warn(`Usage analytics write failed: ${getErrorMessage(analyticsError)}`);
  }
}

function normalizeAnalyticsEndpoint(pathname) {
  const knownEndpoints = new Set([
    "/live-matches",
    "/league-standings",
    "/match-detail",
    "/tournament-bracket",
  ]);

  return knownEndpoints.has(pathname) ? pathname : "/other";
}

function normalizeAnalyticsClient(value) {
  return value === "extension" ? "extension" : "unknown";
}

function normalizeClientVersion(value) {
  const version = String(value || "");
  return /^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(version) ? version : "unknown";
}

function normalizeLeagueCodeForAnalytics(value) {
  const leagueCode = String(value || "");
  return isSupportedLeagueCode(leagueCode) ? leagueCode : "none";
}

function parseBrowserFamily(userAgent) {
  const patterns = [
    ["Edge", /\bEdg\/(\d+)/],
    ["Opera", /\bOPR\/(\d+)/],
    ["Chrome", /\b(?:Chrome|Chromium)\/(\d+)/],
    ["Firefox", /\bFirefox\/(\d+)/],
    ["Safari", /\bVersion\/(\d+).+\bSafari\//],
  ];

  for (const [family, pattern] of patterns) {
    const match = userAgent.match(pattern);
    if (match) {
      return { family, major: match[1].length <= 5 ? match[1] : "unknown" };
    }
  }

  return { family: "Other", major: "unknown" };
}

function sanitizeAnalyticsDimension(value, maxLength = 64) {
  const normalized = String(value || "unknown")
    .replace(/[^a-zA-Z0-9._:/-]/g, "-")
    .slice(0, maxLength);
  return normalized || "unknown";
}

export { recordUsageAnalytics, MONITOR_USER_AGENT };
