import { jsonResponse, getErrorMessage, responseHeaders, responseForRequest } from "./http.js";
import {
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
} from "./match-cache.js";
import {
  countLiveMatches,
  getLiveMatches,
  groupMatchesByLeague,
  isWorldCup2030Event,
} from "./scoreboard.js";
import { filterScoreboardResults } from "./result-window.js";
import {
  ESPN_LEAGUES_BY_CODE,
  isSupportedLeagueCode,
  FIFA_WORLD_CUP_LEAGUE_CODE,
  FIFA_WORLD_CUP_YEAR,
  FIFA_WORLD_CUP_DATES,
} from "./football-metadata.js";
import {
  fetchFutureWorldCupJson,
  ESPN_STANDINGS_BASE_URL,
  fetchJson,
  ESPN_SUMMARY_BASE_URL,
} from "./upstream.js";
import { normalizeEspnStandings, normalizeTournamentBracket } from "./competition-tables.js";
import { normalizeEspnMatchDetail } from "./match-detail.js";

let liveMatchesRefreshPromise = null;
const standingsRefreshPromises = new Map();
const matchDetailRefreshPromises = new Map();
const tournamentBracketRefreshPromises = new Map();

async function handleLiveMatchesRequest(request, env) {
  if (request.method !== "GET") {
    return jsonResponse(
      { error: "Method not allowed" },
      { status: 405, cache: "BYPASS", source: "none", request },
    );
  }

  const cache = caches.default;
  const cacheKey = new Request(CACHE_KEY_URL, { method: "GET" });
  const cached = await readLiveSnapshot(cache, cacheKey);
  if (cached && Date.now() - cached.updatedAt < getLiveCacheTtl(cached.payload.matches) * 1000) {
    return liveSnapshotResponse(cached, request, false);
  }

  try {
    return await getFreshLiveMatchesResponse(env, cache, cacheKey, request);
  } catch (error) {
    const message = getErrorMessage(error);
    console.warn(`Live match refresh failed: ${message}`);
    // Clients must explicitly support the bounded snapshot contract before
    // receiving a successful but degraded response.
    if (new URL(request.url).searchParams.get("allowStale") === "1") {
      const snapshot = await readLiveSnapshot(cache, new Request(LAST_GOOD_LIVE_CACHE_URL));
      if (snapshot) return liveSnapshotResponse(snapshot, request, true);
    }
    return jsonResponse(
      { error: "Live match data could not be fetched" },
      { status: 502, cache: "BYPASS", source: "none", request },
    );
  }
}

function getLiveCacheTtl(matches) {
  return countLiveMatches(matches) > 0 ? LIVE_CACHE_TTL_SECONDS : IDLE_CACHE_TTL_SECONDS;
}

async function readLiveSnapshot(cache, key) {
  try {
    const response = await cache.match(key);
    if (!response?.ok) return null;
    const payload = await response.json();
    const updatedAt = typeof payload?.freshness?.updatedAt === "string"
      ? Date.parse(payload.freshness.updatedAt) : NaN;
    const age = Date.now() - updatedAt;
    const codes = new Set(Array.isArray(payload?.leagues) ? payload.leagues.map(league => league?.code) : []);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0 || age < 0 || age >= LIVE_SNAPSHOT_MAX_AGE_MS ||
        payload.freshness.stale !== false || !Array.isArray(payload.matches) ||
        codes.size !== ESPN_LEAGUES_BY_CODE.size ||
        [...ESPN_LEAGUES_BY_CODE.keys()].some(code => !codes.has(code)) ||
        payload.leagues.some(league => !Array.isArray(league?.matches))) return null;
    return { payload, updatedAt, source: response.headers.get("X-Data-Source") || "cache" };
  } catch (error) {
    console.warn(`Live snapshot cache read failed: ${getErrorMessage(error)}`);
    return null;
  }
}

