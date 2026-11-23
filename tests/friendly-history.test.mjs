import assert from "node:assert/strict";
import { test } from "node:test";
import { espnEvent, loadWorkerContext, memoryCache, scoreboardResponse } from "./helpers.mjs";

const ORIGIN = "chrome-extension://cdnpjnmhmagmiefkleefgchgffeaacaa";
const DAY = 86400000;
const MINUTE = 60000;
const NOW = Date.parse("2026-11-22T12:00:00Z");
const CODE = "fifa.friendly";
const monthly = (events, league = { id: "3922", slug: CODE }) => Response.json({ leagues: [league], events });

function event(id, timestamp, { state = "post", leagueId = "3922" } = {}) {
  return espnEvent({ id: String(id), state, leagueId, kickoff: new Date(timestamp).toISOString() });
}

async function fixture({ now = NOW, aggregate = [], archive = () => monthly([]), setTimeout } = {}) {
  const calls = [];
  const cache = memoryCache();
  const { run } = await loadWorkerContext({
    caches: { default: cache },
    globals: {
      Date: class extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
      },
      ...(setTimeout ? { setTimeout } : {}),
    },
    fetch: async (input, init) => {
      const url = new URL(input);
      calls.push(url);
      if (url.pathname.endsWith(`/${CODE}/scoreboard`)) return archive(url.searchParams.get("dates"), init);
      if (url.pathname.endsWith("/summary")) return Response.json({ header: { id: url.searchParams.get("event") } });
      return scoreboardResponse(url.pathname.endsWith("/all/scoreboard") ? aggregate : []);
    },
  });
  const request = (path = "/live-matches") => run(`handleRequest(new Request(${JSON.stringify(`https://api.atakanozkan.com${path}`)},{headers:{Origin:"${ORIGIN}"}}),{})`);
  return {
    request,
    advance: milliseconds => { now += milliseconds; },
    months: () => calls.filter(url => url.pathname.endsWith(`/${CODE}/scoreboard`)).map(url => url.searchParams.get("dates")),
  };
}

const friendlyRows = payload => payload.leagues.find(league => league.code === CODE).matches;

test("backfills only finished men's friendlies through the exact ten-day boundary", async () => {
  const live = event(123001, NOW - MINUTE, { state: "in" });
  const upcoming = event(123002, NOW + MINUTE, { state: "pre" });
  const expired = event(123003, NOW - 10 * DAY - 1);
  const unrelated = event(123004, NOW - 4 * DAY, { leagueId: "700" });
  const missingDate = { ...event(123005, NOW), date: "bad-date" };
  const { request, months } = await fixture({
    aggregate: [live, upcoming, expired, unrelated],
    archive: () => monthly([
      event(123001, NOW - DAY), // The current live record must win over this old snapshot.
      event(123006, NOW - 6 * DAY),
      event(123007, NOW - 10 * DAY),
      event(123008, NOW + DAY),
      event(123009, NOW - DAY, { leagueId: "3923" }),
      event(123010, NOW - DAY, { state: "in" }),
      event(123011, NOW - DAY, { leagueId: "19834" }),
      expired,
      missingDate,
    ]),
  });
  const response = await request();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(friendlyRows(payload).map(({ id, state }) => [id, state]), [
    ["123001", "live"], ["123002", "scheduled"], ["123006", "finished"], ["123007", "finished"],
  ]);
  assert.ok(payload.matches.some(match => match.id === "123004" && match.leagueCode === "eng.1"));
  assert.deepEqual(months(), ["202611"]);
  assert.equal((await request(`/match-detail?leagueCode=${CODE}&eventId=123006`)).status, 200);
});

test("selects at most one 10–20-day result for each category without a recent result", async () => {
  const { request } = await fixture({
    aggregate: [
      event(123060, NOW - 15 * DAY, { leagueId: "700" }),
      event(123061, NOW - 12 * DAY, { leagueId: "700" }),
      event(123062, NOW - 12 * DAY, { leagueId: "700" }),
      event(123063, NOW - 21 * DAY, { leagueId: "700" }),
      event(123064, NOW - 9 * DAY, { leagueId: "740" }),
      event(123065, NOW - 13 * DAY, { leagueId: "740" }),
      event(123066, NOW - 20 * DAY - 1, { leagueId: "3946" }),
      event(123067, NOW - MINUTE, { state: "in", leagueId: "3946" }),
      event(123068, NOW + MINUTE, { state: "pre", leagueId: "3946" }),
    ],
    archive: () => monthly([event(123069, NOW - 20 * DAY), event(123070, NOW - 20 * DAY - 1)]),
  });

  const payload = await (await request()).json();
  const byLeague = code => payload.leagues.find(league => league.code === code).matches.map(match => match.id);
  assert.deepEqual(byLeague("eng.1"), ["123061"]);
  assert.deepEqual(byLeague("esp.1"), ["123064"]);
  assert.deepEqual(byLeague("tur.1"), ["123067", "123068"]);
  assert.deepEqual(byLeague(CODE), ["123069"]);
  assert.deepEqual(payload.matches.map(match => match.id), ["123061", "123064", "123067", "123068", "123069"]);
});

