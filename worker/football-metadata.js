import { safeHttpsUrl } from "./http.js";

const ESPN_LEAGUE_LOGO_BASE = "https://a.espncdn.com/i/leaguelogos/soccer";
const ESPN_LINK_HOST_SUFFIXES = ["espn.com"];
const ESPN_MEDIA_HOST_SUFFIXES = ["espncdn.com"];
const TEAM_LOGO_OVERRIDE_HOST_SUFFIXES = ["cancunfc.mx"];

const FIFA_WORLD_CUP_LEAGUE_CODE = "fifa.world";
const FIFA_WORLD_CUP_YEAR = 2030;
const FIFA_WORLD_CUP_DATES = String(FIFA_WORLD_CUP_YEAR);
const DANISH_SUPERLIGA_LOGO_URL =
  "https://commons.wikimedia.org/wiki/Special:Redirect/file/Superliga_2010.svg?width=512&type=png";
const UEFA_CONFERENCE_LEAGUE_LOGO_URL =
  "https://commons.wikimedia.org/wiki/Special:Redirect/file/UEFA_Conference_League_full_logo_(2024_version).svg?width=512&type=png";
const CANCUN_FC_LOGO_URL =
  "https://www.cancunfc.mx/cdn/shop/files/LOGOS_CANUN_FC.png?v=1764009552&width=512";
const TEAM_LOGO_OVERRIDES_BY_ID = new Map([
  ["20724", CANCUN_FC_LOGO_URL],
]);
const TEAM_LOGO_OVERRIDES_BY_NAME = new Map([
  ["cancun", CANCUN_FC_LOGO_URL],
  ["cancun fc", CANCUN_FC_LOGO_URL],
]);

/*
 * ESPN uses a separate "logo ID" for league images that differs from the
 * league numeric ID in the scoreboard uid.  The logoId values below were
 * sourced from the per-league /scoreboard endpoint's `leagues[].logos[]`
 * array.  When a logoId is not known the frontend falls back to a generic
 * soccer ball SVG.
 */
const ESPN_LEAGUES_BY_ID = {
  "606": {
    code: "fifa.world",
    name: "FIFA World Cup 2030",
    logoId: "4",
    logoTone: "light",
  },
  "775": {
    code: "uefa.champions",
    name: "UEFA Champions League",
    logoId: "2",
    logoStyle: "dark",
  },
  "780": {
    code: "conmebol.america",
    name: "Copa América",
    logoId: "83",
  },
  "781": {
    code: "uefa.euro",
    name: "UEFA European Championship",
    logoId: "74",
  },
  "700": { code: "eng.1", name: "English Premier League", logoId: "23" },
  "710": { code: "fra.1", name: "Ligue 1", logoId: "9" },
  "715": { code: "por.1", name: "Portuguese Primeira Liga", logoId: "14" },
  "720": { code: "ger.1", name: "German Bundesliga", logoId: "10" },
  "725": { code: "ned.1", name: "Dutch Eredivisie", logoId: "11" },
  "730": { code: "ita.1", name: "Italian Serie A", logoId: "12" },
  "735": { code: "sco.1", name: "Scottish Premiership", logoId: "45" },
  "740": { code: "esp.1", name: "LaLiga", logoId: "15" },
  "745": { code: "arg.1", name: "Argentine Liga Profesional", logoId: "1" },
  "760": { code: "mex.1", name: "Mexican Liga MX", logoId: "22" },
  "770": { code: "usa.1", name: "MLS", logoId: "19" },
  "776": {
    code: "uefa.europa",
    name: "UEFA Europa League",
    logoId: "2310",
    logoStyle: "dark",
  },
  "3901": { code: "bel.1", name: "Belgian Pro League", logoId: "6" },
  "3906": {
    code: "aus.1",
    name: "Australian A-League Men",
    logoId: "1308",
    logoStyle: "dark",
  },
  "3907": { code: "aut.1", name: "Austrian Bundesliga", logoId: "5" },
  "3913": {
    code: "den.1",
    name: "Danish Superliga",
    logoId: null,
    logoUrl: DANISH_SUPERLIGA_LOGO_URL,
    logoTone: "light",
  },
  "3914": { code: "eng.2", name: "English Championship", logoId: "24" },
  "3918": { code: "eng.fa", name: "English FA Cup", logoId: "40" },
  "3922": { code: "fifa.friendly", name: "International Friendlies", hasStandings: false },
  "3927": {
    code: "ger.2",
    name: "German 2. Bundesliga",
    logoId: "97",
    logoStyle: "default",
  },
  "3932": {
    code: "mex.2",
    name: "Mexican Liga de Expansion MX",
    logoId: "2306",
  },
  "3939": { code: "rus.1", name: "Russian Premier League", logoId: "106" },
  "3945": {
    code: "swe.1",
    name: "Swedish Allsvenskan",
    logoId: "16",
    logoStyle: "default",
  },
  "3946": { code: "tur.1", name: "Turkish Super Lig", logoId: "18" },
  "3955": {
    code: "gre.1",
    name: "Greek Super League",
    logoId: "98",
    logoStyle: "default",
  },
  "8097": {
    code: "eng.w.1",
    name: "English Women's Super League",
    logoId: "2314",
  },
  "20296": {
    code: "uefa.europa.conf",
    name: "UEFA Conference League",
    logoId: null,
    logoUrl: UEFA_CONFERENCE_LEAGUE_LOGO_URL,
    logoTone: "light",
  },
  "4002": {
    code: "usa.usl.1",
    name: "USL Championship",
    logoId: "2292",
    logoTone: "light",
  },
  "2395": {
    code: "uefa.nations",
    name: "UEFA Nations League",
    logoId: "2395",
  },
};

