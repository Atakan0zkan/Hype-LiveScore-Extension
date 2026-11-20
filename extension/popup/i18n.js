const FALLBACK_MESSAGES = {
  appTitle: "Hype Scores",
  autoPaused: "Automatic refresh paused to reduce requests.",
  backToLeagues: "← Leagues",
  bracket: "Knockout",
  bracketUnavailable: "Knockout bracket unavailable.",
  broadcasts: "Broadcasts",
  club: "Club",
  detailsUnavailable: "Details unavailable",
  draws: "D",
  empty: "No matches found today.",
  error: "Could not load data",
  extDescription: "Live football scores, fixtures, results and league tables.",
  extName: "Hype - Live Football Scores",
  extensionRuntimeRequired:
    "Live data is unavailable in file previews. Open the Chrome extension popup to load scores.",
  favorite: "Add to favorites",
  favoriteLeague: "Add league to favorites",
  forceEnglishOff: "Use browser language",
  forceEnglishOn: "Show in English",
  fullTime: "FT",
  fullTimeLabel: "Full Time",
  goalDifference: "GD",
  goalsAgainst: "A",
  goalsFor: "F",
  halfTime: "HT",
  halfTimeLabel: "Half Time",
  headToHead: "Head to head",
  highlights: "Highlights",
  idlePaused: "Paused while inactive.",
  kickoff: "Kickoff",
  lineups: "Lineups",
  qualifying: "Qualifying",
  standingsRelegation: "Relegation",
  standingsRelegationPlayoff: "Relegation play-off",
  standingsElimination: "Elimination zone",
  feedbackHint: "Got an idea, a suggestion, or spotted a bug? I'd love to hear from you!",
  extensionVersion: "Version",
  links: "Links",
  live: "Live",
  liveCount: "$1 live",
  liveMatchesCount: "$1 live matches",
  liveMatchCountOne: "$1 live match",
  loading: "Loading matches…",
  loadingDetails: "Loading match details…",
  loadingBracket: "Loading knockout bracket…",
  loadingStandings: "Loading standings…",
  losses: "L",
  matchCount: "$1 matches",
  matchCountOne: "$1 match",
  upcomingMatchesCount: "$1 upcoming matches",
  upcomingMatchCountOne: "$1 upcoming match",
  completedMatchesCount: "$1 completed matches",
  completedMatchCountOne: "$1 completed match",
  matchDetails: "Match details",
  matches: "Matches",
  news: "News",
  noDetails: "No extra details available for this match.",
  noLinks: "No links available.",
  noLiveMatches: "No live matches",
  noBracket: "No knockout bracket available.",
  noSectionData: "No data available.",
  noStats: "No match stats available.",
  noStandings: "No standings available for this league.",
  notUpdated: "Not updated yet",
  other: "Other",
  paused: "Paused",
  played: "P",
  points: "Pts",
  ready: "Ready",
  refreshFailed: "Refresh failed. Showing the last available data.",
  refreshing: "Refreshing",
  requestLimitReached: "Daily request limit reached. Showing cached data.",
  removeFavorite: "Remove from favorites",
  results: "Results",
  scheduled: "Scheduled",
  selectLeague: "Select a league",
  stats: "Stats",
  standings: "Standings",
  settings: "Settings",
  popupSize: "Popup size",
  sizeSmall: "Small",
  sizeDefault: "Default",
  sizeBig: "Big",
  settingsBackup: "Settings backup",
  settingsBackupHint: "Includes your favorite leagues and popup size. Importing a file replaces these settings.",
  exportSettings: "Export settings",
  importSettings: "Import settings",
  privacyPolicy: "Privacy policy",
  closeSettings: "Close settings",
  settingsImported: "Settings imported.",
  settingsImportError: "This is not a valid Hype settings file.",
  settingsSaveError: "Settings could not be saved on this device.",
  settingsExported: "Settings exported.",
  settingsExportError: "Settings could not be exported.",
  substitutes: "Substitutes",
  startingXI: "Starting XI",
  team: "Team",
  tbd: "TBD",
  timeline: "Timeline",
  turnOff: "Turn extension off",
  turnOn: "Turn extension on",
  unknownLeague: "Unknown League",
  unknownTeam: "Unknown Team",
  upcoming: "Upcoming",
  updated: "Updated",
  venue: "Venue",
  vs: "vs",
  wins: "W",
  roundOf32: "Round of 32",
  roundOf16: "Round of 16",
  quarterfinals: "Quarterfinals",
  semifinals: "Semifinals",
  thirdPlace: "Third-place match",
  final: "Final",
};

function msg(key, substitutions) {
  if (isEnglishOverride) {
    return formatMessage(FALLBACK_MESSAGES[key] || key, substitutions);
  }

  if (typeof chrome !== "undefined" && chrome.i18n && chrome.i18n.getMessage) {
    const result = chrome.i18n.getMessage(key, substitutions);
    return result || formatMessage(FALLBACK_MESSAGES[key] || key, substitutions);
  }
  return formatMessage(FALLBACK_MESSAGES[key] || key, substitutions);
}

