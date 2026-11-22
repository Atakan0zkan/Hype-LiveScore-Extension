/**
 * Hype - Live Football Scores
 * Popup script — dependency-free Chrome MV3 UI.
 */

const EXTENSION_VERSION =
  globalThis.chrome?.runtime?.getManifest?.().version || "unknown";
const BACKEND_URL = buildBackendUrl(
  "https://api.atakanozkan.com/live-matches",
);
const LIVE_REFRESH_INTERVAL_MS = 60000;
const IDLE_REFRESH_INTERVAL_MS = 300000;
const QUIET_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const UPCOMING_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const STALE_VISIBLE_REFRESH_MS = 30000;
const DETAIL_RETURN_REFRESH_MIN_INTERVAL_MS = 60000;
const AUTO_PAUSE_AFTER_MS = 10 * 60 * 1000;
const INACTIVITY_PAUSE_AFTER_MS = 3 * 60 * 1000;
const ACTIVITY_TIMER_RESET_THROTTLE_MS = 1000;
const ERROR_RETRY_DELAYS_MS = [120000, 300000, 600000];
const DAILY_REQUEST_LIMIT = 2000;
const CLIENT_LIVE_CACHE_VERSION = "v12";
const CLIENT_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
const REQUIRED_CLIENT_CACHE_LEAGUE_CODES = [
  "fifa.world",
  "uefa.nations",
  "uefa.euro",
  "conmebol.america",
];
const FIFA_WORLD_CUP_LEAGUE_CODE = "fifa.world";
const FIFA_WORLD_CUP_YEAR = 2030;
const CLIENT_LIVE_CACHE_MAX_AGE_LIVE_MS = 30000;
const CLIENT_LIVE_CACHE_MAX_AGE_IDLE_MS = 120000;
const CLIENT_LIVE_CACHE_MAX_AGE_QUIET_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10000;
const LAZY_ERROR_RETRY_MS = 60000;
const STORAGE_KEY_ENABLED = "hype_enabled";
const STORAGE_KEY_FAVORITE_LEAGUES = "hype_favorite_leagues";
const STORAGE_KEY_LIVE_CACHE = "hype_live_matches_cache";
const STORAGE_KEY_DAILY_REQUEST_BUCKET = "hype_daily_request_count";
const STORAGE_KEY_ENGLISH_OVERRIDE = "hype_english_override";
const STORAGE_KEY_POPUP_SIZE = "hype_popup_size";
const LEGACY_STORAGE_KEY_FAVORITE_TEAMS = "hype_favorite_teams";
const POPUP_SIZES = new Set(["small", "default", "big"]);
const SETTINGS_FILE_FORMAT = "hype-score-preferences";
const SETTINGS_FILE_VERSION = 1;
const MAX_SETTINGS_FILE_BYTES = 64 * 1024;

const LOCAL_LEAGUE_LOGOS = {
  "arg.1": "icons/leagues/arg-1.png",
  "aus.1": "icons/leagues/aus-1.png",
  "aut.1": "icons/leagues/aut-1.png",
  "bel.1": "icons/leagues/bel-1.png",
  "conmebol.america": "icons/leagues/conmebol-america.png",
  "den.1": "icons/leagues/den-1.png",
  "eng.1": "icons/leagues/eng-1.png",
  "eng.2": "icons/leagues/eng-2.png",
  "eng.fa": "icons/leagues/eng-fa.png",
  "eng.w.1": "icons/leagues/eng-w-1.png",
  "esp.1": "icons/leagues/esp-1.png",
  "fifa.friendly": "icons/leagues/international-friendlies.svg",
  "fifa.world": "icons/leagues/fifa-world.png",
  "fra.1": "icons/leagues/fra-1.png",
  "ger.1": "icons/leagues/ger-1.png",
  "ger.2": "icons/leagues/ger-2.png",
  "gre.1": "icons/leagues/gre-1.png",
  "ita.1": "icons/leagues/ita-1.png",
  "mex.1": "icons/leagues/mex-1.png",
  "mex.2": "icons/leagues/mex-2.png",
  "ned.1": "icons/leagues/ned-1.png",
  "por.1": "icons/leagues/por-1.png",
  "rus.1": "icons/leagues/rus-1.png",
  "sco.1": "icons/leagues/sco-1.png",
  "swe.1": "icons/leagues/swe-1.png",
  // Official TFF wordmark: https://www.tff.org/Images/Common/tsl.png
  "tur.1": "icons/leagues/tur-1.png?v=trendyol-2024",
  "uefa.champions": "icons/leagues/uefa-champions.png",
  "uefa.europa": "icons/leagues/uefa-europa.png",
  "uefa.europa.conf": "icons/leagues/uefa-europa-conf.png",
  "uefa.euro": "icons/leagues/uefa-euro.png",
  "uefa.nations": "icons/leagues/uefa-nations.png",
  "usa.1": "icons/leagues/usa-1.png",
  "usa.usl.1": "icons/leagues/usa-usl-1.png",
};

