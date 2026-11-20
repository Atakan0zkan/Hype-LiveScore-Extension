import { formatEspnMinute, formatEspnStatus, getEspnMatchState } from "./scoreboard.js";
import {
  formatVenue,
  getEspnTeamId,
  getEspnTeamName,
  getEspnTeamLogo,
  toNumber,
  getTeamLogoFromTeam,
  ESPN_LINK_HOST_SUFFIXES,
  ESPN_MEDIA_HOST_SUFFIXES,
} from "./football-metadata.js";
import { safeHttpsUrl } from "./http.js";
import { isSafeEventId } from "./match-cache.js";

function normalizeEspnMatchDetail(payload, context) {
  const header = payload?.header || {};
  const competition = Array.isArray(header.competitions)
    ? header.competitions[0]
    : {};
  const competitors = Array.isArray(competition?.competitors)
    ? competition.competitors
    : [];
  const home = competitors.find((team) => team.homeAway === "home");
  const away = competitors.find((team) => team.homeAway === "away");
  const status = competition?.status || header?.status || {};

  return {
    id: String(header.id || context.eventId),
    leagueCode: context.leagueCode,
    title: buildMatchTitle(home, away),
    minute: formatEspnMinute(status),
    status: formatEspnStatus(status),
    state: getEspnMatchState(status),
    kickoff: header.date || competition?.date || null,
    venue: formatVenue(payload?.gameInfo?.venue || competition?.venue),
    broadcasts: normalizeBroadcasts(payload?.broadcasts || competition?.broadcasts),
    teams: {
      home: normalizeDetailTeam(home),
      away: normalizeDetailTeam(away),
    },
    timeline: normalizeTimeline(
      payload?.keyEvents,
      competition?.details || payload?.details,
    ),
    stats: normalizeMatchStats(payload, home, away),
    lineups: normalizeLineups(payload),
    headToHead: normalizeHeadToHead(payload?.headToHeadGames),
    news: normalizeNews(payload?.news),
    videos: normalizeVideos(payload?.videos),
    links: normalizeLinks(
      [
        ...(Array.isArray(header?.links) ? header.links : []),
        ...(Array.isArray(competition?.links) ? competition.links : []),
      ],
      context.eventId,
    ),
  };
}

function normalizeDetailTeam(competitor) {
  return {
    id: getEspnTeamId(competitor || {}),
    name: getEspnTeamName(competitor || {}),
    shortName:
      competitor?.team?.shortDisplayName ||
      competitor?.team?.abbreviation ||
      getEspnTeamName(competitor || {}),
    logo: getEspnTeamLogo(competitor || {}),
    score: toNumber(competitor?.score),
    record: getTeamRecord(competitor),
  };
}

function buildMatchTitle(home, away) {
  const homeName = home ? getEspnTeamName(home) : "Home";
  const awayName = away ? getEspnTeamName(away) : "Away";
  return `${homeName} vs ${awayName}`;
}

function getTeamRecord(competitor) {
  if (!Array.isArray(competitor?.records)) {
    return "";
  }

  const record = competitor.records.find((row) => row.summary) || competitor.records[0];
  return record?.summary || "";
}

function normalizeBroadcasts(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row) => (Array.isArray(row?.names) ? row.names.join(", ") : "") || row?.name || row?.shortName || "")
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeTimeline(keyEvents, detailEvents) {
  const rows = Array.isArray(keyEvents) && keyEvents.length > 0
    ? keyEvents
    : Array.isArray(detailEvents)
      ? detailEvents
      : [];

  return rows
    .filter((row) => row && typeof row === "object")
    .map((event, index) => ({
      id: String(event.id || event.sequenceNumber || index),
      minute: getEventMinute(event),
      type: getEventType(event),
      kind: typeof event?.type?.type === "string" ? event.type.type.slice(0, 60) : "",
      text: getEventText(event),
      team: getEventTeam(event),
      players: getEventPlayers(event),
    }))
    .filter((event) => event.text || event.type || event.players.length > 0)
    .slice(0, 120);
}

function getEventMinute(event) {
  const candidates = [
    event?.clock?.displayValue,
    event?.time?.displayValue,
    event?.displayTime,
    event?.shortDisplayTime,
    event?.minute,
  ];
  const value = candidates.find((item) => item !== undefined && item !== null && item !== "");

  if (typeof value === "number") {
    return `${Math.floor(value)}'`;
  }

  return value ? String(value) : "";
}

function getEventType(event) {
  return (
    event?.type?.text ||
    event?.type?.displayName ||
    event?.type?.name ||
    event?.type?.abbreviation ||
    event?.scoringType?.displayName ||
    ""
  );
}

function getEventText(event) {
  return (
    event?.text ||
    event?.displayName ||
    event?.description ||
    event?.headline ||
    getEventType(event)
  );
}

function getEventTeam(event) {
  return (
    event?.team?.shortDisplayName ||
    event?.team?.displayName ||
    event?.team?.name ||
    event?.competitor?.team?.shortDisplayName ||
    event?.competitor?.team?.displayName ||
    ""
  );
}

