import { getErrorMessage } from "./http.js";
import {
  fetchJson,
  THESPORTSDB_LIVE_SCORE_URL,
  ESPN_SCOREBOARD_URL,
  ESPN_SUMMARY_BASE_URL,
  ESPN_SCOREBOARD_EVENT_LIMIT,
} from "./upstream.js";
import {
  getPayloadLeagueMetadata,
  FIFA_WORLD_CUP_YEAR,
  extractLeagueId,
  getLeagueMetadata,
  isSupportedLeagueCode,
  FIFA_WORLD_CUP_LEAGUE_CODE,
  getEspnTeamName,
  getEspnTeamId,
  getEspnTeamLogo,
  toNumber,
  formatVenue,
  ESPN_LEAGUES_BY_ID,
  buildLeagueLogoUrl,
} from "./football-metadata.js";
import { getEventKey, isSafeEventId } from "./match-cache.js";

const UPCOMING_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

const EXTRA_ESPN_SCOREBOARD_LEAGUES = [
  "uefa.europa.conf",
  "uefa.nations",
  "uefa.euro",
  "conmebol.america",
];

async function getLiveMatches(env) {
  try {
    const espnPayloads = await fetchEspnScoreboardPayloads();
    return {
      matches: normalizeEspnMatchPayloads(espnPayloads),
      source: "espn",
    };
  } catch (espnError) {
    if (!env.THESPORTSDB_API_KEY) {
      throw new Error(
        `ESPN request failed and THESPORTSDB_API_KEY is not configured: ${getErrorMessage(
          espnError,
        )}`,
      );
    }

    const sportsDbPayload = await fetchJson(THESPORTSDB_LIVE_SCORE_URL, {
      headers: {
        "X-API-KEY": env.THESPORTSDB_API_KEY,
      },
    });

    return {
      matches: normalizeSportsDbMatches(sportsDbPayload),
      source: "thesportsdb",
    };
  }
}

async function fetchEspnScoreboardPayloads() {
  const [primaryResult, ...extraResults] = await Promise.allSettled([
    fetchJson(ESPN_SCOREBOARD_URL, {}, validateEspnScoreboard),
    ...EXTRA_ESPN_SCOREBOARD_LEAGUES.map((leagueCode) =>
      fetchJson(`${ESPN_SUMMARY_BASE_URL}/${leagueCode}/scoreboard?limit=${ESPN_SCOREBOARD_EVENT_LIMIT}`, {}, validateEspnScoreboard),
    ),
  ]);

  if (primaryResult.status === "rejected") {
    throw primaryResult.reason;
  }

  const payloads = [primaryResult.value];

  for (const result of extraResults) {
    if (result.status === "fulfilled") {
      payloads.push(result.value);
    } else {
      console.warn(
        `Extra ESPN scoreboard failed: ${getErrorMessage(result.reason)}`,
      );
    }
  }

  return payloads;
}

function validateEspnScoreboard(payload) {
  if (!payload || !Array.isArray(payload.events)) {
    throw new Error("ESPN scoreboard events must be an array");
  }
  // A full page is not proof that the provider returned the complete list.
  // Reject it rather than silently replacing a good snapshot with partial data.
  if (payload.events.length >= ESPN_SCOREBOARD_EVENT_LIMIT) {
    throw new Error("ESPN scoreboard reached its event limit and may be truncated");
  }
}

function normalizeEspnMatchPayloads(payloads) {
  const matchesByKey = new Map();

  for (const payload of payloads) {
    const directLeagueCode = getPayloadLeagueMetadata(payload)?.code;
    for (const match of normalizeEspnMatches(payload)) {
      const key = getEventKey(match.id, match.leagueCode);
      if (!matchesByKey.has(key) || directLeagueCode === match.leagueCode) {
        matchesByKey.set(key, match);
      }
    }
  }

  return [...matchesByKey.values()];
}

function isWorldCup2030Event(event) {
  if (!event || typeof event !== "object") return false;
  const competition = event.competitions?.[0];
  const year = event.season?.year;
  if (year != null && Number(year) !== FIFA_WORLD_CUP_YEAR) return false;
  const kickoff = event.date || competition?.date;
  if (!kickoff) return Number(year) === FIFA_WORLD_CUP_YEAR;
  const date = new Date(kickoff);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === FIFA_WORLD_CUP_YEAR;
}