// These bundled languages need additional integer count forms (for example,
// Polish 2/5 matches or Slovenian 2/3 matches). Other packs use one/other, or
// invariant count labels. Unknown browser languages retain English grammar.
const MATCH_COUNT_RULE_LANGUAGES = new Set(["cs", "hr", "lt", "lv", "pl", "ro", "ru", "sk", "sl", "sr", "uk"]);
const matchCountPluralRules = new Map();
const MATCH_COUNT_MESSAGES = {
  live: ["liveMatchCountOne", "liveMatchesCount", "liveMatchCount"],
  upcoming: ["upcomingMatchCountOne", "upcomingMatchesCount", "upcomingMatchCount"],
  completed: ["completedMatchCountOne", "completedMatchesCount", "completedMatchCount"],
  matches: ["matchCountOne", "matchCount", "matchCount"],
};

function matchCountMessage(kind, count) {
  const [oneKey, otherKey, prefix] = MATCH_COUNT_MESSAGES[kind] || MATCH_COUNT_MESSAGES.matches;
  const substitutions = [String(count)];
  let category = count === 1 ? "one" : "other";
  const canLocalize = !isEnglishOverride && typeof chrome !== "undefined" && chrome.i18n?.getMessage;
  if (canLocalize) {
    const language = String(getUiLanguage()).toLowerCase().split(/[-_]/)[0];
    if (MATCH_COUNT_RULE_LANGUAGES.has(language)) {
      try {
        if (!matchCountPluralRules.has(language)) matchCountPluralRules.set(language, new Intl.PluralRules(language));
        category = matchCountPluralRules.get(language).select(count);
      } catch {
        // Preserve the usable one/other labels if locale support is missing.
      }
    }
    if (category !== "one" && category !== "other") {
      const suffix = category[0].toUpperCase() + category.slice(1);
      const translated = chrome.i18n.getMessage(prefix + suffix, substitutions);
      if (translated) return translated;
    }
  }
  return msg(category === "one" ? oneKey : otherKey, substitutions);
}

function formatMessage(template, substitutions) {
  if (!substitutions) return template;
  const values = Array.isArray(substitutions) ? substitutions : [substitutions];
  let text = String(template || "");
  values.forEach((value, index) => {
    text = text.replaceAll("$" + (index + 1), String(value));
  });
  // Locale count messages use $COUNT$; keep the English override working.
  if (values[0] != null) {
    text = text.replaceAll("$COUNT$", String(values[0]));
  }
  return text;
}

function getUiLanguage() {
  if (typeof chrome !== "undefined" && chrome.i18n && chrome.i18n.getUILanguage) {
    return chrome.i18n.getUILanguage() || "en";
  }
  return navigator.language || "en";
}

function isRtlLanguage(lang) {
  const base = String(lang || "")
    .toLowerCase()
    .split(/[-_]/)[0];
  return base === "ar" || base === "he" || base === "fa" || base === "iw";
}

function applyDocumentDirection() {
  const lang = isEnglishOverride ? "en" : getUiLanguage();
  const rtl = isRtlLanguage(lang);
  const html = document.documentElement;
  html.lang = String(lang).replace("_", "-");
  html.dir = rtl ? "rtl" : "ltr";
  document.body.classList.toggle("is-rtl", rtl);
}

function formatBackLabel(label) {
  const raw = String(label || msg("backToLeagues"))
    .replace(/^[←→]\s*/, "")
    .trim();
  const arrow = document.documentElement.dir === "rtl" ? "→" : "←";
  return arrow + " " + raw;
}

function formatMatchAriaLabel(homeTeam, awayTeam) {
  return (
    (homeTeam || msg("unknownTeam")) +
    " " +
    msg("vs") +
    " " +
    (awayTeam || msg("unknownTeam"))
  );
}

function applyI18n() {
  applyDocumentDirection();
  document.title = msg("extName");
  appTitle.textContent = msg("appTitle");
  loadingState.textContent = msg("loading");
  errorState.textContent = msg("error");
  emptyState.textContent = msg("empty");
  backBtn.textContent = formatBackLabel();
  updateEnglishToggleLabel();
  applySettingsLabels();
  setStatus(msg("notUpdated"));
}

function getMatchTimeLabel(match) {
  if (match?.state === "scheduled") {
    return formatUpcomingKickoff(match.kickoff);
  }

  return translateMinute(match?.minute);
}

function formatUpcomingKickoff(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(isEnglishOverride ? "en" : undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function translateMinute(minute) {
  const key = getStatusMessageKey(minute);
  if (key) return msg(key);
  return minute || "-";
}

function translateStatus(status) {
  const key = getStatusMessageKey(status);
  return key ? msg(key) : status || "";
}

function getStatusMessageKey(value) {
  if (typeof value !== "string") return null;
  // Providers send both short codes and words. A playing half (1H/2H) is
  // not a half-time break, and unknown status text must not be guessed.
  switch (value.trim().toLowerCase().replace(/[\s_-]+/g, "")) {
    case "ft":
    case "fulltime":
    case "statusfulltime":
      return "fullTime";
    case "ht":
    case "halftime":
    case "statushalftime":
      return "halfTime";
    case "scheduled":
    case "statusscheduled":
      return "scheduled";
    case "live":
      return "live";
    default:
      return null;
  }
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(isEnglishOverride ? "en" : undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

function formatShortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(isEnglishOverride ? "en" : undefined, {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function formatClockTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(isEnglishOverride ? "en" : undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatList(values) {
  return Array.isArray(values) ? values.filter(Boolean).join(", ") : "";
}
