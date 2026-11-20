import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadPopupDOM, domPayload, workerJson } from "./dom-helpers.mjs";

// Timer orchestration without fake timers: swap window.setTimeout/clearTimeout
// for recorders, then assert on delays. Internal bare calls resolve through
// window at call time, so the swap is observed.
let app;
beforeEach(async () => {
  app = await loadPopupDOM({
    fetchImpl: async () => workerJson({ matches: [], leagues: [] }),
  });
  app.eval(`__T.lastPayload = ${JSON.stringify(domPayload())}`);
  app.eval(`window.__calls = [];
    window.setTimeout = (fn, ms, ...a) => { const id = window.__calls.length + 1; window.__calls.push({ fn, ms, id }); return id; };
    window.__cleared = [];
    window.clearTimeout = (id) => { window.__cleared.push(id); };`);
  // Let the boot data-flow (stubbed fetch) settle so its quiet-tier schedule
  // lands before we clear the recorder. Real timers are untouched.
  // NOTE: boot also overwrites lastPayload with the empty stub payload, so
  // every test re-seeds + renders via render() below.
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  app.eval("window.__calls = []; window.__cleared = [];");
});
afterEach(async () => { await app.close(); });

function render() {
  app.eval(`__T.lastPayload = ${JSON.stringify(domPayload())}`);
  app.eval("__T.renderLast()");
  app.eval("window.__calls = []; window.__cleared = [];");
}

const delays = () => app.eval("window.__calls.map((c) => c.ms)");
const live = () => domPayload();
const upcomingOnly = () => {
  const p = domPayload();
  p.matches = p.matches.filter((m) => m.state === "scheduled");
  p.leagues = [{ code: "eng.1", name: "Premier League", logoTone: "dark", matches: p.matches }];
  return p;
};
const quiet = () => ({ matches: [], leagues: [{ code: "eng.1", name: "Premier League", logoTone: "dark", matches: [] }] });

describe("popup timers: adaptive scheduling", () => {
  it("live -> 60s, upcoming -> 5m, quiet -> 30m", () => {
    app.eval(`scheduleNextRefresh(${JSON.stringify(live())})`);
    assert.deepEqual([...delays()], [60000]);
    app.eval("window.__calls = []");
    app.eval(`scheduleNextRefresh(${JSON.stringify(upcomingOnly())})`);
    assert.deepEqual([...delays()], [300000]);
    app.eval("window.__calls = []");
    app.eval(`scheduleNextRefresh(${JSON.stringify(quiet())})`);
    assert.deepEqual([...delays()], [1800000]);
  });

  it("explicit delay wins over payload tier", () => {
    app.eval(`scheduleNextRefresh(${JSON.stringify(quiet())}, 12345)`);
    assert.deepEqual([...delays()], [12345]);
  });

  it("no timer while league detail open", () => {
    render();
    const card = app.document.querySelector(".league-pick-card");
    card.click();
    app.eval("window.__calls = []");
    app.eval(`scheduleNextRefresh(${JSON.stringify(live())})`);
    assert.deepEqual([...delays()], []);
  });

  it("no timer while powered off", () => {
    render();
    app.document.getElementById("powerToggle").click();
    app.eval("window.__calls = []");
    app.eval(`scheduleNextRefresh(${JSON.stringify(live())})`);
    assert.deepEqual([...delays()], []);
  });

  it("error backoff 2m/5m/10m capped", () => {
    app.eval("__T.consecutiveRefreshErrors = 1");
    app.eval("scheduleErrorRetry()");
    assert.deepEqual([...delays()], [120000]);
    app.eval("window.__calls = []; __T.consecutiveRefreshErrors = 2");
    app.eval("scheduleErrorRetry()");
    assert.deepEqual([...delays()], [300000]);
    app.eval("window.__calls = []; __T.consecutiveRefreshErrors = 99");
    app.eval("scheduleErrorRetry()");
    assert.deepEqual([...delays()], [600000]);
  });

  it("loadMatches clears the previous timer before fetching", async () => {
    app.eval(`scheduleNextRefresh(${JSON.stringify(live())})`);
    const timerId = app.eval("window.__calls[0].id");
    app.eval("window.__cleared = []");
    await app.eval("loadMatches()");
    assert.ok(app.eval("window.__cleared").includes(timerId), "previous timer cleared");
  });

  it("stops refresh while hidden and resumes the remaining delay when visible", () => {
    render();
    app.eval(`lastFetchCompletedAt = Date.now() - 5000;
      scheduleNextRefresh(lastPayload);
      resetInactivityTimer();
      Object.defineProperty(document, "hidden", { value: true, writable: true });
      document.dispatchEvent(new Event("visibilitychange"));`);
    assert.ok(app.eval("window.__cleared").includes(app.eval("refreshTimer")));
    assert.ok(app.eval("window.__cleared").includes(app.eval("inactivityTimer")));
    app.eval(`window.__calls = [];
      document.hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));`);
    assert.ok(delays().includes(180000), "inactivity timer restored");
    const next = delays().at(-1);
    assert.ok(next > 50000 && next <= 55000, "visible refresh keeps the remaining delay");
  });

  it("resumes from inactivity on interaction but honors an expired session", () => {
    render();
    app.eval("lastFetchCompletedAt = Date.now(); scheduleNextRefresh(lastPayload); handleInactivityPause()");
    assert.equal(app.eval("__T.inactivePaused"), true);
    assert.ok(app.eval("window.__cleared").includes(app.eval("refreshTimer")));
    app.document.dispatchEvent(new app.window.Event("mousemove"));
    assert.equal(app.eval("__T.inactivePaused"), false);
    app.eval("sessionStartedAt = Date.now() - AUTO_PAUSE_AFTER_MS; handleVisibilityChange()");
    assert.equal(app.eval("__T.autoPausedForSession"), true);
  });
});
