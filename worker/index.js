import {
  jsonResponse,
  MAX_API_URL_LENGTH,
  getRequestOriginPolicy,
  responseHeaders,
} from "./http.js";
import { recordUsageAnalytics, MONITOR_USER_AGENT } from "./analytics.js";
import { ESPN_LEAGUES_BY_CODE } from "./football-metadata.js";
import {
  handleLiveMatchesRequest,
  handleMatchDetailRequest,
  handleLeagueStandingsRequest,
  handleTournamentBracketRequest,
} from "./routes.js";

export default {
  async scheduled(_controller, env) {
    await runScheduledHealthCheck(env);
  },
  async fetch(request, env) {
    const startedAt = Date.now();
    let response;

    try {
      response = await handleRequest(request, env);
      return response;
    } catch (_error) {
      // Keep unexpected failures observable as HTTP 500 without exposing
      // cache internals, provider diagnostics, credentials, or stack traces.
      console.error("Worker request failed unexpectedly");
      response = jsonResponse({ error: "Request could not be completed" },
        { status: 500, cache: "BYPASS", source: "none", request });
      return response;
    } finally {
      if (response) {
        recordUsageAnalytics(env, request, response, startedAt);
      }
    }
  },
};

async function runScheduledHealthCheck(env) {
  // Exercise the normal data/cache/failover path without recording a user visit.
  // GitHub's separate external probe also checks DNS, TLS and HTTP routing.
  const response = await handleRequest(new Request(
    "https://api.atakanozkan.com/live-matches?client=monitor&allowStale=1", {
      headers: { Origin: "chrome-extension://cdnpjnmhmagmiefkleefgchgffeaacaa",
        "User-Agent": MONITOR_USER_AGENT },
    }), env);
  if (!response.ok) throw new Error(`Scheduled data health check failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.freshness?.stale === true) {
    throw new Error("Scheduled data health check degraded: last-successful snapshot in use");
  }
  const codes = new Set(Array.isArray(payload.leagues) ? payload.leagues.map(league => league?.code) : []);
  if (!Array.isArray(payload.matches) || codes.size !== ESPN_LEAGUES_BY_CODE.size ||
      [...ESPN_LEAGUES_BY_CODE.keys()].some(code => !codes.has(code))) {
    throw new Error("Scheduled data health check failed: invalid league payload");
  }
  console.log("Scheduled data health check passed");
}

async function handleRequest(request, env) {
  if (request.url.length > MAX_API_URL_LENGTH) {
    return jsonResponse({ error: "Request URL is too long" }, { status: 414, request });
  }
  const url = new URL(request.url);

  const originPolicy = getRequestOriginPolicy(request);

  if (!originPolicy.allowed) {
    return jsonResponse(
      {
        error: "Forbidden origin",
        reason: originPolicy.reason,
      },
      { status: 403, cache: "BYPASS", source: "none", request },
    );
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: responseHeaders({ request, cacheControl: "no-store" }),
    });
  }

  const parameters = new Set();
  for (const [name] of url.searchParams) {
    if (parameters.has(name)) {
      return jsonResponse({ error: "Duplicate request parameter" }, { status: 400, request });
    }
    parameters.add(name);
  }

  if (request.method === "GET") {
    const limited = await applyApiRateLimit(request, env);
    if (limited) return limited;
  }

  if (url.pathname === "/live-matches") {
    return handleLiveMatchesRequest(request, env);
  }

  if (url.pathname === "/match-detail") {
    return handleMatchDetailRequest(request, url);
  }

  if (url.pathname === "/league-standings") {
    return handleLeagueStandingsRequest(request, url);
  }

  if (url.pathname === "/tournament-bracket") {
    return handleTournamentBracketRequest(request, url);
  }

  return jsonResponse(
    { error: "Not found" },
    { status: 404, cache: "BYPASS", source: "none", request },
  );
}

async function applyApiRateLimit(request, env) {
  // CF-Connecting-IP is supplied by Cloudflare. Never use a caller-selected
  // client/version/monitor label as authentication or as a rate-limit bypass.
  // Cron calls have no connecting IP; no shared "anonymous" bucket is created.
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || ip.length > 64 || typeof env?.API_RATE_LIMITER?.limit !== "function") return null;
  try {
    const result = await env.API_RATE_LIMITER.limit({ key: `hype-api-v1:${ip}` });
    if (result?.success === false) {
      return jsonResponse({ error: "Too many requests. Please try again shortly." },
        { status: 429, retryAfter: 60, request });
    }
  } catch (_error) {
    // This protects a public, read-only service, not access to private data.
    // A limiter outage must not become an outage for every legitimate user.
    console.warn("API rate limiter unavailable; continuing with existing request guards");
  }
  return null;
}