test("preserves a single fallback until the exact twenty-day boundary, even on a cache hit", async () => {
  const { request, advance } = await fixture({ aggregate: [event(123075, NOW - 20 * DAY, { leagueId: "700" })] });
  const before = await (await request()).json();
  assert.equal(before.matches[0].id, "123075");
  advance(1);
  const response = await request();
  assert.equal(response.headers.get("X-Cache"), "HIT");
  const after = await response.json();
  assert.deepEqual(after.matches, []);
  assert.deepEqual(after.leagues.find(league => league.code === "eng.1").matches, []);
});

test("finds a friendly fallback in the previous month outside the ten-day window", async () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  const { request, months } = await fixture({ now, archive: period => period === "202610"
    ? monthly([event(123076, now - 19 * DAY)]) : monthly([]) });
  const payload = await (await request()).json();
  assert.deepEqual(months().sort(), ["202610", "202611"]);
  assert.deepEqual(friendlyRows(payload).map(match => match.id), ["123076"]);
});

test("loads both monthly buckets at a year boundary and deduplicates overlapping results", async () => {
  const now = Date.parse("2027-01-03T04:00:00Z");
  const overlap = event(123020, Date.parse("2027-01-01T03:00:00Z"));
  const { request, months } = await fixture({ now, archive: month => month === "202612"
    ? monthly([event(123021, now - 8 * DAY), overlap])
    : monthly([overlap, event(123022, now - DAY)]) });
  const payload = await (await request()).json();
  assert.deepEqual(months().sort(), ["202612", "202701"]);
  assert.deepEqual(friendlyRows(payload).map(match => match.id).sort(), ["123020", "123021", "123022"]);
});

test("expires results on a live cache hit and reuses recent history during archive outages", async () => {
  let fail = false;
  const club = event(123030, NOW - DAY, { leagueId: "700" });
  const { request, advance, months } = await fixture({ aggregate: [club], archive: () => fail
    ? new Response(null, { status: 429 })
    : monthly([event(123031, NOW - 10 * DAY + 30_000), event(123032, NOW - DAY)]) });
  assert.deepEqual(friendlyRows(await (await request()).json()).map(match => match.id), ["123031", "123032"]);
  advance(MINUTE);
  const cached = await request();
  assert.equal(cached.headers.get("X-Cache"), "HIT");
  const cachedPayload = await cached.json();
  assert.deepEqual(friendlyRows(cachedPayload).map(match => match.id), ["123032"]);
  assert.ok(!cachedPayload.matches.some(match => match.id === "123031"));
  advance(3 * MINUTE);
  assert.deepEqual(friendlyRows(await (await request()).json()).map(match => match.id), ["123032"]);
  assert.equal(months().length, 1, "live refreshes reuse the monthly archive cache");

  fail = true;
  advance(30 * MINUTE);
  const degraded = await request();
  assert.equal(degraded.status, 200);
  assert.deepEqual(friendlyRows(await degraded.json()).map(match => match.id), ["123032"]);
  advance(3 * MINUTE);
  assert.equal((await request()).status, 200);
  assert.equal(months().length, 2, "failed archive refreshes are not retried per live refresh");

  advance(7 * 60 * MINUTE);
  const later = await (await request()).json();
  assert.deepEqual(friendlyRows(later), [], "an archive snapshot is not used indefinitely");
  assert.equal(later.matches[0].leagueCode, "eng.1");
});

test("an archive with the wrong competition identity cannot replace the live response", async () => {
  const { request, months } = await fixture({ aggregate: [event(123040, NOW, { state: "in" })],
    archive: () => monthly([event(123041, NOW - DAY)], { id: "3923", slug: "fifa.friendly.w" }) });
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(friendlyRows(await response.json()).map(match => match.id), ["123040"]);
  assert.ok(months().length >= 1);
});

test("a slow optional archive has a short deadline and does not fail the scoreboard", { timeout: 1000 }, async () => {
  let aborted = false;
  const { request } = await fixture({
    aggregate: [event(123050, NOW, { state: "in" })],
    setTimeout: (callback, delay) => setTimeout(callback, delay <= 3000 ? 5 : delay),
    archive: (_month, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
      aborted = true;
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    }, { once: true })),
  });
  const response = await request();
  assert.equal(response.status, 200);
  assert.ok(aborted);
  assert.deepEqual(friendlyRows(await response.json()).map(match => match.id), ["123050"]);
});
