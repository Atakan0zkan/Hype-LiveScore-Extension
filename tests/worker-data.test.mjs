import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeEspnMatchDetail } from "../worker/match-detail.js";
import { loadWorkerContext } from "./helpers.mjs";

const eventId = "760488";
const leagueCode = "eng.1";
const kickoff = "2026-11-20T15:00:00Z";
const matchCenter = "https://www.espn.com/soccer/match/_/gameId/" + eventId;
const home = {
  homeAway: "home",
  score: "2",
  team: { id: "331", displayName: "Home FC", shortDisplayName: "Home" },
  records: [{}, { summary: "5-1-0" }],
};
const away = {
  homeAway: "away",
  score: "1",
  team: { id: "332", displayName: "Away FC", abbreviation: "AFC" },
};

test("Worker builds a complete match detail from an ESPN summary", () => {
  const competition = {
    date: kickoff,
    status: { type: { state: "post", completed: true } },
    competitors: [away, home],
    broadcasts: [{ names: ["Sports One", "Sports Two"] }, { shortName: "Local" }],
    details: [{ id: "goal", minute: 39, type: { text: "Goal", type: "goal" },
      participants: [{ athlete: { displayName: "Home Forward" } }, { displayName: "Home Forward" }],
      competitor: home }],
    links: [{ text: "Duplicate", href: matchCenter }, { text: "Other host", href: "https://example.org/match" }],
  };
  const result = normalizeEspnMatchDetail({
    header: { id: eventId, competitions: [competition], links: [{ shortText: "Match", href: matchCenter }] },
    gameInfo: { venue: { fullName: "Emirates Stadium", address: { city: "London" } } },
    boxscore: { teams: [
      { team: away.team, statistics: [{ name: "possessionPct", value: 0.3867 }, { name: "totalShots", displayValue: "10" }] },
      { team: home.team, statistics: [
        { name: "totalShots", value: 5 }, { name: "possessionPct", value: 0.6133 },
        { name: "dangerousAttacks", displayValue: "12" },
      ] },
    ] },
    headToHeadGames: [null, ...Array.from({ length: 6 }, (_, index) => ({
      id: 8000 + index,
      date: "2026-03-04T19:00:00Z",
      competitions: [competition],
    }))],
    news: { articles: [{ headline: "Match report", description: "A close game", links: { web: { href: matchCenter } } }, {}] },
    videos: [{ title: "Highlights", duration: 90, images: [{ url: "https://a.espncdn.com/highlight.png" }], url: matchCenter }],
  }, { eventId, leagueCode });

  assert.equal(result.title, "Home FC vs Away FC");
  assert.equal(result.kickoff, kickoff);
  assert.match(result.venue, /Emirates Stadium/);
  assert.deepEqual([result.state, result.status, result.minute], ["finished", "Full Time", "FT"]);
  assert.deepEqual([result.teams.home.record, result.teams.away.shortName], ["5-1-0", "AFC"]);
  assert.deepEqual(result.broadcasts, ["Sports One, Sports Two", "Local"]);
  assert.deepEqual(result.timeline.map(({ minute, type, team, players }) => ({ minute, type, team, players })), [
    { minute: "39'", type: "Goal", team: "Home", players: ["Home Forward"] },
  ]);
  assert.deepEqual(result.stats.map(({ label, homeValue, awayValue, awayNumeric }) => [label, homeValue, awayValue, awayNumeric]), [
    ["Possession", "61.3%", "38.7%", 0.3867],
    ["Shots", "5", "10", 10],
    ["Dangerous Attacks", "12", "", null],
  ]);
  assert.deepEqual(result.headToHead.map(({ id, homeScore, awayScore }) => [id, homeScore, awayScore]),
    Array.from({ length: 5 }, (_, index) => [String(8000 + index), 2, 1]));
  assert.deepEqual(result.news, [{ title: "Match report", description: "A close game", url: matchCenter }]);
  assert.deepEqual(result.videos, [{
    title: "Highlights", duration: 90, thumbnail: "https://a.espncdn.com/highlight.png", url: matchCenter,
  }]);
  assert.deepEqual(result.links, [{ label: "Match", url: matchCenter }]);
});

test("Worker accepts the alternate boxscore roster shape and supplies the public match link", () => {
  const result = normalizeEspnMatchDetail({
    boxscore: { players: [
      { team: home.team, homeAway: "home", formation: "4-3-3", statistics: [
        { athletes: [
          { id: "11", shortName: "Sub", position: "F" },
          { athlete: { id: "9", displayName: "Starter", jersey: "9" }, didStart: true, stats: [
            { name: "totalGoals", displayValue: "2" }, { name: "yellowCards", value: 1 },
          ] },
        ] },
      ] },
      { team: away.team, homeAway: "away", formation: "unknown", players: [{ name: "Visitor", starter: true }] },
    ] },
  }, { eventId, leagueCode });
  assert.deepEqual(result.lineups.map(({ formation, players }) => [formation, players.map(p => p.name)]), [
    ["4-3-3", ["Starter", "Sub"]], ["", ["Visitor"]],
  ]);
  const player = result.lineups[0].players[0];
  assert.deepEqual([player.id, player.jersey, player.goals, player.yellowCards, player.redCards], ["9", "9", 2, 1, 0]);
  assert.deepEqual(result.links, [{ label: "ESPN Match Center", url: matchCenter }]);
  assert.deepEqual(normalizeEspnMatchDetail({}, { eventId: "unknown", leagueCode }).links, []);
});

test("Worker uses the configured scoreboard fallback and filters far-away scheduled fixtures", async () => {
  const rows = [
    { idEvent: "1", strProgress: "Half Time", intHomeScore: 2, intAwayScore: 1 },
    { idEvent: "2", strStatus: "Full Time", intHomeScore: 0, intAwayScore: 2 },
    { idEvent: "3", strStatus: "Scheduled", dateEvent: new Date(Date.now() + 3600000).toISOString() },
    { idEvent: "4", strStatus: "Scheduled", dateEvent: new Date(Date.now() + 172800000).toISOString() },
    { idEvent: "5", strStatus: "Live" },
  ].map(row => ({ ...row, idLeague: "fixture", strLeague: "Fallback League", strHomeTeam: "Home", strAwayTeam: "Away" }));
  let fallbackRequests = 0;
  const { ctx, run } = await loadWorkerContext({ fetch: async (input, init) => {
    if (new URL(input).hostname === "www.thesportsdb.com") {
      fallbackRequests++;
      assert.equal(new Headers(init.headers).get("x-api-key"), "fixture-key");
      return Response.json({ livescores: rows });
    }
    return new Response("Unavailable", { status: 503 });
  } });
  const result = await run('getLiveMatches({ THESPORTSDB_API_KEY: "fixture-key" })');
  assert.equal(fallbackRequests, 1);
  assert.equal(result.source, "thesportsdb");
  assert.deepEqual(Array.from(result.matches, row => [row.id, row.state, row.minute]), [
    ["1", "live", "HT"], ["2", "finished", "FT"], ["3", "scheduled", "Scheduled"], ["5", "live", "Live"],
  ]);
  ctx.fallbackMatches = result.matches;
  const fallbackLeague = run('groupMatchesByLeague(fallbackMatches).find(league => league.id === "fixture")');
  assert.equal(fallbackLeague.name, "Fallback League");
  assert.deepEqual(Array.from(fallbackLeague.matches, row => row.state), ["live", "live", "scheduled", "finished"]);
});
