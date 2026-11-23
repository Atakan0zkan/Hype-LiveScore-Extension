import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { browserLaunchOptions, launchUnpackedExtension } from "../browser/unpacked-extension.mjs";
import { ALL_MATCHES, DETAIL, LEAGUES, STANDINGS } from "../browser/league-scenario.mjs";

test.describe.configure({ mode: "serial" });

let context;
let page;
let apiCalls;
let extDir;
let popupUrl;
let extension;
const consoleErrors = [];
const pageErrors = [];

test.beforeAll(async () => {
  extension = await launchUnpackedExtension();
  ({ context, extDir, url: popupUrl } = extension);
  apiCalls = [];
  await context.route("**://api.atakanozkan.com/**", async (route) => {
    const url = new URL(route.request().url());
    apiCalls.push(url.pathname);
    if (url.pathname === "/live-matches") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ matches: ALL_MATCHES, leagues: LEAGUES }) });
    }
    if (url.pathname === "/league-standings") {
      const code = url.searchParams.get("leagueCode");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leagueCode: code, standings: STANDINGS }) });
    }
    if (url.pathname === "/match-detail") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DETAIL) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  page = await context.newPage();
  await page.setViewportSize({ width: 580, height: 600 });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(popupUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".league-pick-card").first().waitFor({ timeout: 15000 });
});

test.afterAll(async () => {
  await extension?.close();
});

test.beforeEach(async () => {
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const screenshot = testInfo.outputPath("failure.png");
    if (page && !page.isClosed()) {
      await page.screenshot({ path: screenshot, fullPage: true });
      await testInfo.attach("failure", { path: screenshot, contentType: "image/png" });
    }
    const trace = testInfo.outputPath("trace.zip");
    await context.tracing.stop({ path: trace });
    await testInfo.attach("trace", { path: trace, contentType: "application/zip" });
  } else {
    await context.tracing.stop();
  }
});

test("renders league cards from the API", async () => {
  await expect(page.locator(".league-pick-card")).toHaveCount(3);
  await expect(page.locator(".league-pick-name", { hasText: "Premier League" })).toBeVisible();
  await expect(page.locator(".league-pick-badge")).toHaveCount(0);
  await expect(page.locator(".league-card-actions .favorite-btn")).toHaveCount(3);
  await expect(page.locator(".league-preview-status").first()).toHaveText("67' · Live");
  expect(apiCalls.filter((p) => p === "/live-matches").length).toBeGreaterThanOrEqual(1);
});

test("league previews share the league font and fit all three popup sizes", async ({}, testInfo) => {
  const premier = page.locator(".league-pick-card", { hasText: "Premier League" });
  await expect(premier.locator(".league-preview-team")).toHaveText(["Arsenal", "Chelsea"]);
  await expect(premier.locator(".league-preview-score")).toHaveText("2 – 1");
  await expect(premier.locator(".league-preview-status")).toHaveText("67' · Live");
  await expect(page.locator(".league-pick-card", { hasText: "Serie A" }).locator(".league-preview-status")).toHaveText("Full Time");
  await expect(page.locator(".league-pick-card", { hasText: "LaLiga" }).locator(".league-pick-preview")).toHaveCount(0);
  const type = await premier.evaluate(card => {
    const league = getComputedStyle(card.querySelector(".league-pick-name"));
    const match = getComputedStyle(card.querySelector(".league-pick-preview"));
    return { leagueFont: league.fontFamily, matchFont: match.fontFamily, leagueSize: parseFloat(league.fontSize), matchSize: parseFloat(match.fontSize), leagueColor: league.color, matchColor: match.color };
  });
  expect(type.matchFont).toBe(type.leagueFont);
  expect(type.matchSize).toBe(12);
  expect(type.matchSize).toBeLessThan(type.leagueSize);
  expect(type.matchColor).not.toBe(type.leagueColor);
  const before = apiCalls.length;
  for (const [size, width, height] of [["small", 480, 540], ["big", 720, 600], ["default", 580, 600]]) {
    await page.locator("#settingsToggle").click();
    await page.locator(`input[name="popupSize"][value="${size}"]`).check();
    await page.setViewportSize({ width, height });
    await page.locator("#settingsClose").click();
    expect(await page.locator("#leaguePickList").evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
    expect(await page.locator(".league-preview-match").evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`league-previews-${size}.png`) });
  }
  expect(apiCalls.length).toBe(before);
});

test("opens league detail with sections and standings", async () => {
  await page.locator(".league-pick-card", { hasText: "Premier League" }).click();
  await expect(page.locator(".match-section")).toHaveCount(3);
  await expect(page.locator(".match-card")).toHaveCount(3);
  await expect(page.locator(".standings-table")).toBeVisible();
  await expect(page.locator(".standings-team-name", { hasText: "Arsenal" })).toBeVisible();
  await page.locator("#backBtn").click();
  await expect(page.locator(".league-pick-card")).toHaveCount(3);
});

test("opens match detail hero and returns", async () => {
  await page.locator(".league-pick-card", { hasText: "Premier League" }).click();
  await page.locator(".match-card").first().click();
  await expect(page.locator(".match-detail-hero")).toBeVisible();
  await expect(page.locator(".match-detail-hero")).toContainText("Arsenal");
  expect(apiCalls).toContain("/match-detail");
  await page.locator("#backBtn").click();
  await page.locator("#backBtn").click();
  await expect(page.locator(".league-pick-card")).toHaveCount(3);
});

