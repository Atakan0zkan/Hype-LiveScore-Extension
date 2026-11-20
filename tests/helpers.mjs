import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readPopupSources } from "../tools/popup-sources.mjs";

const ROOT = new URL("../", import.meta.url);
const WORKER_ENTRY = new URL("worker/index.js", ROOT);
const WORKER_IMPORT = /^import \{[^}]*\} from "(\.\/[a-z0-9-]+\.js)";$/gm;
const WORKER_EXPORT = /^export \{[^}]*\};$/gm;
let popupSources;
let workerSources;

export function loadPopupAssets() {
  return popupSources ??= readPopupSources();
}

async function readWorkerModules() {
  const modules = new Map();
  const pending = new Set();
  async function visit(url) {
    if (modules.has(url.href)) return;
    if (pending.has(url.href)) throw new Error("Circular Worker dependency: " + url.href);
    pending.add(url.href);
    const source = await readFile(url, "utf8");
    for (const [, path] of source.matchAll(WORKER_IMPORT)) await visit(new URL(path, url));
    pending.delete(url.href);
    modules.set(url.href, { url, source });
  }
  await visit(WORKER_ENTRY);
  return [...modules.values()];
}

function loadWorkerModules() {
  return workerSources ??= readWorkerModules();
}

export async function loadWorkerSource() {
  return (await loadWorkerModules()).map(module => module.source).join("\n");
}

export async function loadPopupSource() {
  return (await loadPopupAssets()).scripts.map(script => script.source).join("\n");
}

export async function runPopupScripts(ctx) {
  for (const { url, source } of (await loadPopupAssets()).scripts) {
    vm.runInContext(source, ctx, { filename: fileURLToPath(url) });
  }
}

export async function runWorkerScripts(ctx) {
  // Unit probes use isolated VM globals and address internal bindings by name.
  // Link the Worker's local named imports in dependency order, retaining source
  // filenames and line offsets. The standalone regression also runs native ESM.
  const blank = declaration => declaration.replace(/[^\r\n]/g, " ");
  for (const { url, source } of await loadWorkerModules()) {
    const runnable = source.replace(WORKER_IMPORT, blank)
      .replace(WORKER_EXPORT, blank)
      .replace(/^export default /m, "const __workerDefault = ");
    vm.runInContext(runnable, ctx, { filename: fileURLToPath(url) });
  }
}

// Minimal VM for worker pure functions. No network, no deps.
export async function loadWorkerContext(overrides = {}) {
  const source = await loadWorkerSource();
  const quiet = { log() {}, warn() {}, error: (...a) => console.error(...a) };
  const ctx = vm.createContext({
    URL, Request, Response, Headers, AbortController, console: quiet,
    setTimeout, clearTimeout, queueMicrotask,
    fetch: overrides.fetch ?? (async () => {
      throw new Error("fetch not stubbed");
    }),
    caches: overrides.caches ?? {
      default: { match: async () => undefined, put: async () => undefined },
    },
    ...overrides.globals,
  });
  await runWorkerScripts(ctx);
  return { ctx, run: (expr) => vm.runInContext(expr, ctx), source };
}

// In-memory Cache API stand-in keyed by URL. Stores status+body.
export function memoryCache() {
  const store = new Map();
  return {
    async match(req) {
      const hit = store.get(String(req.url || req));
      return hit ? new Response(hit.body, { status: hit.status, headers: hit.headers }) : undefined;
    },
    async put(req, res) {
      store.set(String(req.url || req), { body: await res.clone().text(), status: res.status, headers: [...res.headers] });
    },
    size: () => store.size,
  };
}

// Minimal ESPN scoreboard event for eng.1 (league id 700).
export function espnEvent({ id = "760486", leagueId = "700", state = "in", kickoff = null } = {}) {
  const team = (homeAway, name) => ({
    homeAway, score: state === "in" ? "1" : "0",
    team: { id: homeAway === "home" ? "331" : "332", displayName: name },
  });
  return {
    id, uid: `s:500~l:${leagueId}~e:${id}`,
    date: kickoff || new Date().toISOString(),
    competitions: [{
      id, date: kickoff || new Date().toISOString(),
      status: { type: { state } },
      competitors: [team("home", "Home FC"), team("away", "Away FC")],
      venue: {},
    }],
  };
}

export function scoreboardResponse(events) {
  return new Response(JSON.stringify({ leagues: [], events }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

// Minimal VM for popup pure logic. Mirrors hardening-test stub:
// DOMContentLoaded never fires in VM, so heavy DOM init is skipped.
export async function loadPopupContext() {
  const source = await loadPopupSource();
  const storage = new Map();
  const quiet = { log() {}, warn() {}, error: (...a) => console.error(...a) };
  const ctx = vm.createContext({
    URL, AbortController, console: quiet, setTimeout, clearTimeout, queueMicrotask,
    Date, JSON, Math, Number, Object, Array, Set, Map, Promise, RegExp, Error,
    encodeURIComponent, decodeURIComponent,
    document: { addEventListener() {}, hidden: false, createElement: () => { throw new Error("DOM not needed"); } },
    window: { location: { protocol: "chrome-extension:" } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
  });
  await runPopupScripts(ctx);
  return { ctx, run: (expr) => vm.runInContext(expr, ctx), storage, source };
}

export function matchRow(over = {}) {
  return {
    id: "760486", leagueCode: "eng.1", homeTeam: "Home", awayTeam: "Away",
    state: "live", status: "1H", minute: "23'", kickoff: new Date().toISOString(),
    ...over,
  };
}

export function livePayload({ live = true, upcoming = false } = {}) {
  const matches = [];
  if (live) matches.push(matchRow({ state: "live" }));
  if (upcoming) {
    matches.push(matchRow({
      id: "760487", state: "scheduled",
      kickoff: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    }));
  }
  const codes = ["fifa.world", "uefa.nations", "uefa.euro", "conmebol.america", "eng.1"];
  return {
    matches,
    leagues: codes.map((code) => ({ code, name: code, matches: [] })),
  };
}

export { ROOT };