const ESPN_LEAGUES_BY_CODE = new Map(
  Object.values(ESPN_LEAGUES_BY_ID).map((league) => [league.code, league]),
);

function getEspnTeamName(competitor) {
  return (
    competitor.team?.displayName ||
    competitor.team?.shortDisplayName ||
    competitor.team?.name ||
    "Unknown Team"
  );
}

function getEspnTeamId(competitor) {
  return competitor.team?.id ? String(competitor.team.id) : "";
}

function getEspnTeamLogo(competitor) {
  return getTeamLogoFromTeam(competitor.team);
}

function getTeamLogoFromTeam(team) {
  if (!team) {
    return null;
  }

  if (Array.isArray(team.logos)) {
    const logos = team.logos.slice(0, 16).filter((logo) => logo && typeof logo === "object").map((logo) => {
      const dimension = (value) => typeof value === "number" || typeof value === "string" ? Number(value) : 0;
      const size = Math.min(dimension(logo.width), dimension(logo.height));
      return {
        url: safeHttpsUrl(logo.href, ESPN_MEDIA_HOST_SUFFIXES),
        isDefault: Array.isArray(logo.rel) && logo.rel.includes("default"),
        size: Number.isFinite(size) && size > 0 ? Math.min(size, 4096) : 0,
      };
    }).filter((logo) => logo.url).sort((a, b) => b.size - a.size || Number(b.isDefault) - Number(a.isDefault));
    if (logos.length > 0) return logos[0].url;
  }

  if (team.logo) {
    const logo = safeHttpsUrl(team.logo, ESPN_MEDIA_HOST_SUFFIXES);
    if (logo) return logo;
  }

  const overrideLogo = getTeamLogoOverrideFromTeam(team);
  if (overrideLogo) {
    return overrideLogo;
  }

  if (team.id) {
    const teamId = sanitizeEspnAssetId(team.id);
    return teamId
      ? `https://a.espncdn.com/i/teamlogos/soccer/500/${teamId}.png`
      : null;
  }

  return null;
}

function getTeamLogoOverrideFromTeam(team) {
  const teamId = sanitizeEspnAssetId(team?.id);
  const idOverride = TEAM_LOGO_OVERRIDES_BY_ID.get(teamId);
  if (idOverride) {
    return safeHttpsUrl(idOverride, TEAM_LOGO_OVERRIDE_HOST_SUFFIXES);
  }

  const names = [
    team?.displayName,
    team?.shortDisplayName,
    team?.name,
    team?.location,
  ];

  for (const name of names) {
    const override = TEAM_LOGO_OVERRIDES_BY_NAME.get(normalizeLookupName(name));
    if (override) {
      return safeHttpsUrl(override, TEAM_LOGO_OVERRIDE_HOST_SUFFIXES);
    }
  }

  return null;
}

