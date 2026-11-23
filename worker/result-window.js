const RECENT_RESULT_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;
const LAST_RESULT_WINDOW_MS = 2 * RECENT_RESULT_WINDOW_MS;

function getScoreboardLeagueKey(match) {
  return match.leagueCode || match.leagueId || match.league || "unknown";
}

function isWithinLastResultWindow(kickoff, now) {
  return kickoff >= now - LAST_RESULT_WINDOW_MS && kickoff <= now;
}

function filterScoreboardResults(matches, now = Date.now()) {
  const recentLeagues = new Set();
  const selected = new Set();
  const lastByLeague = new Map();
  for (const match of matches) {
    if (match?.state !== "finished") continue;
    const kickoff = Date.parse(match.kickoff || "");
    if (!isWithinLastResultWindow(kickoff, now)) continue;

    const key = getScoreboardLeagueKey(match);
    if (kickoff >= now - RECENT_RESULT_WINDOW_MS) {
      recentLeagues.add(key);
      selected.add(match);
    } else {
      const last = lastByLeague.get(key);
      if (!last || kickoff > last.kickoff || (kickoff === last.kickoff && String(match.id) < String(last.match.id))) {
        lastByLeague.set(key, { match, kickoff });
      }
    }
  }
  for (const [key, last] of lastByLeague) {
    if (!recentLeagues.has(key)) selected.add(last.match);
  }
  return matches.filter((match) => match?.state !== "finished" || selected.has(match));
}

export {
  LAST_RESULT_WINDOW_MS,
  filterScoreboardResults,
  getScoreboardLeagueKey,
  isWithinLastResultWindow,
};