function liveSnapshotResponse(snapshot, request, stale) {
  const now = Date.now();
  const ageSeconds = Math.max(0, Math.floor((now - snapshot.updatedAt) / 1000));
  return jsonResponse({
    ...snapshot.payload,
    matches: filterScoreboardResults(snapshot.payload.matches, now),
    leagues: snapshot.payload.leagues.map((league) => ({ ...league, matches: filterScoreboardResults(league.matches, now) })),
    freshness: { updatedAt: new Date(snapshot.updatedAt).toISOString(), stale },
  }, {
    request,
    cache: stale ? "STALE" : "HIT",
    source: snapshot.source,
    // Stale output is never written back, and neither the browser nor a proxy
    // may extend its lifetime. The original timestamp remains authoritative.
    cacheControl: stale ? "no-store" : `public, max-age=${Math.max(0, getLiveCacheTtl(snapshot.payload.matches) - ageSeconds)}`,
  });
}

async function handleMatchDetailRequest(request, url) {
  if (request.method !== "GET") {
    return jsonResponse(
      { error: "Method not allowed" },
      { status: 405, cache: "BYPASS", source: "none", request },
    );
  }

  const eventId = url.searchParams.get("eventId") || "";
  const leagueCode = url.searchParams.get("leagueCode") || "";

  if (!isSafeEventId(eventId) || !isSupportedLeagueCode(leagueCode)) {
    return jsonResponse(
      { error: "Invalid match detail request" },
      { status: 400, cache: "BYPASS", source: "none", request },
    );
  }

  const cache = caches.default;
  const cacheKey = new Request(
    `https://live-score-extension.internal/match-detail/${MATCH_DETAIL_CACHE_KEY_VERSION}/${leagueCode}/${eventId}`,
    { method: "GET" },
  );
  const cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {
    const body = await cachedResponse.text();
    return new Response(body, {
      status: cachedResponse.status,
      headers: responseHeaders({
        request,
        cache: "HIT",
        source: "espn-summary",
        cacheControl: `public, max-age=${MATCH_DETAIL_CACHE_TTL_SECONDS}`,
      }),
    });
  }

  if (!(await isKnownMatchDetailEvent(cache, eventId, leagueCode))) {
    return jsonResponse(
      { error: "Match detail is not available for this event" },
      { status: 404, cache: "BYPASS", source: "none", request },
    );
  }

  try {
    return await getFreshMatchDetailResponse(
      eventId,
      leagueCode,
      cache,
      cacheKey,
      request,
    );
  } catch (error) {
    console.warn(`Match detail refresh failed: ${getErrorMessage(error)}`);
    return jsonResponse(
      { error: "Match detail could not be fetched" },
      { status: 502, cache: "BYPASS", source: "none", request },
    );
  }
}

async function handleLeagueStandingsRequest(request, url) {
  if (request.method !== "GET") {
    return jsonResponse(
      { error: "Method not allowed" },
      { status: 405, cache: "BYPASS", source: "none", request },
    );
  }

  const leagueCode = url.searchParams.get("leagueCode") || "";

  const league = ESPN_LEAGUES_BY_CODE.get(leagueCode);
  if (!league) {
    return jsonResponse(
      { error: "Invalid league standings request" },
      { status: 400, cache: "BYPASS", source: "none", request },
    );
  }

  if (league.hasStandings === false) {
    return jsonResponse({ leagueCode, standings: [] }, { request, cache: "BYPASS", source: "none" });
  }

  const cache = caches.default;
  const cacheKey = getStandingsCacheKey(leagueCode);
  const cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {
    const body = await cachedResponse.text();
    return new Response(body, {
      status: cachedResponse.status,
      headers: responseHeaders({
        request,
        cache: "HIT",
        source: "espn-standings",
        cacheControl:
          cachedResponse.headers.get("Cache-Control") ||
          `public, max-age=${STANDINGS_CACHE_TTL_SECONDS}`,
      }),
    });
  }

  try {
    const standings = await getFreshStandingsForLeague(leagueCode, cache, cacheKey);
    const response = jsonResponse(
      { leagueCode, standings, ...(leagueCode === FIFA_WORLD_CUP_LEAGUE_CODE ? { seasonYear: FIFA_WORLD_CUP_YEAR } : {}) },
      {
        request,
        cache: "MISS",
        source: "espn-standings",
        cacheControl: `public, max-age=${STANDINGS_CACHE_TTL_SECONDS}`,
      },
    );

    try {
      await cache.put(cacheKey, response.clone());
    } catch (error) {
      console.warn(`Standings cache put failed: ${getErrorMessage(error)}`);
    }

    return response;
  } catch (error) {
    const message = getErrorMessage(error);
    console.warn(`League standings failed: ${message}`);
    return jsonResponse(
      { error: "League standings could not be fetched" },
      { status: 502, cache: "BYPASS", source: "none", request },
    );
  }
}