function normalizeLookupName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractLeagueId(uid) {
  return String(uid || "").match(/~l:(\d+)/)?.[1] || "";
}

function getPayloadLeagueMetadata(payload) {
  const league = Array.isArray(payload?.leagues) ? payload.leagues[0] : null;

  if (!league) {
    return null;
  }

  return {
    id: league.id ? String(league.id) : "",
    code: league.slug || "",
    name: league.name || league.displayName || formatLeagueName(league.slug),
    logoUrl: getLeagueLogoFromPayload(league),
  };
}

function getLeagueLogoFromPayload(league) {
  if (!Array.isArray(league?.logos)) {
    return null;
  }

  const logo =
    league.logos.find((item) => Array.isArray(item.rel) && item.rel.includes("default")) ||
    league.logos[0];

  return safeHttpsUrl(logo?.href, ESPN_MEDIA_HOST_SUFFIXES);
}

function getLeagueMetadata(leagueId, seasonSlug, payloadLeague = null) {
  const metadata = ESPN_LEAGUES_BY_ID[leagueId] ||
    getLeagueMetadataByCode(payloadLeague?.code);

  if (metadata) {
    return {
      ...metadata,
      id: leagueId || metadata.id || metadata.code || "",
      logoStyle: metadata.logoStyle || "default",
      logoUrl: metadata.logoUrl || payloadLeague?.logoUrl || null,
    };
  }

  return {
    id: leagueId || "",
    code: null,
    name: payloadLeague?.name || formatLeagueName(seasonSlug),
    logoId: null,
    logoStyle: "default",
    logoUrl: payloadLeague?.logoUrl || null,
  };
}

function getLeagueMetadataByCode(leagueCode) {
  if (!leagueCode) {
    return null;
  }

  return ESPN_LEAGUES_BY_CODE.get(leagueCode) || null;
}

function buildLeagueLogoUrl(logoId, logoStyle = "default") {
  const safeLogoId = sanitizeEspnAssetId(logoId);
  if (!safeLogoId) return null;
  const directory = logoStyle === "default" ? "500" : "500-dark";
  return `${ESPN_LEAGUE_LOGO_BASE}/${directory}/${safeLogoId}.png`;
}

function sanitizeEspnAssetId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9._-]{1,64}$/i.test(id) ? id : "";
}

function isSupportedLeagueCode(leagueCode) {
  return ESPN_LEAGUES_BY_CODE.has(leagueCode);
}

function formatVenue(venue) {
  if (!venue) {
    return "";
  }

  const name = venue.fullName || venue.name || "";
  const address = venue.address || {};
  const location = [
    address.city,
    address.state,
    address.country,
  ].filter(Boolean).join(", ");

  if (name && location) {
    return `${name} · ${location}`;
  }

  return name || location;
}

function formatLeagueName(slugOrName) {
  if (!slugOrName) {
    return "Unknown League";
  }

  return String(slugOrName)
    .replace(/^\d{4}(-\d{2,4})?-/, "")
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export {
  ESPN_LEAGUES_BY_CODE,
  isSupportedLeagueCode,
  FIFA_WORLD_CUP_LEAGUE_CODE,
  FIFA_WORLD_CUP_YEAR,
  FIFA_WORLD_CUP_DATES,
  getPayloadLeagueMetadata,
  extractLeagueId,
  getLeagueMetadata,
  getEspnTeamName,
  getEspnTeamId,
  getEspnTeamLogo,
  toNumber,
  formatVenue,
  formatLeagueName,
  getTeamLogoFromTeam,
  ESPN_LINK_HOST_SUFFIXES,
  ESPN_MEDIA_HOST_SUFFIXES,
  ESPN_LEAGUES_BY_ID,
  buildLeagueLogoUrl,
};