function getEventPlayers(event) {
  const rows = [
    ...(Array.isArray(event?.participants) ? event.participants : []),
    ...(Array.isArray(event?.athletes) ? event.athletes : []),
  ];
  const names = new Set();

  for (const row of rows) {
    const name =
      row?.athlete?.displayName ||
      row?.athlete?.shortName ||
      row?.displayName ||
      row?.shortName ||
      row?.name;
    if (name) {
      names.add(name);
    }
  }

  return [...names].slice(0, 4);
}

function normalizeMatchStats(payload, homeCompetitor, awayCompetitor) {
  const teams = Array.isArray(payload?.boxscore?.teams)
    ? payload.boxscore.teams
    : [];

  if (teams.length === 0) {
    return [];
  }

  const homeTeam = findBoxscoreTeam(teams, homeCompetitor, "home", 0);
  const awayTeam = findBoxscoreTeam(teams, awayCompetitor, "away", 1);
  const homeStats = buildBoxscoreStatMap(homeTeam?.statistics);
  const awayStats = buildBoxscoreStatMap(awayTeam?.statistics);
  const names = getOrderedStatNames(homeStats, awayStats);

  return names
    .map((name) => {
      const homeStat = homeStats.get(name);
      const awayStat = awayStats.get(name);
      return {
        name,
        label: getStatLabel(homeStat || awayStat, name),
        homeValue: formatStatValue(homeStat, name),
        awayValue: formatStatValue(awayStat, name),
        homeNumeric: parseStatNumeric(homeStat),
        awayNumeric: parseStatNumeric(awayStat),
      };
    })
    .filter((stat) => stat.homeValue || stat.awayValue)
    .slice(0, 18);
}

function findBoxscoreTeam(teams, competitor, homeAway, fallbackIndex) {
  const competitorId = getEspnTeamId(competitor || {});
  return (
    teams.find((team) => team?.homeAway === homeAway) ||
    teams.find((team) => competitorId && String(team?.team?.id) === competitorId) ||
    teams[fallbackIndex] ||
    null
  );
}

function buildBoxscoreStatMap(rows) {
  const map = new Map();

  if (!Array.isArray(rows)) {
    return map;
  }

  for (const row of rows) {
    if (row?.name) {
      map.set(row.name, row);
    }
  }

  return map;
}

function getOrderedStatNames(homeStats, awayStats) {
  const preferred = [
    "possessionPct",
    "totalShots",
    "shotsOnTarget",
    "wonCorners",
    "foulsCommitted",
    "yellowCards",
    "redCards",
    "offsides",
    "saves",
    "totalPasses",
    "accuratePasses",
    "passPct",
    "blockedShots",
    "totalTackles",
    "interceptions",
    "totalClearance",
  ];
  const names = new Set([...homeStats.keys(), ...awayStats.keys()]);
  const ordered = preferred.filter((name) => names.has(name));

  for (const name of names) {
    if (!ordered.includes(name)) {
      ordered.push(name);
    }
  }

  return ordered;
}

function getStatLabel(stat, name) {
  const labels = {
    accuratePasses: "Accurate Passes",
    blockedShots: "Blocked Shots",
    foulsCommitted: "Fouls",
    interceptions: "Interceptions",
    offsides: "Offsides",
    passPct: "Pass Completion",
    possessionPct: "Possession",
    redCards: "Red Cards",
    saves: "Saves",
    shotsOnTarget: "Shots On Target",
    totalClearance: "Clearances",
    totalPasses: "Passes",
    totalShots: "Shots",
    totalTackles: "Tackles",
    wonCorners: "Corners",
    yellowCards: "Yellow Cards",
  };

  return labels[name] || titleCaseStatLabel(stat?.label || name);
}

function titleCaseStatLabel(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/Pct\b/i, "%")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatStatValue(stat, name) {
  if (!stat) {
    return "";
  }

  const raw = stat.displayValue ?? stat.value ?? "";
  const number = Number(raw);

  if (/Pct$/.test(name) && Number.isFinite(number)) {
    const percent = number <= 1 ? number * 100 : number;
    return `${roundStatNumber(percent)}%`;
  }

  return String(raw);
}

function parseStatNumeric(stat) {
  if (!stat) {
    return null;
  }

  const raw = stat.value ?? stat.displayValue;
  const number = Number(String(raw).replace("%", ""));
  return Number.isFinite(number) ? number : null;
}

function roundStatNumber(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return String(Math.round(value * 10) / 10);
}

function normalizeLineups(payload) {
  const rosterGroups = Array.isArray(payload?.rosters)
    ? payload.rosters
    : Array.isArray(payload?.boxscore?.players)
      ? payload.boxscore.players
      : [];

  return rosterGroups
    .map((group) => {
      const players = getRosterPlayers(group)
        .map(normalizeRosterPlayer)
        .filter((player) => player.name)
        .sort(compareRosterPlayers)
        .slice(0, 40);

      return {
        team:
          group?.team?.shortDisplayName ||
          group?.team?.displayName ||
          group?.team?.name ||
          "Team",
        logo: getTeamLogoFromTeam(group?.team),
        homeAway: group?.homeAway === "home" ? "home" : group?.homeAway === "away" ? "away" : "",
        formation: /^\d(?:-\d){1,4}$/.test(group?.formation || "") ? group.formation : "",
        players,
      };
    })
    .filter((group) => group.players.length > 0)
    .slice(0, 2);
}

