import assert from "node:assert/strict";
import { test } from "node:test";
import { domMatch, loadPopupDOM, workerJson } from "./dom-helpers.mjs";

const positions4411 = ["G", "RB", "LB", "CM-R", "CD-R", "CD-L", "RM", "CM-L", "F", "RCF", "LM"];
const settle = () => new Promise(setImmediate);

function slotLineup(team, homeAway) {
  return {
    team, homeAway, formation: "4-4-1-1",
    players: positions4411.map((position, i) => ({
      id: String(i + 1), name: `${team} Player ${i + 1}`, jersey: String(i + 11),
      position, formationPlace: i + 1, starter: true,
    })).reverse(),
  };
}

async function makePopup(t, fetchImpl = async () => workerJson({ matches: [], leagues: [] })) {
  const app = await loadPopupDOM({ fetchImpl });
  t.after(() => app.close());
  await settle();
  return app;
}

function showLeague(app, matches) {
  const leagues = [{ code: "eng.1", name: "Premier League", hasStandings: false, matches }];
  app.eval(`__T.lastPayload = ${JSON.stringify({ matches, leagues })}; __T.renderLast()`);
  app.document.querySelector(".league-pick-card").click();
}

test("provider formation places keep both XIs on the pitch when a position abbreviation changes", async t => {
  const app = await makePopup(t);
  const home = slotLineup("Home", "home");
  const away = slotLineup("Away", "away");
  home.players.find(p => p.formationPlace === 10).position = "UNRECOGNIZED";
  app.eval(`appendLineupsSection(${JSON.stringify([away, home])})`);
  assert.equal(app.document.querySelectorAll(".lineup-pitch .pitch-player").length, 22);
  const rows = [...app.document.querySelectorAll(".pitch-half--home .pitch-line")];
  assert.deepEqual(rows.map(row => row.children.length), [1, 4, 4, 1, 1]);
  assert.equal(rows[3].querySelector(".pitch-shirt").textContent, "20");
  assert.match(rows[3].textContent, /Player 10/);
  assert.deepEqual([...rows[1].querySelectorAll(".pitch-shirt")].map(el => el.textContent), ["13", "16", "15", "12"]);
});

test("duplicate formation places do not invent a position for an unknown role", async t => {
  const app = await makePopup(t);
  const home = slotLineup("Home", "home");
  const away = slotLineup("Away", "away");
  const secondStriker = home.players.find(p => p.formationPlace === 10);
  secondStriker.position = "UNRECOGNIZED";
  secondStriker.formationPlace = 9;
  app.eval(`appendLineupsSection(${JSON.stringify([home, away])})`);
  assert.equal(app.document.querySelector(".lineup-pitch"), null);
  assert.equal(app.document.querySelectorAll(".lineup-starters .lineup-player").length, 22);
});

for (const [reason, alterPlayers] of [
  ["duplicate player", players => { players[0].id = players[1].id; }],
  ["unconfirmed starter", players => { players[0].starter = "false"; }],
]) {
  test(`starting XI rejects a roster with: ${reason}`, async t => {
    const app = await makePopup(t);
    const home = slotLineup("Home", "home");
    const away = slotLineup("Away", "away");
    alterPlayers(home.players);
    app.eval(`appendLineupsSection(${JSON.stringify([home, away])})`);
    assert.equal(app.document.querySelectorAll(".lineup-pitch").length, 0);
  });
}

test("each verified provider formation uses all eleven places exactly once", async t => {
  const app = await makePopup(t);
  const entries = JSON.parse(app.eval("JSON.stringify([...ESPN_FORMATION_PLACES.entries()])"));
  assert.ok(entries.length > 0);
  for (const [formation, lines] of entries) {
    assert.deepEqual(lines.map(line => line.length), [1, ...formation.split("-").map(Number)], formation);
    assert.deepEqual(lines[0], [1], formation);
    assert.deepEqual(lines.flat().sort((a, b) => a - b), Array.from({ length: 11 }, (_, i) => i + 1), formation);
  }
});

test("reopening a live match refreshes newly published lineups after one minute, not on every visit", async t => {
  const app = await makePopup(t);
  app.eval("globalThis.popupClock = Date.now(); globalThis.Date = class extends Date { static now() { return popupClock; } }");
  const match = domMatch();
  const lineups = [slotLineup("Home", "home"), slotLineup("Away", "away")];
  let requests = 0;
  app.window.fetch = async () => workerJson({ id: match.id, lineups: ++requests < 2 ? [] : lineups });
  showLeague(app, [match]);
  const open = () => app.document.querySelector(".match-card").click();
  const back = () => app.document.getElementById("backBtn").click();

  open();
  await settle();
  assert.equal(app.document.querySelector(".lineup-pitch"), null);
  back();
  app.eval("popupClock += 30000");
  open();
  assert.equal(requests, 1);
  back();
  app.eval("popupClock += 35000");
  open();
  await settle();
  assert.equal(requests, 2);
  assert.equal(app.document.querySelectorAll(".lineup-pitch .pitch-player").length, 22);
});