async function handleTournamentBracketRequest(request, url) {
  if (request.method !== "GET") {
    return jsonResponse(
      { error: "Method not allowed" },
      { status: 405, cache: "BYPASS", source: "none", request },
    );
  }

  const leagueCode = url.searchParams.get("leagueCode") || "";

  if (leagueCode !== FIFA_WORLD_CUP_LEAGUE_CODE) {
    return jsonResponse(
      { error: "Invalid tournament bracket request" },
      { status: 400, cache: "BYPASS", source: "none", request },
    );
  }

  const cache = caches.default;
  const cacheKey = getTournamentBracketCacheKey(leagueCode);
  const cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {
    const body = await cachedResponse.text();
    return new Response(body, {
      status: cachedResponse.status,
      headers: responseHeaders({
        request,
        cache: "HIT",
        source: "espn-tournament-bracket",
        cacheControl:
          cachedResponse.headers.get("Cache-Control") ||
          `public, max-age=${TOURNAMENT_BRACKET_CACHE_TTL_SECONDS}`,
      }),
    });
  }

  try {
    return await getFreshTournamentBracketResponse(
      leagueCode,
      cache,
      cacheKey,
      request,
    );
  } catch (error) {
    console.warn(`Tournament bracket failed: ${getErrorMessage(error)}`);
    return jsonResponse(
      { error: "Tournament bracket could not be fetched" },
      { status: 502, cache: "BYPASS", source: "none", request },
    );
  }
}

async function getFreshLiveMatchesResponse(env, cache, cacheKey, request) {
  if (!liveMatchesRefreshPromise) {
    liveMatchesRefreshPromise = refreshLiveMatches(env, cache, cacheKey).finally(
      () => {
        liveMatchesRefreshPromise = null;
      },
    );
  }

  const response = await liveMatchesRefreshPromise;
  return responseForRequest(response, request);
}

async function getFreshMatchDetailResponse(
  eventId,
  leagueCode,
  cache,
  cacheKey,
  request,
) {
  const promiseKey = `${leagueCode}:${eventId}`;

  if (!matchDetailRefreshPromises.has(promiseKey)) {
    matchDetailRefreshPromises.set(
      promiseKey,
      refreshMatchDetail(eventId, leagueCode, cache, cacheKey).finally(
        () => {
          matchDetailRefreshPromises.delete(promiseKey);
        },
      ),
    );
  }

  const response = await matchDetailRefreshPromises.get(promiseKey);
  return responseForRequest(response, request);
}

async function getFreshStandingsForLeague(leagueCode, cache, cacheKey) {
  if (!standingsRefreshPromises.has(leagueCode)) {
    standingsRefreshPromises.set(
      leagueCode,
      refreshStandingsForLeague(leagueCode, cache, cacheKey).finally(() => {
        standingsRefreshPromises.delete(leagueCode);
      }),
    );
  }

  return standingsRefreshPromises.get(leagueCode);
}

async function getFreshTournamentBracketResponse(
  leagueCode,
  cache,
  cacheKey,
  request,
) {
  if (!tournamentBracketRefreshPromises.has(leagueCode)) {
    tournamentBracketRefreshPromises.set(
      leagueCode,
      refreshTournamentBracket(leagueCode, cache, cacheKey).finally(
        () => {
          tournamentBracketRefreshPromises.delete(leagueCode);
        },
      ),
    );
  }

  const response = await tournamentBracketRefreshPromises.get(leagueCode);
  return responseForRequest(response, request);
}