test("single-score hero, larger uncropped crests and unlabelled lineups fit every popup size", async () => {
  const heroPage = await context.newPage();
  const errors = [];
  heroPage.on("pageerror", error => errors.push(String(error)));
  // Deliberately non-square synthetic crests: test image fitting without CDN availability.
  await heroPage.route("https://a.espncdn.com/hype-e2e/*", route => {
    const home = route.request().url().endsWith("home.svg");
    return route.fulfill({ contentType:"image/svg+xml", body:`<svg xmlns="http://www.w3.org/2000/svg" width="${home ? 100 : 180}" height="${home ? 180 : 100}" viewBox="0 0 ${home ? "100 180" : "180 100"}"><rect x="2" y="2" width="${home ? 96 : 176}" height="${home ? 176 : 96}" rx="10" fill="${home ? "#2955af" : "#f2d35b"}" stroke="white" stroke-width="4"/></svg>` });
  });
  const match = { ...ALL_MATCHES[0], homeTeam:"Everton", awayTeam:"Coventry City", homeScore:3, awayScore:1, minute:"90'+4'", homeLogo:"https://a.espncdn.com/hype-e2e/home.svg", awayLogo:"https://a.espncdn.com/hype-e2e/away.svg" };
  await heroPage.route("**://api.atakanozkan.com/live-matches**", route => route.fulfill({ contentType:"application/json", body:JSON.stringify({matches:[match],leagues:[{...LEAGUES[0],matches:[match]}]}) }));
  try {
    await heroPage.goto(popupUrl);
    await heroPage.locator(".league-pick-card").first().click();
    await heroPage.locator(".match-card").first().click();
    const hero = heroPage.locator(".match-detail-hero");
    await expect(hero.locator(".detail-team-score")).toHaveCount(0);
    await expect(hero.locator(".detail-score")).toHaveText("3 - 1");
    await expect(hero.locator(".detail-minute")).toHaveText("90'+4'");
    await expect(heroPage.locator(".lineup-heading")).toHaveCount(0);
    await expect(heroPage.locator(".lineup-section")).toHaveAttribute("aria-label", "Lineups");
    for (const [size,width,height,crestSize] of [["small",480,540,76],["default",580,600,88],["big",720,600,96]]) {
      await heroPage.locator("#settingsToggle").click();
      await heroPage.locator(`input[name="popupSize"][value="${size}"]`).check();
      await heroPage.setViewportSize({width,height});
      await heroPage.locator("#settingsClose").click();
      await expect(hero.locator(".detail-team-logo").first()).toHaveJSProperty("complete", true);
      const geometry = await hero.evaluate(el => {
        const score = el.querySelector(".detail-score").getBoundingClientRect();
        const minute = el.querySelector(".detail-minute").getBoundingClientRect();
        return { minuteAbove:minute.bottom <= score.top, overflow:el.scrollWidth > el.clientWidth + 1,
          crests:[...el.querySelectorAll(".detail-team-logo")].map(img => ({width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height,fit:getComputedStyle(img).objectFit,loaded:img.naturalWidth > 0})),
          names:[...el.querySelectorAll(".detail-team-name")].map(name => ({color:getComputedStyle(name).color,bottom:name.getBoundingClientRect().bottom,cardBottom:name.parentElement.getBoundingClientRect().bottom})) };
      });
      expect(geometry.minuteAbove).toBe(true);
      expect(geometry.overflow).toBe(false);
      for (const crest of geometry.crests) expect(crest).toEqual({width:crestSize,height:crestSize,fit:"contain",loaded:true});
      for (const name of geometry.names) expect(name.bottom).toBeLessThanOrEqual(name.cardBottom);
      await hero.screenshot({path:`test-results/match-header-${size}.png`});
    }
    await heroPage.evaluate(match => renderMatchDetail({code:"eng.1",name:"Premier League"}, {
      ...match, homeTeam:"Wolverhampton Wanderers Football Club", awayTeam:"Borussia Mönchengladbach 1900 Football Club",
    }), match);
    for (const name of await hero.locator(".detail-team-name").all()) {
      const bounds = await name.evaluate(el => ({height:el.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(el).lineHeight),fullName:el.title,text:el.textContent}));
      expect(bounds.height).toBeLessThanOrEqual(bounds.lineHeight * 2 + 1);
      expect(bounds.fullName).toBe(bounds.text);
    }
    expect(await hero.evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(false);
    // Native image error behavior must keep the card size and stop retrying.
    await hero.locator(".detail-team-logo").first().evaluate(img => img.dispatchEvent(new Event("error")));
    await expect(hero.locator(".detail-team-logo").first()).toHaveAttribute("src", /^data:image\/svg\+xml,/);
    expect(errors).toEqual([]);
  } finally {
    await heroPage.close();
    await page.evaluate(() => localStorage.setItem("hype_popup_size", "default"));
  }
});