function normalizeEspnMatches(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const payloadLeague = getPayloadLeagueMetadata(payload);

  return events
    .filter((event) => event && typeof event === "object")
    .map((event) => {
      const competition = Array.isArray(event.competitions)
        ? event.competitions[0]
        : null;
      const competitors = Array.isArray(competition?.competitors)
        ? competition.competitors
        : [];
      const home = competitors.find((team) => team?.homeAway === "home");
      const away = competitors.find((team) => team?.homeAway === "away");

      if (!competition || !home || !away) {
        return null;
      }
      const rawId = event.id || competition.id;
      if (typeof rawId !== "string" && typeof rawId !== "number") return null;
      const id = String(rawId);
      if (!isSafeEventId(id)) return null;

      const status = competition.status || event.status || {};
      const leagueId = extractLeagueId(event.uid) || payloadLeague?.id || "";
      const league = getLeagueMetadata(leagueId, event.season?.slug, payloadLeague);

      /* Skip leagues not in our curated map */
      if (!league.code || !isSupportedLeagueCode(league.code)) {
        return null;
      }
      if (league.code === FIFA_WORLD_CUP_LEAGUE_CODE && !isWorldCup2030Event(event)) return null;

      return {
        id,
        leagueId: league.id || leagueId || league.code,
        leagueCode: league.code,
        league: league.name,
        leagueLogoId: league.logoId || null,
        leagueLogoStyle: league.logoStyle || "default",
        leagueLogoUrl: league.logoUrl || null,
        leagueLogoTone: league.logoTone || "dark",
        homeTeam: getEspnTeamName(home),
        awayTeam: getEspnTeamName(away),
        homeTeamId: getEspnTeamId(home),
        awayTeamId: getEspnTeamId(away),
        homeLogo: getEspnTeamLogo(home),
        awayLogo: getEspnTeamLogo(away),
        homeScore: toNumber(home.score),
        awayScore: toNumber(away.score),
        minute: formatEspnMinute(status),
        status: formatEspnStatus(status),
        state: getEspnMatchState(status),
        kickoff: event.date || competition.date || null,
        venue: formatVenue(competition.venue),
      };
    })
    .filter(Boolean)
    .filter(isRelevantMatch);
}

function normalizeSportsDbMatches(payload) {
  const rows =
    payload?.livescores ||
    payload?.events ||
    payload?.event ||
    payload?.results ||
    payload?.livescore ||
    [];
  const events = Array.isArray(rows) ? rows : [];

  return events
    .map((event) => ({
      id: String(event.idEvent || event.idLiveScore || event.id || ""),
      leagueId: String(event.idLeague || event.leagueId || event.strLeague || ""),
      leagueCode: null,
      league: event.strLeague || event.league || "Unknown League",
      leagueLogoTone: "dark",
      homeTeam: event.strHomeTeam || event.strHomeModel || event.homeTeam || "Home",
      awayTeam: event.strAwayTeam || event.strAwayModel || event.awayTeam || "Away",
      homeScore: toNumber(event.intHomeScore || event.homeScore),
      awayScore: toNumber(event.intAwayScore || event.awayScore),
      minute: formatSportsDbMinute(event),
      status: event.strStatus || event.strProgress || event.status || "Unknown",
      state: getSportsDbMatchState(event),
      kickoff: event.dateEvent || event.strTimestamp || event.date || null,
    }))
    .filter(isRelevantMatch);
}

function compareLeagues(a, b) {
  const liveDiff = countLiveMatches(b.matches) - countLiveMatches(a.matches);

  if (liveDiff !== 0) {
    return liveDiff;
  }

  return a.name.localeCompare(b.name);
}

function compareMatches(a, b) {
  return getMatchStateRank(a.state) - getMatchStateRank(b.state);
}

function countLiveMatches(matches) {
  return matches.filter((match) => match.state === "live").length;
}

