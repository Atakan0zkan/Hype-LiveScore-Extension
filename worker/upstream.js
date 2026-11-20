import { MAX_API_URL_LENGTH } from "./http.js";

const DEFAULT_FETCH_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};
const ESPN_SCOREBOARD_EVENT_LIMIT = 1000;
const ESPN_SCOREBOARD_URL =
  `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?limit=${ESPN_SCOREBOARD_EVENT_LIMIT}`;
const THESPORTSDB_LIVE_SCORE_URL =
  "https://www.thesportsdb.com/api/v2/json/livescore/soccer";
const ESPN_STANDINGS_BASE_URL =
  "https://site.api.espn.com/apis/v2/sports/soccer";
const ESPN_SUMMARY_BASE_URL =
  "https://site.api.espn.com/apis/site/v2/sports/soccer";

const UPSTREAM_FETCH_TIMEOUT_MS = 8000;
const MAX_UPSTREAM_BODY_BYTES = 8 * 1024 * 1024;

async function fetchJson(url, init = {}, validate = null) {
  url = validateUpstreamUrl(url);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_FETCH_TIMEOUT_MS);
  const externalSignal = init.signal;
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const urls = [url];
  const alternateUrl = getAlternateEspnUrl(url);
  if (alternateUrl) urls.push(alternateUrl);

  try {
    if (controller.signal.aborted) {
      const error = new Error("Request aborted");
      error.name = "AbortError";
      throw error;
    }
    for (let index = 0; index < urls.length; index += 1) {
      try {
        const response = await fetch(urls[index], {
          ...init,
          // Workers forwards custom headers across redirects in follow mode.
          // In particular, never send a provider API key to a redirect target.
          redirect: "manual",
          signal: controller.signal,
          headers: {
            ...DEFAULT_FETCH_HEADERS,
            ...(init.headers || {}),
          },
        });

        if (!response.ok) {
          const error = new Error(`${urls[index]} returned ${response.status}`);
          error.status = response.status;
          await response.body?.cancel().catch(() => {});
          throw error;
        }

        /* SEC-03: validate Content-Type before parsing */
        const contentType = response.headers.get("content-type") || "";
        if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
          await response.body?.cancel();
          throw new Error("Upstream returned an unexpected Content-Type");
        }

        // Both ESPN hosts share one deadline, including response body consumption.
        const payload = await readBoundedUpstreamJson(response, controller.signal);
        if (validate) validate(payload);
        return payload;
      } catch (error) {
        // Do not turn missing seasons, authentication failures or rate limits
        // into extra requests. In particular, World Cup 2030's 400/404 stays empty.
        const canRetry = error?.status == null || error.status === 403 ||
          error.status === 408 || (error.status >= 500 && error.status <= 599);
        if (index === urls.length - 1 || !canRetry ||
            controller.signal.aborted || init.signal?.aborted || error?.name === "AbortError") {
          throw error;
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

function validateUpstreamUrl(value) {
  const text = String(value);
  if (text.length > MAX_API_URL_LENGTH) throw new Error("Unsupported upstream destination");
  const url = new URL(text);
  const espn = (url.origin === "https://site.api.espn.com" || url.origin === "https://site.web.api.espn.com") &&
    (url.pathname.startsWith("/apis/site/v2/sports/soccer/") || url.pathname.startsWith("/apis/v2/sports/soccer/"));
  if (url.username || url.password || url.hash || (!espn && url.href !== THESPORTSDB_LIVE_SCORE_URL)) {
    throw new Error("Unsupported upstream destination");
  }
  return url.href;
}

async function readBoundedUpstreamJson(response, signal) {
  const oversized = () => Object.assign(new Error("Upstream response exceeds size limit"), { status: 413 });
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPSTREAM_BODY_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw oversized();
  }
  // A real response without a body is empty. This also preserves lightweight
  // test adapters whose json() method models a pending, abort-aware body.
  if (!response.body) return response.json();
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let rejectAborted;
  const aborted = new Promise((_resolve, reject) => { rejectAborted = reject; });
  const onAbort = () => {
    void reader.cancel().catch(() => {});
    rejectAborted(Object.assign(new Error("Upstream body read aborted"), { name: "AbortError" }));
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_UPSTREAM_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw oversized();
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return await new Response(body).json();
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

function getAlternateEspnUrl(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.origin === "https://site.web.api.espn.com") {
      url.hostname = "site.api.espn.com";
    } else if (url.origin === "https://site.api.espn.com") {
      url.hostname = "site.web.api.espn.com";
    } else {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

async function fetchFutureWorldCupJson(url) {
  try {
    return await fetchJson(url);
  } catch (error) {
    // An unpublished future season is empty; never fetch an older tournament.
    // Preserve genuine outages rather than reporting them as missing data.
    if (error?.status === 400 || error?.status === 404) return {};
    throw error;
  }
}

export {
  fetchFutureWorldCupJson,
  ESPN_STANDINGS_BASE_URL,
  fetchJson,
  ESPN_SUMMARY_BASE_URL,
  THESPORTSDB_LIVE_SCORE_URL,
  ESPN_SCOREBOARD_URL,
  ESPN_SCOREBOARD_EVENT_LIMIT,
};