test("standings show accessible rank markers with a compact qualification/relegation legend", async () => {
  await page.locator(".league-pick-card", {hasText:"Premier League"}).click();
  const table = page.locator(".standings-table");
  await expect(table.locator("td.standings-position--champions-league")).toHaveCount(1);
  await expect(table.locator("td.standings-position--relegation")).toHaveCount(2);
  await expect(page.locator(".standings-legend-item")).toHaveCount(5);
  await expect(table.locator("td.standings-position--relegation").first()).toHaveAttribute("aria-label", /Relegation play-off/);
  const stripe = await table.locator("td.standings-position--relegation").last().evaluate(el => ({
    color:getComputedStyle(el,"::before").backgroundColor, width:getComputedStyle(el,"::before").width,
  }));
  expect(stripe).toEqual({color:"rgb(255, 107, 114)",width:"3px"});
  expect(await page.locator(".standings-legend").evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(false);
  await page.locator(".standings").screenshot({path:"test-results/standings-zones.png"});
  await page.locator("#backBtn").click();
});

test("standings legend keeps complete text inside the rounded panel at every size and direction", async () => {
  await page.locator(".league-pick-card", {hasText:"Premier League"}).click();
  await page.locator(".standings-legend").waitFor();
  try {
    for (const [size,width,height] of [["small",480,540],["default",580,600],["big",720,600]]) {
      await page.locator("#settingsToggle").click();
      await page.locator(`input[name="popupSize"][value="${size}"]`).check();
      await page.setViewportSize({width,height});
      await page.locator("#settingsClose").click();
      for (const dir of ["ltr","rtl"]) {
        await page.evaluate(dir => { document.documentElement.dir = dir; }, dir);
        const bounds = await page.locator(".standings-legend").evaluate(legend => {
          const panel = legend.closest(".standings").getBoundingClientRect();
          return [...legend.children].map(item => {
            const marker = item.firstElementChild.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(item.lastElementChild);
            const text = range.getBoundingClientRect();
            return {
              markerInset:Math.min(marker.left-panel.left,panel.right-marker.right),
              textInset:Math.min(text.left-panel.left,panel.right-text.right),
              bottomInset:panel.bottom-text.bottom,
              clipped:item.lastElementChild.scrollWidth > item.lastElementChild.clientWidth + 1,
            };
          });
        });
        for (const item of bounds) {
          expect(item.markerInset, `${size}/${dir}: marker avoids rounded corners`).toBeGreaterThanOrEqual(10);
          expect(item.textInset, `${size}/${dir}: full label has horizontal space`).toBeGreaterThanOrEqual(10);
          expect(item.bottomInset, `${size}/${dir}: text has bottom space`).toBeGreaterThanOrEqual(10);
          expect(item.clipped, `${size}/${dir}: label wraps without clipping`).toBe(false);
        }
        await expect(page.locator(".standings-qualification-note")).toHaveCount(0);
        if (dir === "ltr") await page.locator(".standings").screenshot({path:`test-results/standings-legend-${size}.png`});
      }
    }
  } finally {
    await page.evaluate(() => { document.documentElement.dir = "ltr"; });
    await page.locator("#settingsToggle").click();
    await page.locator('input[name="popupSize"][value="default"]').check();
    await page.setViewportSize({width:580,height:600});
    await page.locator("#settingsClose").click();
    await page.locator("#backBtn").click();
  }
});

test("readable stats, event timeline and two starting XIs fit the popup", async () => {
  await page.locator(".league-pick-card", { hasText: "Premier League" }).click();
  await page.locator(".match-card").first().click();
  const pitch = page.locator(".lineup-pitch");
  await expect(pitch).toBeVisible();
  await expect(pitch.locator(".pitch-player")).toHaveCount(22);
  const homeLines = pitch.locator(".pitch-half--home .pitch-line");
  await expect(homeLines).toHaveCount(5);
  const rearForward = homeLines.nth(3).getByLabel("Randal Kolo Muani · RCF");
  await expect(rearForward.locator(".pitch-name")).toHaveText("R. Kolo Muani");
  await expect(rearForward.locator(".pitch-shirt")).toHaveText("10");
  await expect(homeLines.nth(4).getByLabel("Dominic Calvert-Lewin · F")).toBeVisible();
  await expect(page.locator(".lineup-substitutes .lineup-player")).toHaveCount(4);
  await expect(page.locator(".lineup-player--starter")).toHaveCount(0);
  await expect(page.locator("summary", { hasText: "Full squads" })).toHaveCount(0);
  expect(await page.locator(".lineup-substitutes").evaluate(el => el.closest("details"))).toBeNull();
  await expect(pitch.locator(".pitch-goal")).toHaveCount(14);
  await expect(pitch.locator(".pitch-card--yellow")).toHaveCount(4);
  await expect(pitch.locator(".pitch-card--red")).toHaveCount(2);
  const geometry = await pitch.evaluate((el) => {
    const pitch = el.getBoundingClientRect();
    const goals = [...el.querySelectorAll(".pitch-goals")].map((stack) => [...stack.children].map((ball) => {
      const r = ball.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right};
    }));
    return {goals,pitch:{x:pitch.x,y:pitch.y,right:pitch.right}};
  });
  for (const stack of geometry.goals) {
    expect(new Set(stack.map((ball) => ball.x)).size).toBe(1);
    expect(stack.at(-1).y).toBeLessThan(stack[0].y);
    for (const ball of stack) {
      expect(ball.y).toBeGreaterThanOrEqual(geometry.pitch.y);
      expect(ball.x).toBeGreaterThanOrEqual(geometry.pitch.x);
      expect(ball.right).toBeLessThanOrEqual(geometry.pitch.right);
    }
  }
  await pitch.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/lineups-horizontal.png" });
  const pitchBox = await pitch.boundingBox();
  expect(pitchBox.height).toBeLessThanOrEqual(302);
  expect(pitchBox.width).toBeGreaterThan(pitchBox.height);
  const goalkeepers = await pitch.locator(".pitch-shirt", { hasText: /^1$/ }).evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
  expect(goalkeepers[1].x - goalkeepers[0].x).toBeGreaterThan(350);
  expect(Math.abs(goalkeepers[1].y - goalkeepers[0].y)).toBeLessThan(2);
  expect(await pitch.evaluate((el) => el.closest("details"))).toBeNull();
  expect(await pitch.locator(".pitch-name").evaluateAll((els) => els.some((el) => el.scrollWidth > el.clientWidth))).toBe(false);
  for (const [title, target] of [["Stats", ".stats-list"], ["Timeline", ".timeline-item"], ["News", ".media-list"]]) {
    const section = page.locator("details").filter({ has: page.locator("summary", { hasText: title }) });
    await section.locator("summary").click();
    await expect(section.locator(target).first()).toBeVisible();
    await section.locator(target).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/${title.toLowerCase()}-presentation.png` });
    const overflow = await section.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflow).toBe(false);
    if (title === "Stats") {
      const widths = await section.locator(".stat-item").first().locator(".stat-bar-fill").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
      expect(widths[1] / widths[0]).toBeCloseTo(2, 1);
      await page.evaluate(() => { document.documentElement.dir = "rtl"; });
      const positions = await section.locator(".stat-item").first().locator(".stat-value").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left));
      expect(positions[0]).toBeLessThan(positions[1]);
      await page.evaluate(() => { document.documentElement.dir = "ltr"; });
    }
    if (title === "News") await expect(section.locator(".media-list > :first-child")).toHaveClass(/video-card--highlight/);
    await section.locator("summary").click();
  }
  await expect(page.locator("summary", { hasText: "Commentary" })).toHaveCount(0);
  await page.locator("#backBtn").click();
  await page.locator("#backBtn").click();
});

test("back navigation restores per-view scrolling and open sections", async () => {
  await page.locator(".league-pick-card", { hasText: "Premier League" }).click();
  const scroll = page.locator("#leagueDetailContent");
  await scroll.evaluate((el) => { el.scrollTop = 65; });
  const leaguePosition = await scroll.evaluate((el) => el.scrollTop);
  await page.locator(".match-card").first().click();
  const stats = page.locator('details[data-section-key="stats"]');
  await stats.locator("summary").click();
  await stats.scrollIntoViewIfNeeded();
  const matchPosition = await scroll.evaluate((el) => el.scrollTop);
  await page.locator("#backBtn").click();
  expect(await scroll.evaluate((el) => el.scrollTop)).toBeCloseTo(leaguePosition, 0);
  await page.locator(".match-card").first().click();
  await expect(stats).toHaveAttribute("open", "");
  expect(await scroll.evaluate((el) => el.scrollTop)).toBeCloseTo(matchPosition, 0);
  await page.locator("#backBtn").click();
  await page.locator("#backBtn").click();
});

test("power toggle disables UI and persists", async () => {
  await page.locator("#powerToggle").click();
  await expect(page.locator(".app-shell--disabled")).toBeAttached();
  await page.reload({ waitUntil: "domcontentloaded" });
  // Power off fetches nothing, so no cards: persistence is the assertion.
  await expect(page.locator(".app-shell--disabled")).toBeAttached({ timeout: 15000 });
  await page.locator("#powerToggle").click(); // restore for later tests
  await page.locator(".league-pick-card").first().waitFor({ timeout: 15000 });
});

test("favorites pin leagues to the top", async () => {
  const cards = page.locator(".league-pick-card");
  await cards.filter({ hasText: "LaLiga" }).locator(".favorite-btn").click();
  await expect(cards.first()).toContainText("LaLiga");
});

test("settings sizes persist and local backup safely round-trips only favorites and size", async ({}, testInfo) => {
  await expect(page.locator("#subtitle")).toHaveCount(0);
  expect(await page.locator(".hero-actions > button").evaluateAll(els => els.map(el => el.id))).toEqual(["englishToggle", "settingsToggle", "powerToggle"]);
  await page.locator("#settingsToggle").click();
  await expect(page.locator("#feedbackEmail")).toHaveAttribute("href", "mailto:atakanozkanapps@gmail.com");
  await expect(page.locator("#settingsFeedbackHint")).toContainText("idea, a suggestion, or spotted a bug");
  await expect(page.locator("#settingsVersion")).toHaveText(await page.evaluate(() => chrome.runtime.getManifest().version));
  const before = apiCalls.length;
  for (const [size, width, height] of [["small", 480, 540], ["default", 580, 600], ["big", 720, 600]]) {
    await page.setViewportSize({ width, height });
    await page.locator(`input[name="popupSize"][value="${size}"]`).check();
    await expect(page.locator("html")).toHaveAttribute("data-popup-size", size);
    expect(await page.evaluate(() => ({ width: document.body.getBoundingClientRect().width, height: document.body.getBoundingClientRect().height }))).toEqual({ width, height });
    expect(await page.locator("#settingsPanel").evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
    await page.locator("#settingsVersion").scrollIntoViewIfNeeded();
    await expect(page.locator("#settingsVersionRow")).toBeVisible();
    expect(await page.locator("#feedbackEmail").evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`settings-${size}.png`) });
  }
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#exportSettings").click()]);
  expect(download.suggestedFilename()).toBe("hype-settings.json");
  const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  expect(exported).toEqual({ format: "hype-score-preferences", version: 1, favoriteLeagues: ["esp.1"], popupSize: "big" });
  expect(apiCalls.length).toBe(before);
  const privacy = page.locator("#privacyLink");
  await expect(privacy).toHaveAttribute("href", "https://gist.github.com/Atakan0zkan/7767ff31859fa9703b9e851ea5eb9a6d");
  await expect(privacy).toHaveAttribute("rel", "noopener noreferrer");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-popup-size", "big");
  await page.locator(".league-pick-card").first().waitFor();
  await page.locator(".league-pick-card", { hasText: "LaLiga" }).locator(".favorite-btn").click();
  await page.locator("#settingsToggle").click();
  await page.locator('input[name="popupSize"][value="default"]').check();
  const importBefore = apiCalls.length;
  await page.locator("#settingsFile").setInputFiles({ name: "hype-settings.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) });
  await expect(page.locator("#settingsStatus")).toHaveText("Settings imported.");
  await expect(page.locator("html")).toHaveAttribute("data-popup-size", "big");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("hype_favorite_leagues")))).toEqual(["esp.1"]);
  expect(apiCalls.length).toBe(importBefore);
  await page.locator("#settingsFile").setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"__proto__":{"polluted":true}}') });
  await expect(page.locator("#settingsStatus")).toHaveClass(/settings-status--error/);
  await expect(page.locator("html")).toHaveAttribute("data-popup-size", "big");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("hype_favorite_leagues")))).toEqual(["esp.1"]);
  await page.locator("#settingsFile").setInputFiles({ name: "oversized.json", mimeType: "application/json", buffer: Buffer.alloc(65537, " ") });
  await expect(page.locator("#settingsStatus")).toHaveText("This is not a valid Hype settings file.");
  await page.locator('input[name="popupSize"][value="default"]').check();
  await page.setViewportSize({ width: 580, height: 600 });
  await page.locator("#settingsClose").click();
  await expect(page.locator(".league-pick-card").first()).toContainText("LaLiga");
});

test("settings preserve match navigation and work while power is off", async () => {
  await page.locator(".league-pick-card", { hasText: "Premier League" }).click();
  await page.locator(".match-card").first().click();
  const stats = page.locator('details[data-section-key="stats"]');
  await stats.locator("summary").click();
  await stats.scrollIntoViewIfNeeded();
  const scroll = page.locator("#leagueDetailContent");
  const position = await scroll.evaluate(el => el.scrollTop);
  await page.locator("#settingsToggle").click();
  await expect(page.locator("#settingsPanel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".match-detail-hero")).toBeVisible();
  await expect(stats).toHaveAttribute("open", "");
  expect(await scroll.evaluate(el => el.scrollTop)).toBeCloseTo(position, 0);
  await page.locator("#backBtn").click();
  await page.locator("#backBtn").click();
  await page.locator("#powerToggle").click();
  const requests = apiCalls.length;
  await page.locator("#settingsToggle").click();
  await expect(page.locator("#settingsPanel")).toBeVisible();
  await page.locator('input[name="popupSize"][value="small"]').check();
  expect(apiCalls.length).toBe(requests);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-popup-size", "small");
  await expect(page.locator(".app-shell--disabled")).toBeAttached();
  await page.locator("#settingsToggle").click();
  await page.locator('input[name="popupSize"][value="default"]').check();
  await page.locator("#settingsClose").click();
  await page.locator("#powerToggle").click();
  await page.locator(".league-pick-card").first().waitFor();
});

test("World Cup opens 2030 data, excludes legacy results, and supports an empty future season", async ({}, testInfo) => {
  const future = { id: "203001", leagueCode: "fifa.world", seasonYear: 2030, homeTeam: "Spain", awayTeam: "England", state: "scheduled", kickoff: "2030-06-15T18:00:00Z" };
  const old = { ...future, id: "760517", seasonYear: 2026, homeTeam: "Old Spain", awayTeam: "Old Argentina", state: "finished", kickoff: "2026-07-19T18:00:00Z" };
  for (const scenario of [
    { name: "legacy-backend", data: { rounds: [{ slug: "final", matches: [old] }], standings: STANDINGS }, count: 0 },
    { name: "unpublished-2030", data: { seasonYear: 2030, rounds: [], standings: [] }, count: 0 },
    { name: "published-2030", data: { seasonYear: 2030, rounds: [{ slug: "group-stage", name: "Group stage", matches: [old, future] }], standings: [] }, count: 1 },
  ]) {
    await test.step(scenario.name, async () => {
      const urls = [];
      const handler = async (route) => {
        const url = new URL(route.request().url());
        urls.push(url);
        const body = url.pathname === "/live-matches"
          ? { matches: [old], leagues: [{ code: "fifa.world", name: "FIFA World Cup", matches: [old] }] }
          : scenario.data;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      };
      await page.route("**://api.atakanozkan.com/**", handler);
      try {
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.getByRole("button", { name: "FIFA World Cup 2030", exact: true }).click();
        await expect(page.locator(".league-detail-title")).toHaveText("FIFA World Cup 2030");
        await expect.poll(() => urls.some((url) => url.pathname === "/tournament-bracket" && url.searchParams.get("season") === "2030")).toBe(true);
        await expect(page.locator(".bracket-message").filter({ hasText: "Loading" })).toHaveCount(0);
        await expect(page.locator(".bracket-match-card")).toHaveCount(scenario.count);
        await expect(page.locator(".match-card,.standings-table")).toHaveCount(0);
        await expect(page.locator("#leagueDetailContent")).not.toContainText("Old Argentina");
        await expect(page.locator(".bracket-message--error,.standings-message--error")).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`world-cup-${scenario.name}.png`) });
      } finally {
        await page.unroute("**://api.atakanozkan.com/**", handler);
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.locator(".league-pick-card").first().waitFor();
      }
    });
  }
});

test("league previews refresh Live, Half Time and Full Time with long and RTL team names", async () => {
  let fixture;
  let previewRequests = 0;
  const before = apiCalls.length;
  const handler = async route => {
    previewRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ matches: [fixture], leagues: [{ code: "eng.1", name: "Premier League", matches: [fixture] }] }) });
  };
  await page.route("**://api.atakanozkan.com/live-matches**", handler);
  try {
    for (const [index, state, status, label] of [[0, "live", "Live", "67' · Live"], [1, "live", "Half Time", "Half Time"], [2, "finished", "Full Time", "Full Time"]]) {
      fixture = { ...LEAGUES[0].matches[0], state, status, homeScore: index, awayScore: 0, homeTeam: "A football club with an exceptionally long home team name", awayTeam: "فريق كرة القدم ذو الاسم الطويل للغاية" };
      await page.evaluate(() => localStorage.removeItem("hype_live_matches_cache"));
      await page.reload();
      await expect(page.locator(".league-preview-status")).toHaveText(label);
      await expect(page.locator(".league-preview-score")).toHaveText(`${index} – 0`);
      await expect(page.locator(".league-pick-preview")).toHaveCount(1);
      await expect(page.locator(".league-pick-card")).toHaveAttribute("aria-label", `Premier League · ${fixture.homeTeam} ${index} – 0 ${fixture.awayTeam} · ${label}`);
      for (const dir of ["ltr", "rtl"]) {
        await page.evaluate(dir => { document.documentElement.dir = dir; }, dir);
        expect(await page.locator(".league-preview-match").evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
        expect(await page.locator(".league-preview-team").evaluateAll(teams => teams.every(el => getComputedStyle(el).textOverflow === "ellipsis" && el.getBoundingClientRect().width > 0))).toBe(true);
        await expect(page.locator(".league-preview-score")).toHaveAttribute("dir", "ltr");
      }
    }
    expect(previewRequests).toBe(3);
    expect(apiCalls.length).toBe(before);
  } finally {
    await page.unroute("**://api.atakanozkan.com/live-matches**", handler);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator(".league-pick-card").first().waitFor();
  }
});

test("previews prefer popular club matches and upcoming metadata has no repeated total", async ({}, testInfo) => {
  let selectedMatches;
  const popular = { ...LEAGUES[0].matches[0], id: "880001", homeTeamId: "360", homeTeam: "Manchester United", awayTeamId: "364", awayTeam: "Liverpool", kickoff: new Date(Date.now() - 3 * 3600000).toISOString() };
  const minor = { ...LEAGUES[0].matches[0], id: "880002", homeTeamId: "370", homeTeam: "Fulham", awayTeamId: "384", awayTeam: "Crystal Palace", kickoff: new Date(Date.now() - 3600000).toISOString() };
  const upcoming = Array.from({ length: 4 }, (_, i) => ({ ...LEAGUES[0].matches[1], id: `88100${i}`, leagueCode: "arg.1", homeTeam: `Home Club ${i}`, awayTeam: `Away Club ${i}`, kickoff: new Date(Date.now() + 2 * 3600000).toISOString() }));
  const handler = async route => {
    const leagues = [{ code: "eng.1", name: "Premier League", matches: selectedMatches }, { code: "arg.1", name: "Argentine Liga Profesional", matches: upcoming }];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ matches: [...selectedMatches, ...upcoming], leagues }) });
  };
  await page.route("**://api.atakanozkan.com/live-matches**", handler);
  try {
    for (const [matches, expectedTeams] of [
      [[minor, popular], ["Manchester United", "Liverpool"]],
      [[{ ...popular, state: "finished", status: "Full Time" }, { ...minor, state: "finished", status: "Full Time" }], ["Manchester United", "Liverpool"]],
      [[{ ...popular, state: "finished", status: "Full Time" }, minor], ["Fulham", "Crystal Palace"]],
    ]) {
      selectedMatches = matches;
      await page.evaluate(() => localStorage.removeItem("hype_live_matches_cache"));
      await page.reload();
      const premier = page.locator(".league-pick-card", { hasText: "Premier League" });
      await expect(premier.locator(".league-preview-team")).toHaveText(expectedTeams);
      const argentina = page.locator(".league-pick-card", { hasText: "Argentine Liga Profesional" });
      await expect(argentina.locator(".league-pick-meta")).toHaveText("4 upcoming matches");
      await expect(argentina).not.toContainText("4 matches");
      expect(await argentina.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
    }
    await page.locator("#settingsToggle").click();
    await page.locator('input[name="popupSize"][value="small"]').check();
    await page.setViewportSize({ width: 480, height: 540 });
    await page.locator("#settingsClose").click();
    expect(await page.locator("#leaguePickList").evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("popular-match-and-upcoming-copy.png") });
    await page.locator(".league-pick-card", { hasText: "Argentine Liga Profesional" }).click();
    await expect(page.locator(".league-detail-meta")).toHaveText("4 upcoming matches");
  } finally {
    await page.unroute("**://api.atakanozkan.com/live-matches**", handler);
    await page.evaluate(() => localStorage.clear());
    await page.setViewportSize({ width: 580, height: 600 });
    await page.reload();
    await page.locator(".league-pick-card").first().waitFor();
  }
});

test("last-successful scores have no freshness banner, fit every size, expire and recover", async ({}, testInfo) => {
  const snapshotPage = await context.newPage();
  snapshotPage.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  snapshotPage.on("pageerror", error => pageErrors.push(String(error)));
  let sourceTime = Date.now() - 80000;
  let stale = true;
  let requests = 0;
  await snapshotPage.clock.install({ time: Date.now() });
  await snapshotPage.route("**://api.atakanozkan.com/live-matches**", async route => {
    requests += 1;
    expect(new URL(route.request().url()).searchParams.get("allowStale")).toBe("1");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      matches: ALL_MATCHES, leagues: LEAGUES,
      freshness: { updatedAt: new Date(sourceTime).toISOString(), stale },
    }) });
  });
  try {
    await page.evaluate(() => localStorage.clear());
    await snapshotPage.goto(popupUrl, { waitUntil: "domcontentloaded" });
    const notice = snapshotPage.locator("#snapshotNotice");
    await expect(notice).toHaveCount(0);
    await expect(snapshotPage.locator(".league-pick-card")).toHaveCount(3);
    expect(await snapshotPage.evaluate(() => JSON.parse(localStorage.getItem("hype_live_matches_cache")).savedAt)).toBe(sourceTime);
    const initialRequests = requests;
    for (const [size, width, height] of [["small", 480, 540], ["default", 580, 600], ["big", 720, 600]]) {
      await snapshotPage.locator("#settingsToggle").click();
      await expect(notice).toHaveCount(0);
      await snapshotPage.locator(`input[name="popupSize"][value="${size}"]`).check();
      await snapshotPage.setViewportSize({ width, height });
      await snapshotPage.locator("#settingsClose").click();
      await expect(notice).toHaveCount(0);
      expect(await snapshotPage.locator("#leaguePickList").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
      await snapshotPage.screenshot({ path: testInfo.outputPath(`bounded-fallback-${size}.png`) });
    }
    expect(requests).toBe(initialRequests);
    sourceTime = await snapshotPage.evaluate(() => Date.now() - 290000);
    await snapshotPage.evaluate(() => localStorage.removeItem("hype_live_matches_cache"));
    await snapshotPage.reload();
    await expect(snapshotPage.locator(".league-pick-card")).toHaveCount(3);
    await expect(notice).toHaveCount(0);
    const beforeExpiry = requests;
    await snapshotPage.clock.fastForward(10001);
    await expect(notice).toHaveCount(0);
    await expect(snapshotPage.locator("#leaguePickList")).toBeHidden();
    await expect(snapshotPage.locator("#errorState")).toBeVisible();
    expect(requests).toBe(beforeExpiry);
    stale = false;
    sourceTime = await snapshotPage.evaluate(() => Date.now());
    await snapshotPage.reload();
    await expect(snapshotPage.locator(".league-pick-card")).toHaveCount(3);
    await expect(notice).toHaveCount(0);
    await expect(snapshotPage.locator("#errorState")).toBeHidden();
  } finally {
    await snapshotPage.close();
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator(".league-pick-card").first().waitFor();
  }
});

test("native Chromium i18n loads reference, Turkish, Slavic count forms and Arabic", async () => {
  for (const [code, key, expected] of [
    ["en", "settings", "Settings"],
    ["tr", "settings", "Ayarlar"],
    ["ru", "liveMatchCountFew", "Идут 2 матча"],
    ["pl", "liveMatchCountFew", "2 mecze na żywo"],
    ["sl", "liveMatchCountTwo", "2 tekmi v živo"],
    ["ar", "liveMatchesCount", "مباريات مباشرة: 2"],
  ]) {
    const options = {
      ...browserLaunchOptions(),
      locale: code,
      args: [`--lang=${code}`, `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
    };
    const nativeContext = await chromium.launchPersistentContext(path.join(path.dirname(extDir), `native-${code}`), options);
    try {
      await nativeContext.route("**://api.atakanozkan.com/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ matches: ALL_MATCHES, leagues: LEAGUES }) }));
      const nativePage = await nativeContext.newPage();
      await nativePage.goto(popupUrl, { waitUntil: "domcontentloaded" });
      const actual = await nativePage.evaluate(key => ({ language: chrome.i18n.getUILanguage(), message: chrome.i18n.getMessage(key, ["2"]), count: matchCountMessage("live", 2) }), key);
      expect(actual.language.split(/[-_]/)[0], `${code}: real browser UI locale`).toBe(code);
      expect(actual.message, `${code}: native Chrome message lookup`).toBe(expected);
      expect(actual.count).toBe(code === "en" ? "2 live matches" : code === "tr" ? "2 canlı maç" : expected);
      await nativePage.evaluate(() => { isEnglishOverride = true; applyI18n(); });
      await expect(nativePage.locator("html")).toHaveAttribute("dir", "ltr");
      expect(await nativePage.evaluate(() => matchCountMessage("live", 2))).toBe("2 live matches");
    } finally {
      await nativeContext.close();
    }
  }
});