function isRelevantMatch(match) {
  if (match?.leagueCode === FIFA_WORLD_CUP_LEAGUE_CODE &&
      new Date(match.kickoff).getUTCFullYear() !== FIFA_WORLD_CUP_YEAR) return false;
  if (!match || match.state !== "scheduled") {
    return Boolean(match);
  }

  const kickoffTime = Date.parse(match.kickoff || "");
  if (!Number.isFinite(kickoffTime)) {
    return false;
  }

  const now = Date.now();
  return (
    kickoffTime >= now - 60 * 60 * 1000 &&
    kickoffTime <= now + UPCOMING_MATCH_WINDOW_MS
  );
}

function getMatchStateRank(state) {
  if (state === "live") {
    return 0;
  }

  if (state === "scheduled") {
    return 1;
  }

  if (state === "finished") {
    return 2;
  }

  return 3;
}

function groupMatchesByLeague(matches) {
  const groups = new Map(
    Object.entries(ESPN_LEAGUES_BY_ID).map(([id, league]) => [
      league.code || id,
      {
        id,
        code: league.code || null,
        name: league.name,
        logo:
          league.logoUrl ||
          buildLeagueLogoUrl(league.logoId, league.logoStyle || "default"),
        logoTone: league.logoTone || "dark",
        matches: [],
      },
    ]),
  );

  for (const match of matches) {
    const key = match.leagueCode || match.leagueId || match.league || "unknown";

    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        code: match.leagueCode || null,
        name: match.league || "Unknown League",
        logo:
          match.leagueLogoUrl ||
          buildLeagueLogoUrl(match.leagueLogoId, match.leagueLogoStyle),
        logoTone: match.leagueLogoTone || "dark",
        matches: [],
      });
    }

    groups.get(key).matches.push(match);
  }

  /* Sort: leagues with live matches first, then alphabetically */
  return [...groups.values()]
    .map((league) => ({
      ...league,
      matches: league.matches.sort(compareMatches),
    }))
    .sort(compareLeagues);
}

function formatEspnMinute(status) {
  const type = status.type || {};
  const state = type.state;
  const completed = type.completed;
  const description = type.description || "";
  const displayClock = status.displayClock || "";
  const shortDetail = type.shortDetail || "";

  if (completed) {
    return "FT";
  }

  if (state === "pre") {
    return "Scheduled";
  }

  if (/^\d/.test(shortDetail)) {
    return shortDetail;
  }

  if (displayClock && displayClock !== "0'") {
    return displayClock;
  }

  if (/half\s*time/i.test(description)) {
    return "HT";
  }

  if (typeof status.clock === "number" && status.clock > 0) {
    return `${Math.floor(status.clock)}'`;
  }

  return "Live";
}

function formatEspnStatus(status) {
  const type = status.type || {};
  const state = type.state;
  const description = type.description || "";

  if (type.completed || state === "post") {
    return "Full Time";
  }

  if (/half\s*time/i.test(description)) {
    return "Half Time";
  }

  if (state === "pre") {
    return "Scheduled";
  }

  if (state === "in") {
    return "Live";
  }

  return description || type.name || "Unknown";
}

function getEspnMatchState(status) {
  const type = status.type || {};

  if (type.completed || type.state === "post") {
    return "finished";
  }

  if (type.state === "pre") {
    return "scheduled";
  }

  if (type.state === "in") {
    return "live";
  }

  return "unknown";
}

function formatSportsDbMinute(event) {
  const progress = event.strProgress || event.strStatus || "";

  if (/final|finished|full time/i.test(progress)) {
    return "FT";
  }

  if (/half/i.test(progress)) {
    return "HT";
  }

  return progress || "Live";
}

function getSportsDbMatchState(event) {
  const progress = event.strProgress || event.strStatus || event.status || "";

  if (/final|finished|full time/i.test(progress)) {
    return "finished";
  }

  if (/not started|scheduled|fixture/i.test(progress)) {
    return "scheduled";
  }

  return "live";
}

export {
  countLiveMatches,
  getLiveMatches,
  groupMatchesByLeague,
  isWorldCup2030Event,
  formatEspnMinute,
  formatEspnStatus,
  getEspnMatchState,
};
