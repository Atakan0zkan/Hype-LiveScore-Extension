import { test, expect } from "../browser/unpacked-extension.mjs";
import { servePopup } from "../browser/popup-fixtures.mjs";
import { espnEvent, loadWorkerContext, memoryCache, scoreboardResponse } from "../helpers.mjs";

test("International Friendlies shows every eligible fixture and opens sparse match details", async ({ app }) => {
  const fixture = (id, leagueId, home, away, state, hours = 0) => {
    const kickoff = new Date(Date.now() + hours * 3600000).toISOString();
    const event = espnEvent({ id, leagueId, state, kickoff });
    const [homeRow, awayRow] = event.competitions[0].competitors;
    homeRow.team.displayName = home;
    awayRow.team.displayName = away;
    return event;
  };
  const live = fixture("401930895", "3922", "Argentina", "Costa Rica", "in");
  const finished = fixture("401933879", "3922", "Tahiti", "Cook Islands", "post", -6 * 24);
  const expired = fixture("401933880", "3922", "New Zealand", "India", "post", -11 * 24);
  const upcoming = fixture("401916336", "3922", "Japan", "Paraguay", "pre", 2);
  const women = fixture("401932236", "3923", "Peru", "Dominican Republic", "pre", 2);
  const { run } = await loadWorkerContext({ caches: { default: memoryCache() }, fetch: async input => {
    const url = new URL(input);
    if (url.pathname.endsWith("/fifa.friendly/summary") && url.searchParams.get("event") === finished.id) {
      return Response.json({ header: finished });
    }
    if (url.pathname.endsWith("/fifa.friendly/scoreboard")) {
      return Response.json({ leagues: [{ id: "3922", slug: "fifa.friendly" }], events: [finished, expired] });
    }
    return scoreboardResponse(url.pathname.endsWith("/all/scoreboard") ? [live, upcoming, women] : []);
  } });
  const calls = [];
  await app.context.route("https://api.atakanozkan.com/**", async route => {
    const url = new URL(route.request().url());
    calls.push(url);
    const response = await run(`handleRequest(new Request(${JSON.stringify(url.href)}, {headers:{Origin:"chrome-extension://cdnpjnmhmagmiefkleefgchgffeaacaa"}}), {})`);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await app.page.goto(app.url);
  const league = app.page.getByRole("button", { name: /^International Friendlies/ });
  await expect(league).toContainText("Argentina", { timeout: 10000 });
  const badge = league.locator(".league-logo-image");
  await expect(badge).toHaveJSProperty("complete", true);
  expect(await badge.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await league.click();

  const detail = app.page.locator("#leagueDetailContent");
  await expect(detail.locator(".match-card")).toHaveCount(3);
  await expect(detail.locator(".section-title")).toHaveText(["● Live", "Results", "Upcoming"]);
  await expect(detail).toContainText("Japan");
  await expect(detail).not.toContainText("New Zealand");
  await expect(detail).not.toContainText("Dominican Republic");
  await expect(detail.locator(".standings")).toHaveCount(0);
  expect(calls.map(url => url.pathname)).toEqual(["/live-matches"]);

  const summary = app.page.waitForResponse(response => new URL(response.url()).pathname === "/match-detail");
  await detail.getByRole("button", { name: /Tahiti.+Cook Islands/ }).click();
  const response = await summary;
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).searchParams.get("leagueCode")).toBe("fifa.friendly");
  await expect(detail.locator(".detail-team-name")).toHaveText(["Tahiti", "Cook Islands"]);
  await expect(detail.locator('details[data-section-key="stats"]')).toBeVisible();
  await expect(detail.locator(".stat-row, .timeline-item, .state-card--error")).toHaveCount(0);
});

test("a category without recent results shows the same single dated result in its card and match list", async ({ app }) => {
  const now = Date.parse("2026-11-23T15:00:00Z");
  const day = 86400000;
  const result = (id, age, homeTeam, awayTeam) => ({
    id, leagueCode: "eng.1", league: "Premier League", state: "finished", status: "Full Time",
    minute: "FT", homeTeam, awayTeam, homeScore: 2, awayScore: 1,
    kickoff: new Date(now - age * day).toISOString(),
  });
  const latest = result("501001", 12, "Fulham", "Crystal Palace");
  const older = result("501002", 15, "Manchester United", "Liverpool");
  const expired = result("501003", 21, "Arsenal", "Chelsea");
  const matches = [older, expired, latest];
  await app.page.clock.setFixedTime(new Date(now));
  await servePopup(app, { payload: { matches, leagues: [{ code: "eng.1", name: "Premier League", matches }] } });

  const league = app.page.getByRole("button", { name: /^Premier League/ });
  const date = await app.page.evaluate(kickoff => formatShortDate(kickoff), latest.kickoff);
  await expect(league.locator(".league-preview-team")).toHaveText(["Fulham", "Crystal Palace"]);
  await expect(league.locator(".league-preview-status")).toContainText(date);
  await league.click();

  const results = app.page.locator(".match-card");
  await expect(results).toHaveCount(1);
  await expect(results.first()).toHaveAccessibleName(new RegExp("Fulham.*Crystal Palace"));
  await expect(results.locator(".time-badge")).toHaveText(date);

  await app.page.clock.setFixedTime(new Date(now + 8 * day + 1));
  await app.page.evaluate(() => renderPayload(lastPayload));
  await expect(results).toHaveCount(0);
});
