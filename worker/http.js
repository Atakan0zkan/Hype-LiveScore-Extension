const MAX_API_URL_LENGTH = 2048;

const ALLOWED_ORIGINS = new Set([
  "chrome-extension://cdnpjnmhmagmiefkleefgchgffeaacaa",
]);

const securityHeaders = {
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

async function safeReadJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function safeHttpsUrl(value, allowedHostSuffixes = null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      return null;
    }

    if (!isAllowedHostname(url.hostname, allowedHostSuffixes)) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function getRequestOriginPolicy(request) {
  const origin = request.headers.get("Origin");
  if (origin) {
    const allowed = isAllowedCorsOrigin(origin);
    return {
      allowed,
      reason: allowed ? "allowed-origin" : "blocked-origin",
    };
  }

  if (isLikelyExtensionFetchWithoutOrigin(request)) {
    return { allowed: true, reason: "allowed-extension-fetch-without-origin" };
  }

  return { allowed: false, reason: "missing-origin" };
}

function isLikelyExtensionFetchWithoutOrigin(request) {
  const userAgent = request.headers.get("User-Agent") || "";
  if (!/\b(Chrome|Chromium|Edg)\//.test(userAgent)) {
    return false;
  }

  const fetchMode = request.headers.get("Sec-Fetch-Mode");
  const fetchDest = request.headers.get("Sec-Fetch-Dest");
  const fetchSite = request.headers.get("Sec-Fetch-Site");

  const hasBrowserFetchShape =
    (!fetchMode || fetchMode === "cors") &&
    (!fetchDest || fetchDest === "empty") &&
    (!fetchSite || fetchSite === "none" || fetchSite === "cross-site");

  return hasBrowserFetchShape;
}

function corsHeadersForRequest(request) {
  const origin = request?.headers?.get("Origin") || "";
  const allowedOrigin = isAllowedCorsOrigin(origin)
    ? origin
    : ALLOWED_ORIGINS.values().next().value;

  return {
    ...securityHeaders,
    "Access-Control-Allow-Origin": allowedOrigin,
    Vary: "Origin",
  };
}

function isAllowedCorsOrigin(origin) {
  return ALLOWED_ORIGINS.has(origin) || isChromeExtensionOrigin(origin);
}

function isChromeExtensionOrigin(origin) {
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}

function isAllowedHostname(hostname, allowedHostSuffixes) {
  if (!allowedHostSuffixes) {
    return true;
  }

  return allowedHostSuffixes.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}

function jsonResponse(body, options = {}) {
  return new Response(JSON.stringify(body), {
    status: options.status || 200,
    headers: responseHeaders(options),
  });
}

function responseHeaders(options = {}) {
  return {
    ...corsHeadersForRequest(options.request),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": options.cacheControl || "no-store",
    "X-Cache": options.cache || "BYPASS",
    "X-Data-Source": options.source || "none",
    "X-Worker-Revision": "v19-20261107-scoreboard",
    ...(options.retryAfter ? { "Retry-After": String(options.retryAfter) } : {}),
  };
}

async function responseForRequest(response, request) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeadersForRequest(request))) {
    headers.set(name, value);
  }

  return new Response(await response.clone().text(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/*
 * Privacy-preserving product analytics schema (Workers Analytics Engine):
 * blob1 endpoint, blob2 country, blob3 client, blob4 client version,
 * blob5 browser family, blob6 browser major, blob7 status class,
 * blob8 cache result, blob9 data source, blob10 league code,
 * blob11 origin policy, blob12 Cloudflare colo, blob13 method.
 * double1 request count, double2 duration in milliseconds, double3 status.
 *
 * The dataset intentionally contains no IP address, persistent client ID,
 * event ID, account ID, favorite, browsing history, or cross-site data.
 */

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export {
  jsonResponse,
  MAX_API_URL_LENGTH,
  getRequestOriginPolicy,
  responseHeaders,
  getErrorMessage,
  responseForRequest,
  safeHttpsUrl,
  safeReadJsonResponse,
};