// Approximate club popularity, not a live match audience or unique-user count.
// Curated subset of CIES Weekly Post 548 (official accounts, May 2026),
// rounded to 0.1 million followers. ESPN IDs were checked against its team API.
// https://football-observatory.com/IMG/sites/b5wp/2025/wp548/en/
// No remote ranking request is made by the extension.
const CLUB_POPULARITY_SNAPSHOT = [
  [["86"], 4876, ["Real Madrid"]],
  [["83"], 4418, ["FC Barcelona", "Barcelona"]],
  [["360"], 2386, ["Manchester United", "Manchester Utd", "Man United", "Man Utd"]],
  [["160"], 2081, ["Paris St-Germain", "Paris Saint-Germain", "PSG"]],
  [["382"], 1878, ["Manchester City", "Man City"]],
  [["364"], 1792, ["Liverpool FC", "Liverpool"]],
  [["111"], 1783, ["Juventus FC", "Juventus"]],
  [["132"], 1652, ["Bayern München", "Bayern Munich", "Bayern Munchen"]],
  [["363"], 1565, ["Chelsea FC", "Chelsea"]],
  [["359"], 1185, ["Arsenal FC", "Arsenal"]],
  [["367"], 1122, ["Tottenham Hotspur", "Tottenham", "Spurs"]],
  [["1068"], 914, ["Atlético Madrid", "Atletico Madrid"]],
  [["110"], 827, ["FC Inter", "Internazionale", "Inter Milan"]],
  [["103"], 810, ["AC Milan"]],
  [["124"], 646, ["Borussia Dortmund"]],
  [["432"], 546, ["Galatasaray SK", "Galatasaray"]],
  [["104"], 434, ["AS Roma", "Roma"]],
  [["20232"], 432, ["Inter Miami", "Inter Miami CF"]],
  [["436"], 393, ["Fenerbahçe SK", "Fenerbahce"]],
  [["5"], 310, ["Boca Juniors"]],
  [["16"], 303, ["River Plate"]],
  [["227"], 297, ["CF América", "América", "Club América"]],
  [["244"], 291, ["Real Betis"]],
  [["243"], 286, ["Sevilla FC", "Sevilla"]],
  [["139"], 269, ["AFC Ajax", "Ajax Amsterdam", "Ajax"]],
  [["174"], 250, ["AS Monaco"]],
  [["89"], 245, ["Real Sociedad"]],
  [[], 243, ["Leicester City"]],
  [["176"], 238, ["Olympique Marseille", "Marseille"]],
  [["1895"], 223, ["Beşiktaş JK", "Besiktas"]],
  [["361"], 213, ["Newcastle United"]],
  [["219"], 208, ["Chivas Guadalajara", "Guadalajara"]],
  [["371"], 203, ["West Ham United"]],
  [["114"], 201, ["SSC Napoli", "Napoli"]],
  [["362"], 196, ["Aston Villa"]],
  [["94"], 192, ["Valencia CF", "Valencia"]],
  [["93"], 190, ["Athletic Club", "Athletic Bilbao"]],
  [["131"], 186, ["Bayer Leverkusen"]],
  [["368"], 177, ["Everton FC", "Everton"]],
  [["3842"], 171, ["Cádiz CF", "Cadiz"]],
];
const CLUB_POPULARITY_BY_ID = new Map(CLUB_POPULARITY_SNAPSHOT.flatMap(([ids, weight]) => ids.map(id => [id, weight])));
const CLUB_POPULARITY_BY_NAME = new Map(CLUB_POPULARITY_SNAPSHOT.flatMap(([, weight, names]) => names.map(name => [normalizePopularityTeamName(name), weight])));
// Club reach cannot be reused as a national-team or women's-team ranking.
const CLUB_POPULARITY_LEAGUES = new Set(Object.keys(LOCAL_LEAGUE_LOGOS).filter(code =>
  !["eng.w.1", "fifa.world", "fifa.friendly", "uefa.nations", "uefa.euro", "conmebol.america"].includes(code)));

const FALLBACK_LOGO_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
  '<circle cx="16" cy="16" r="14" fill="#2a1414" stroke="#d64b45" stroke-width="1"/>',
  '<text x="16" y="20" text-anchor="middle" fill="#ef7468" ',
  'font-size="14" font-family="sans-serif">⚽</text>',
  "</svg>",
].join("");

const FALLBACK_LOGO = "data:image/svg+xml," + encodeURIComponent(FALLBACK_LOGO_SVG);

function buildBackendUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.searchParams.set("client", "extension");
  if (url.pathname === "/live-matches") url.searchParams.set("allowStale", "1");
  if (/^\d+(?:\.\d+){0,3}$/.test(EXTENSION_VERSION)) {
    url.searchParams.set("version", EXTENSION_VERSION);
  }
  return url.href;
}

function normalizePopularityTeamName(name) {
  if (typeof name !== "string") return "";
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isFilePreview() {
  return window.location.protocol === "file:";
}
