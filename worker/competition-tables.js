import {
  FIFA_WORLD_CUP_LEAGUE_CODE,
  FIFA_WORLD_CUP_YEAR,
  FIFA_WORLD_CUP_DATES,
  getEspnTeamName,
  getEspnTeamId,
  getEspnTeamLogo,
  toNumber,
  formatVenue,
  formatLeagueName,
  getTeamLogoFromTeam,
} from "./football-metadata.js";
import {
  isWorldCup2030Event,
  formatEspnMinute,
  formatEspnStatus,
  getEspnMatchState,
} from "./scoreboard.js";

function normalizeTournamentBracket(payload, leagueCode) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const roundsBySlug = new Map();

  for (const event of events) {
    if (leagueCode === FIFA_WORLD_CUP_LEAGUE_CODE && !isWorldCup2030Event(event)) continue;
    const match = normalizeTournamentBracketMatch(event, leagueCode);
    if (!match) {
      continue;
    }

    if (!roundsBySlug.has(match.roundSlug)) {
      roundsBySlug.set(match.roundSlug, {
        slug: match.roundSlug,
        name: formatTournamentRoundName(match.roundSlug),
        order: getTournamentRoundOrder(match.roundSlug),
        matches: [],
      });
    }

    roundsBySlug.get(match.roundSlug).matches.push(match);
  }

  const rounds = [...roundsBySlug.values()]
    .map((round) => ({
      slug: round.slug,
      name: round.name,
      matches: round.matches.sort(compareTournamentMatches),
    }))
    .sort((a, b) => getTournamentRoundOrder(a.slug) - getTournamentRoundOrder(b.slug));

  return {
    leagueCode,
    seasonYear: FIFA_WORLD_CUP_YEAR,
    dates: FIFA_WORLD_CUP_DATES,
    rounds,
  };
}

function normalizeTournamentBracketMatch(event, leagueCode) {
  const competition = Array.isArray(event?.competitions)
    ? event.competitions[0]
    : null;
  const competitors = Array.isArray(competition?.competitors)
    ? competition.competitors
    : [];
  const home = competitors.find((team) => team?.homeAway === "home") || competitors.filter(Boolean)[0];
  const away = competitors.find((team) => team?.homeAway === "away") || competitors.filter(Boolean)[1];

  if (!competition || !home || !away) {
    return null;
  }

  const status = competition.status || event.status || {};
  const roundSlug = normalizeTournamentRoundSlug(event?.season?.slug);

  return {
    id: String(event.id || competition.id || ""),
    leagueCode,
    roundSlug,
    seasonYear: FIFA_WORLD_CUP_YEAR,
    roundName: formatTournamentRoundName(roundSlug),
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
}

function normalizeTournamentRoundSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  return slug || "other";
}

function formatTournamentRoundName(slug) {
  const names = {
    "round-of-32": "Round of 32",
    "round-of-16": "Round of 16",
    quarterfinals: "Quarter-finals",
    semifinals: "Semi-finals",
    "3rd-place-match": "Third-place match",
    final: "Final",
  };

  return names[slug] || formatLeagueName(slug);
}

function getTournamentRoundOrder(slug) {
  const order = {
    "round-of-32": 10,
    "round-of-16": 20,
    quarterfinals: 30,
    semifinals: 40,
    "3rd-place-match": 50,
    final: 60,
  };

  return order[slug] || 999;
}

function compareTournamentMatches(a, b) {
  const dateDiff = Date.parse(a.kickoff || "") - Date.parse(b.kickoff || "");
  if (Number.isFinite(dateDiff) && dateDiff !== 0) {
    return dateDiff;
  }

  return a.homeTeam.localeCompare(b.homeTeam);
}