function getRosterPlayers(group) {
  if (Array.isArray(group?.roster)) {
    return group.roster;
  }

  if (Array.isArray(group?.players)) {
    return group.players;
  }

  if (Array.isArray(group?.statistics)) {
    return group.statistics.flatMap((stat) =>
      Array.isArray(stat?.athletes) ? stat.athletes : [],
    );
  }

  return [];
}

function normalizeRosterPlayer(row) {
  const athlete = row?.athlete || row;
  const position = row?.position || athlete?.position || {};

  return {
    id: athlete?.id ? String(athlete.id) : "",
    name: athlete?.displayName || athlete?.shortName || athlete?.name || "",
    shortName: athlete?.shortName || athlete?.displayName || athlete?.name || "",
    position:
      position?.abbreviation ||
      position?.displayName ||
      position?.name ||
      (typeof position === "string" ? position : ""),
    jersey: athlete?.jersey || row?.jersey || "",
    starter: row?.starter === true || row?.didStart === true,
    goals: getRosterMatchCount(row, "totalGoals", 20),
    yellowCards: getRosterMatchCount(row, "yellowCards", 2),
    redCards: getRosterMatchCount(row, "redCards", 1),
  };
}

function getRosterMatchCount(row, name, maximum) {
  // Only match-roster stats, never athlete season/career totals or shootouts.
  const stat = Array.isArray(row?.stats) ? row.stats.find((item) => item?.name === name) : null;
  const value = stat?.value ?? stat?.displayValue;
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return 0;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 && count <= maximum ? count : 0;
}

function compareRosterPlayers(a, b) {
  if (a.starter !== b.starter) {
    return a.starter ? -1 : 1;
  }

  return a.name.localeCompare(b.name);
}

function normalizeHeadToHead(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((event) => {
      const competition = Array.isArray(event?.competitions)
        ? event.competitions[0]
        : {};
      const competitors = Array.isArray(competition?.competitors)
        ? competition.competitors
        : [];
      const home = competitors.find((team) => team.homeAway === "home");
      const away = competitors.find((team) => team.homeAway === "away");

      return {
        id: String(event?.id || competition?.id || ""),
        date: event?.date || competition?.date || null,
        homeTeam: home ? getEspnTeamName(home) : "",
        awayTeam: away ? getEspnTeamName(away) : "",
        homeScore: toNumber(home?.score),
        awayScore: toNumber(away?.score),
        status: formatEspnStatus(competition?.status || event?.status || {}),
      };
    })
    .filter((event) => event.homeTeam && event.awayTeam)
    .slice(0, 5);
}

function normalizeNews(news) {
  const articles = Array.isArray(news?.articles)
    ? news.articles
    : Array.isArray(news)
      ? news
      : [];

  return articles
    .map((article) => ({
      title: article?.headline || article?.title || "",
      description: article?.description || "",
      url: safeHttpsUrl(
        article?.links?.web?.href || article?.link || article?.url,
        ESPN_LINK_HOST_SUFFIXES,
      ),
    }))
    .filter((article) => article.title)
    .slice(0, 4);
}

function normalizeVideos(videos) {
  if (!Array.isArray(videos)) {
    return [];
  }

  return videos
    .map((video) => ({
      title: video?.headline || video?.title || "",
      duration: video?.duration || "",
      thumbnail: safeHttpsUrl(
        video?.thumbnail ||
          video?.images?.[0]?.url ||
          video?.links?.thumbnail?.href,
        ESPN_MEDIA_HOST_SUFFIXES,
      ),
      url: safeHttpsUrl(
        video?.links?.web?.href || video?.link || video?.url,
        ESPN_LINK_HOST_SUFFIXES,
      ),
    }))
    .filter((video) => video.title)
    .slice(0, 4);
}

function normalizeLinks(links, eventId = "") {
  const seen = new Set();
  const normalized = links
    .map((link) => ({
      label: link?.text || link?.shortText || link?.rel?.[0] || "Open",
      url: safeHttpsUrl(link?.href, ESPN_LINK_HOST_SUFFIXES),
    }))
    .filter((link) => {
      if (!link.url || seen.has(link.url)) {
        return false;
      }
      seen.add(link.url);
      return true;
    })
    .slice(0, 6);

  if (normalized.length > 0) {
    return normalized;
  }

  if (!isSafeEventId(String(eventId))) {
    return [];
  }

  return [
    {
      label: "ESPN Match Center",
      url: `https://www.espn.com/soccer/match/_/gameId/${eventId}`,
    },
  ];
}

export { normalizeEspnMatchDetail };