test("a failed live detail refresh keeps the last XI and does not loop", async t => {
  const app = await makePopup(t);
  app.eval("globalThis.popupClock = Date.now(); globalThis.Date = class extends Date { static now() { return popupClock; } }");
  const match = domMatch();
  const lineups = [slotLineup("Home", "home"), slotLineup("Away", "away")];
  let requests = 0;
  app.window.fetch = async () => ++requests === 1
    ? workerJson({ id: match.id, lineups }) : new Response(null, { status: 502 });
  showLeague(app, [match]);
  app.document.querySelector(".match-card").click();
  await settle();
  app.document.getElementById("backBtn").click();
  app.eval("popupClock += 61000");
  app.document.querySelector(".match-card").click();
  await settle();
  assert.equal(requests, 2);
  assert.equal(app.document.querySelectorAll(".lineup-pitch .pitch-player").length, 22);
  app.eval("__T.renderLast()");
  assert.equal(requests, 2);
});

test("power off cancels an in-flight scoreboard and blocks new API calls", async t => {
  let requests = 0;
  let liveSignal;
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const app = await makePopup(t, async (_url, { signal }) => {
    requests++;
    liveSignal = signal;
    return requests === 1 ? pending : workerJson({ matches: [], leagues: [] });
  });
  try {
    assert.ok(liveSignal);
    app.document.getElementById("powerToggle").click();
    assert.equal(liveSignal.aborted, true);
    await assert.rejects(app.eval("fetchJsonWithTimeout(BACKEND_URL)"), { name: "AbortError" });
    assert.equal(requests, 1);
    resolve(workerJson({ matches: [domMatch()], leagues: [] }));
    await settle();
    assert.equal(app.eval("__T.lastPayload"), null);
    assert.ok(app.document.querySelector(".app-shell--disabled"));
  } finally {
    resolve(workerJson({ matches: [], leagues: [] }));
  }
});

test("a response that finishes after power is switched back on cannot overwrite the new scores", async t => {
  let requests = 0;
  let finishOldRequest;
  const oldRequest = new Promise(done => { finishOldRequest = done; });
  const fresh = { matches: [domMatch({ homeTeam: "Fresh Home" })], leagues: [] };
  const app = await makePopup(t, async () => ++requests === 1 ? oldRequest : workerJson(fresh));
  try {
    const power = app.document.getElementById("powerToggle");
    power.click();
    power.click();
    await settle();
    finishOldRequest(workerJson({ matches: [domMatch({ homeTeam: "Old Home" })], leagues: [] }));
    await settle();
    assert.equal(requests, 2);
    assert.equal(app.eval("__T.lastPayload.matches[0].homeTeam"), "Fresh Home");
  } finally {
    finishOldRequest(workerJson(fresh));
  }
});

test("a missing optional detail row cannot block valid stats, timeline, or links", async t => {
  const app = await makePopup(t);
  const detail = {
    stats: [null, { label: "Shots", homeValue: "2", awayValue: "1" }],
    timeline: [null, { type: "Goal", minute: "24'", text: "Home scores" }],
    headToHead: [null, { homeTeam: "Home", awayTeam: "Away", homeScore: 1, awayScore: 0 }],
    links: [null, { label: "Match", url: "https://www.espn.com/soccer/match/_/gameId/760486" }],
  };
  app.eval(`renderLoadedMatchDetail(${JSON.stringify(detail)})`);
  assert.equal(app.document.querySelector(".stat-label").textContent, "Shots");
  assert.equal(app.document.querySelector(".timeline-type").textContent, "Goal");
  assert.equal(app.document.querySelectorAll(".h2h-item").length, 1);
  assert.equal(app.document.querySelector(".link-list a").textContent, "Match");
});

test("an empty JSON document cannot be saved as a successful match detail", async t => {
  const app = await makePopup(t);
  app.window.fetch = async () => workerJson(null);
  const match = domMatch();
  await app.eval(`loadMatchDetail(${JSON.stringify(match)})`);
  assert.equal(app.eval(`__T.detailCache.get(getDetailCacheKey(${JSON.stringify(match)})).status`), "error");
});

test("popup API requests stay on the configured destination instead of following redirects", async t => {
  const seen = [];
  await makePopup(t, async (url, { redirect }) => {
    seen.push([new URL(url).origin, redirect]);
    return workerJson({ matches: [], leagues: [] });
  });
  assert.deepEqual(seen, [["https://api.atakanozkan.com", "error"]]);
});

test("league picker never sorts the match rows of unopened leagues", async t => {
  const app = await makePopup(t);
  const now = Date.now();
  const leagues = ["eng.1", "esp.1"].map(code => {
    const matches = Array.from({ length: 30 }, (_, index) => domMatch({
      id: `${code}-${index}`, leagueCode: code, homeTeam: `Team ${index}`,
      state: "finished", kickoff: new Date(now - (30 - index) * 60000).toISOString(),
    }));
    return { name: code, code, matches };
  });
  app.eval("let sorts = 0; const originalSort = sortMatchesForDisplay; sortMatchesForDisplay = rows => { sorts++; return originalSort(rows); };");
  app.eval(`__T.lastPayload = ${JSON.stringify({ leagues, matches: leagues.flatMap(l => l.matches) })}; __T.renderLast()`);
  assert.equal(app.eval("sorts"), 0);
  app.document.querySelector(".league-pick-card").click();
  assert.equal(app.eval("sorts"), 1);
  assert.equal(app.document.querySelector(".match-card .team-name").textContent, "Team 29");
});