function normalizeEspnStandings(payload) {
  const rows = getEspnStandingRows(payload);

  if (!Array.isArray(rows)) {
    return [];
  }

  /* OPT-04: build stat Map once per entry instead of repeated Array.find */
  return rows.map(({ entry, group, groupOrder, fallbackPosition }) => {
    const statMap = new Map();
    if (Array.isArray(entry.stats)) {
      for (const stat of entry.stats) {
        if (stat?.name) statMap.set(stat.name, stat);
      }
    }

    const getStat = (names, preferDisplay = false) => {
      for (const name of Array.isArray(names) ? names : [names]) {
        const stat = statMap.get(name);
        if (stat) {
          return preferDisplay ? stat.displayValue ?? stat.value : stat.value ?? stat.displayValue;
        }
      }
      return "";
    };

    return {
      position: toNumber(getStat("rank")) || fallbackPosition,
      zone: normalizeStandingZone(entry.note),
      group,
      groupOrder,
      abbreviation: entry.team?.abbreviation || "",
      logo: getTeamLogoFromTeam(entry.team),
      team:
        entry.team?.shortDisplayName ||
        entry.team?.displayName ||
        entry.team?.name ||
        "Unknown Team",
      played: toNumber(getStat("gamesPlayed")),
      wins: toNumber(getStat("wins")),
      draws: toNumber(getStat("ties")),
      losses: toNumber(getStat("losses")),
      goalsFor: toNumber(getStat(["pointsFor", "goalsFor"])),
      goalsAgainst: toNumber(getStat(["pointsAgainst", "goalsAgainst"])),
      goalDifference: String(getStat("pointDifferential", true) || "0"),
      points: toNumber(getStat("points")),
      pointsPerGame: String(getStat("ppg", true) || ""),
      deductions: toNumber(getStat("deductions")),
      overall: String(getStat("overall", true) || ""),
    };
  }).sort(compareStandingRows);
}

function normalizeStandingZone(note) {
  if (!note || typeof note !== "object" || Array.isArray(note) || typeof note.description !== "string") return null;
  const description = note.description.trim().replace(/\s+/g, " ");
  if (!description || description.length > 120) return null;
  if (/^eliminated$/i.test(description)) {
    return { kind: "elimination", phase: "direct", description };
  }
  if (/^relegat(?:ion|ed)$/i.test(description)) {
    return { kind: "relegation", phase: "direct", description };
  }
  if (/^relegation play-?offs?$/i.test(description)) {
    return { kind: "relegation", phase: "playoff", description };
  }
  const match = description.match(/^(?:UEFA )?(Champions League|Europa League|(?:Europa )?Conference League)( qualifying)?$/i);
  if (!match) return null;
  const competition = match[1].toLowerCase();
  const kind = competition === "champions league" ? "champions-league" :
    competition === "europa league" ? "europa-league" : "conference-league";
  return { kind, phase: match[2] ? "qualifying" : "direct", description };
}

function getEspnStandingRows(payload) {
  const rows = [];
  const appendEntries = (entries, group, groupOrder) => {
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") return;
      rows.push({
        entry,
        group,
        groupOrder,
        fallbackPosition: index + 1,
      });
    });
  };

  if (Array.isArray(payload?.standings?.entries)) {
    appendEntries(payload.standings.entries, payload.standings.name || "", 0);
  }

  if (Array.isArray(payload?.children)) {
    payload.children.forEach((child, index) => {
      if (Array.isArray(child?.standings?.entries)) {
        appendEntries(
          child.standings.entries,
          child.displayName || child.name || child.abbreviation || "",
          index,
        );
      }
    });
  }

  return rows;
}

function compareStandingRows(a, b) {
  const groupDiff = a.groupOrder - b.groupOrder;

  if (groupDiff !== 0) {
    return groupDiff;
  }

  const positionDiff = a.position - b.position;

  if (positionDiff !== 0) {
    return positionDiff;
  }

  const pointsDiff = b.points - a.points;

  if (pointsDiff !== 0) {
    return pointsDiff;
  }

  return a.team.localeCompare(b.team);
}

export { normalizeEspnStandings, normalizeTournamentBracket };