async function refreshLiveMatches(env, cache, cacheKey) {
  const { matches, source } = await getLiveMatches(env, cache);
  const cacheTtl = getLiveCacheTtl(matches);
  const data = {
    matches,
    leagues: groupMatchesByLeague(matches),
    freshness: { updatedAt: new Date().toISOString(), stale: false },
  };
  rememberKnownMatches(matches);
  await persistKnownMatches(cache, matches);
  const response = jsonResponse(data, {
    cache: "MISS",
    source,
    cacheControl: `public, max-age=${cacheTtl}`,
  });

  try {
    await cache.put(cacheKey, response.clone());
  } catch (error) {
    console.warn(`Cache put failed: ${getErrorMessage(error)}`);
  }

  try {
    await cache.put(new Request(LAST_GOOD_LIVE_CACHE_URL), jsonResponse(data, {
      source,
      cacheControl: `public, max-age=${LIVE_SNAPSHOT_MAX_AGE_MS / 1000}`,
    }));
  } catch (error) {
    console.warn(`Last-successful snapshot write failed: ${getErrorMessage(error)}`);
  }

  return response;
}

async function refreshStandingsForLeague(leagueCode) {
  if (leagueCode === FIFA_WORLD_CUP_LEAGUE_CODE) {
    const payload = await fetchFutureWorldCupJson(
      `${ESPN_STANDINGS_BASE_URL}/${leagueCode}/standings?season=${FIFA_WORLD_CUP_YEAR}`,
    );
    // Unknown years can return previous seasons or a season catalogue.
    if (Number(payload?.season?.year) !== FIFA_WORLD_CUP_YEAR) return [];
    return normalizeEspnStandings({
      ...payload,
      children: Array.isArray(payload.children) ? payload.children.filter((child) =>
        !child?.season || Number(child.season.year) === FIFA_WORLD_CUP_YEAR) : [],
    });
  }
  const payload = await fetchJson(
    `${ESPN_STANDINGS_BASE_URL}/${leagueCode}/standings`,
  );
  return normalizeEspnStandings(payload);
}

async function refreshMatchDetail(eventId, leagueCode, cache, cacheKey) {
  const payload = await fetchJson(
    `${ESPN_SUMMARY_BASE_URL}/${leagueCode}/summary?event=${eventId}`,
  );
  if (leagueCode === FIFA_WORLD_CUP_LEAGUE_CODE && !isWorldCup2030Event(payload?.header)) {
    throw new Error("World Cup match summary is not from the 2030 tournament");
  }
  const data = normalizeEspnMatchDetail(payload, { eventId, leagueCode });
  const response = jsonResponse(data, {
    cache: "MISS",
    source: "espn-summary",
    cacheControl: `public, max-age=${MATCH_DETAIL_CACHE_TTL_SECONDS}`,
  });

  try {
    await cache.put(cacheKey, response.clone());
  } catch (error) {
    console.warn(`Match detail cache put failed: ${getErrorMessage(error)}`);
  }

  return response;
}

async function refreshTournamentBracket(leagueCode, cache, cacheKey) {
  const payload = await fetchFutureWorldCupJson(
    `${ESPN_SUMMARY_BASE_URL}/${leagueCode}/scoreboard?dates=${FIFA_WORLD_CUP_DATES}&season=${FIFA_WORLD_CUP_YEAR}`,
  );
  const data = normalizeTournamentBracket(payload, leagueCode);
  rememberKnownBracketRounds(data.rounds);
  await persistKnownMatches(cache, data.rounds.flatMap((round) => round.matches || []));
  const response = jsonResponse(data, {
    cache: "MISS",
    source: "espn-tournament-bracket",
    cacheControl: `public, max-age=${TOURNAMENT_BRACKET_CACHE_TTL_SECONDS}`,
  });

  try {
    await cache.put(cacheKey, response.clone());
  } catch (error) {
    console.warn(`Tournament bracket cache put failed: ${getErrorMessage(error)}`);
  }

  return response;
}

export {
  handleLiveMatchesRequest,
  handleMatchDetailRequest,
  handleLeagueStandingsRequest,
  handleTournamentBracketRequest,
};