test("all 55 locale packs fit Small and preserve translated settings, standings and details", async () => {
  const localePage = await context.newPage();
  localePage.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  localePage.on("pageerror", error => pageErrors.push(String(error)));
  const dir = path.resolve("extension/_locales");
  const codes = ["en", "tr", ...fs.readdirSync(dir).filter(code => !["en", "tr"].includes(code)).sort()];
  const screenshots = new Set(["en", "tr", "ar", "ru", "ml", "zh_TW"]);
  try {
    await localePage.setViewportSize({ width: 480, height: 540 });
    await localePage.goto(popupUrl, { waitUntil: "domcontentloaded" });
    await localePage.locator(".league-pick-card").first().waitFor();
    for (const code of codes) {
      const messages = JSON.parse(fs.readFileSync(path.join(dir, code, "messages.json"), "utf8"));
      // Test-only API stubs exercise the actual shipped popup and all 55 packs
      // without changing the user's browser language or using a translation API.
      await localePage.evaluate(({ code, messages }) => {
        if (isSettingsOpen) setSettingsOpen(false);
        selectedLeagueKey = null;
        selectedMatchKey = null;
        isEnglishOverride = false;
        chrome.i18n.getUILanguage = () => code.replaceAll("_", "-");
        chrome.i18n.getMessage = (key, values = []) => (messages[key]?.message || "").replaceAll("$COUNT$", String(values[0] ?? ""));
        applyPopupSize("small");
        applyI18n();
        renderPayload(lastPayload);
        setSettingsOpen(true);
      }, { code, messages });
      await expect(localePage.locator("#settingsTitle")).toHaveText(messages.settings.message);
      await expect(localePage.locator("#settingsBackupHint")).toHaveText(messages.settingsBackupHint.message);
      await expect(localePage.locator("#settingsFeedbackHint")).toHaveText(messages.feedbackHint.message);
      await expect(localePage.locator("#settingsVersionLabel")).toHaveText(messages.extensionVersion.message);
      await expect(localePage.locator("#settingsVersion")).toHaveText(await localePage.evaluate(() => chrome.runtime.getManifest().version));
      await expect(localePage.locator("#feedbackEmail")).toHaveAttribute("dir", "ltr");
      await expect(localePage.locator("#settingsFile")).toHaveAttribute("aria-label", messages.importSettings.message);
      await expect(localePage.locator("html")).toHaveAttribute("dir", ["ar", "fa", "he"].includes(code) ? "rtl" : "ltr");
      const settingsOverflow = await localePage.locator("#settingsPanel").evaluate(el => el.scrollWidth > el.clientWidth + 1);
      expect.soft(settingsOverflow, `${code}: settings fit Small`).toBe(false);
      expect.soft(await localePage.locator("#feedbackEmail").evaluate(el => el.scrollWidth > el.clientWidth + 1), `${code}: contact address fits Small`).toBe(false);
      if (screenshots.has(code)) await localePage.screenshot({ path: `test-results/i18n-${code}-settings.png` });
      await localePage.locator("#settingsClose").click();
      await localePage.locator(".league-pick-card", { hasText: "Premier League" }).click();
      await localePage.locator(".standings-table").waitFor();
      await expect(localePage.locator(".match-card", { hasText: "Liverpool" }).locator(".status-pill")).toHaveText(messages.fullTime.message);
      const clippedHeaders = await localePage.locator(".standings-table th").evaluateAll(els => els.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent));
      expect.soft(clippedHeaders, `${code}: standings headings are readable`).toEqual([]);
      await expect(localePage.locator(".standings-legend")).toContainText(messages.qualifying.message);
      await expect(localePage.locator("td.standings-position--relegation").last()).toHaveAttribute("title", messages.standingsRelegation.message);
      const legendOverflow = await localePage.locator(".standings-legend").evaluate(el => el.scrollWidth > el.clientWidth + 1);
      expect.soft(legendOverflow, `${code}: standings legend fits Small`).toBe(false);
      await expect(localePage.locator(".standings-qualification-note")).toHaveCount(0);
      if (screenshots.has(code) || code === "bn") await localePage.locator(".standings-table").screenshot({ path: `test-results/i18n-${code}-standings.png` });
      await localePage.locator(".match-card", { hasText: "Arsenal" }).first().click();
      await expect(localePage.locator(".lineup-heading")).toHaveCount(0);
      await expect(localePage.locator(".lineup-section")).toHaveAttribute("aria-label", messages.lineups.message);
      await expect(localePage.locator('details[data-section-key="stats"] summary')).toHaveText(messages.stats.message);
      const detailOverflow = await localePage.locator("#leagueDetailContent").evaluate(el => el.scrollWidth > el.clientWidth + 1);
      expect.soft(detailOverflow, `${code}: match details fit Small`).toBe(false);
      if (screenshots.has(code)) await localePage.screenshot({ path: `test-results/i18n-${code}-details.png` });
    }
  } finally {
    await localePage.close();
  }
});

