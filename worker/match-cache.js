import { safeReadJsonResponse, getErrorMessage } from "./http.js";
import {
  FIFA_WORLD_CUP_LEAGUE_CODE,
  isSupportedLeagueCode,
  FIFA_WORLD_CUP_YEAR,
  FIFA_WORLD_CUP_DATES,
} from "./football-metadata.js";

const LIVE_CACHE_TTL_SECONDS = 30;
const IDLE_CACHE_TTL_SECONDS = 120;
const LIVE_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
const STANDINGS_CACHE_TTL_SECONDS = 1800;
const MATCH_DETAIL_CACHE_TTL_SECONDS = 60;
const TOURNAMENT_BRACKET_CACHE_TTL_SECONDS = 900;

const MAX_EVENT_ID_LENGTH = 20;
const MAX_REMEMBERED_EVENT_KEYS = 1024;
const LIVE_MATCHES_CACHE_KEY_VERSION = "v18";
const STANDINGS_CACHE_KEY_VERSION = "v6";
const MATCH_DETAIL_CACHE_KEY_VERSION = "v9";
const KNOWN_EVENTS_TTL_MS = 60 * 60 * 1000;
const KNOWN_EVENTS_CACHE_URL = "https://live-score-extension.internal/known-events/v2";
const TOURNAMENT_BRACKET_CACHE_KEY_VERSION = "v2";
const CACHE_KEY_URL = `https://live-score-extension.internal/live-matches/${LIVE_MATCHES_CACHE_KEY_VERSION}`;
const LAST_GOOD_LIVE_CACHE_URL = `${CACHE_KEY_URL}/last-good`;

const rememberedEventKeys = new Set();

function isSafeEventId(eventId) {
  return new RegExp(`^\\d{3,${MAX_EVENT_ID_LENGTH}}$`).test(eventId);
}

async function isKnownMatchDetailEvent(cache, eventId, leagueCode) {
  const eventKey = getEventKey(eventId, leagueCode);
  if (rememberedEventKeys.has(eventKey)) {
    return true;
  }

  // The popup may retain results for 30 minutes, outliving the 30/120s live
  // cache and the serving isolate. Keep a bounded, non-public allowlist longer.
  const registry = await readKnownMatches(cache);
  if (registry.some((entry) => entry.key === eventKey && entry.expires > Date.now())) {
    rememberEventKey(eventId, leagueCode);
    return true;
  }

  const liveResponse = await cache.match(
    new Request(CACHE_KEY_URL, { method: "GET" }),
  );
  if (liveResponse) {
    const livePayload = await safeReadJsonResponse(liveResponse);
    rememberKnownMatches(livePayload?.matches);
    if (rememberedEventKeys.has(eventKey)) {
      return true;
    }
  }

  if (leagueCode === FIFA_WORLD_CUP_LEAGUE_CODE) {
    const bracketResponse = await cache.match(
      getTournamentBracketCacheKey(leagueCode),
    );
    if (bracketResponse) {
      const bracketPayload = await safeReadJsonResponse(bracketResponse);
      rememberKnownBracketRounds(bracketPayload?.rounds);
    }
  }

  return rememberedEventKeys.has(eventKey);
}

async function readKnownMatches(cache) {
  const response = await cache.match(new Request(KNOWN_EVENTS_CACHE_URL));
  const entries = response ? await safeReadJsonResponse(response) : [];
  return Array.isArray(entries) ? entries.filter((entry) =>
    entry && typeof entry.key === "string" && Number.isFinite(entry.expires) && entry.expires > Date.now()
  ).slice(-MAX_REMEMBERED_EVENT_KEYS) : [];
}

async function persistKnownMatches(cache, matches) {
  try {
    const entries = new Map((await readKnownMatches(cache)).map((entry) => [entry.key, entry]));
    for (const match of Array.isArray(matches) ? matches : []) {
      if (!isSafeEventId(String(match?.id || "")) || !isSupportedLeagueCode(match?.leagueCode)) continue;
      const key = getEventKey(match.id, match.leagueCode);
      entries.delete(key);
      entries.set(key, { key, expires: Date.now() + KNOWN_EVENTS_TTL_MS });
    }
    await cache.put(new Request(KNOWN_EVENTS_CACHE_URL), new Response(
      JSON.stringify([...entries.values()].slice(-MAX_REMEMBERED_EVENT_KEYS)),
      { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } },
    ));
  } catch (error) {
    console.warn(`Known-event cache put failed: ${getErrorMessage(error)}`);
  }
}

function rememberKnownMatches(matches) {
  if (!Array.isArray(matches)) {
    return;
  }

  for (const match of matches) {
    rememberEventKey(match?.id, match?.leagueCode);
  }
}

function rememberKnownBracketRounds(rounds) {
  if (!Array.isArray(rounds)) {
    return;
  }

  for (const round of rounds) {
    rememberKnownMatches(round?.matches);
  }
}

function rememberEventKey(eventId, leagueCode) {
  if (
    !isSafeEventId(String(eventId || "")) ||
    !isSupportedLeagueCode(leagueCode)
  ) {
    return;
  }

  const eventKey = getEventKey(eventId, leagueCode);
  rememberedEventKeys.delete(eventKey);
  rememberedEventKeys.add(eventKey);

  while (rememberedEventKeys.size > MAX_REMEMBERED_EVENT_KEYS) {
    rememberedEventKeys.delete(rememberedEventKeys.values().next().value);
  }
}

function getEventKey(eventId, leagueCode) {
  return `${leagueCode}:${eventId}`;
}

function getStandingsCacheKey(leagueCode) {
  const seasonSuffix = leagueCode === FIFA_WORLD_CUP_LEAGUE_CODE ? `/${FIFA_WORLD_CUP_YEAR}` : "";
  return new Request(
    `https://live-score-extension.internal/standings/${STANDINGS_CACHE_KEY_VERSION}/${leagueCode}${seasonSuffix}`,
    { method: "GET" },
  );
}

function getTournamentBracketCacheKey(leagueCode) {
  const cacheKeyUrl = [
    "https://live-score-extension.internal/tournament-bracket",
    TOURNAMENT_BRACKET_CACHE_KEY_VERSION,
    leagueCode,
    FIFA_WORLD_CUP_DATES,
  ].join("/");

  return new Request(cacheKeyUrl, { method: "GET" });
}

export {
  CACHE_KEY_URL,
  LAST_GOOD_LIVE_CACHE_URL,
  LIVE_CACHE_TTL_SECONDS,
  IDLE_CACHE_TTL_SECONDS,
  LIVE_SNAPSHOT_MAX_AGE_MS,
  isSafeEventId,
  MATCH_DETAIL_CACHE_KEY_VERSION,
  MATCH_DETAIL_CACHE_TTL_SECONDS,
  isKnownMatchDetailEvent,
  getStandingsCacheKey,
  STANDINGS_CACHE_TTL_SECONDS,
  getTournamentBracketCacheKey,
  TOURNAMENT_BRACKET_CACHE_TTL_SECONDS,
  rememberKnownMatches,
  persistKnownMatches,
  rememberKnownBracketRounds,
  getEventKey,
};