test("provider text stays plain text and unsafe external URLs never become clickable", async () => {
  const safetyPage = await context.newPage();
  const unsafeName = '<img data-hype-injected src=x onerror="window.hypeInjected=true"> FC';
  const leagues = structuredClone(LEAGUES);
  leagues[0].matches[0].homeTeam = unsafeName;
  await safetyPage.route("**://api.atakanozkan.com/**", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ leagues, matches: leagues.flatMap(league => league.matches) }),
  }));
  try {
    await safetyPage.goto(popupUrl, { waitUntil: "domcontentloaded" });
    await safetyPage.locator(".league-pick-card", { hasText: "Premier League" }).waitFor();
    await safetyPage.locator(".league-pick-card", { hasText: "Premier League" }).click();
    await expect(safetyPage.locator(".match-card").first()).toContainText(unsafeName);
    await expect(safetyPage.locator("[data-hype-injected]")).toHaveCount(0);
    const safety = await safetyPage.evaluate(() => ({
      injected: window.hypeInjected === true,
      links: ["javascript:alert(1)", "https://user:password@www.espn.com/story", "https://www.espn.com:444/story"]
        .map(url => createExternalLink("Unsafe fixture", url).tagName),
      valid: createExternalLink("Safe fixture", "https://www.espn.com/story").tagName,
    }));
    expect(safety).toEqual({ injected: false, links: ["SPAN", "SPAN", "SPAN"], valid: "A" });
  } finally {
    await safetyPage.close();
  }
});

test("zero console and page errors", async () => {
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
