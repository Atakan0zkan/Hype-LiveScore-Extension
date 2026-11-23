function renderLeaguePickList(leagues) {
  captureViewState();
  leaguePickList.replaceChildren();

  for (const league of leagues) {
    const liveCount = countLiveMatches(league.matches);
    const upcomingCount = countUpcomingMatches(league.matches);
    const leagueKey = getLeagueKey(league);

    const card = document.createElement("article");
    card.className = "league-pick-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", league.name);

    const openLeague = () => {
      selectedLeagueKey = leagueKey;
      selectedMatchKey = null;
      selectedMatchSnapshot = null;
      clearTimeout(refreshTimer);
      if (lastPayload) renderPayload(lastPayload);
    };

    card.addEventListener("click", openLeague);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openLeague();
      }
    });

    const logo = createLogoImage("league-pick-logo", getLeagueLogo(league), league.name, {
      tone: league.logoTone,
    });
    const info = document.createElement("div");
    info.className = "league-pick-info";

    const metaText = buildLeagueMetaText(league, liveCount, upcomingCount);
    const previewMatch = getLeaguePreviewMatch(league, league.matches);

    info.appendChild(createTextElement("span", "league-pick-name", league.name));
    if (previewMatch) {
      const preview = createLeagueMatchPreview(previewMatch);
      info.appendChild(preview);
      card.setAttribute("aria-label", `${league.name} · ${preview.title}`);
    } else if (metaText) {
      info.appendChild(createTextElement("span", "league-pick-meta", metaText));
    }

    const actions = document.createElement("div");
    actions.className = "league-card-actions";
    actions.appendChild(
      createFavoriteButton({
        active: isFavoriteLeague(leagueKey),
        label: msg("favoriteLeague"),
        onClick: () => toggleFavoriteLeague(leagueKey),
      }),
    );

    card.append(logo, info, actions);
    leaguePickList.appendChild(card);
  }

  leaguePickList.setAttribute("aria-label", msg("selectLeague"));
  showOnly("pick");
  restoreViewState("pick");
}

function getLeaguePreviewMatch(league, matches = selectLeagueResults(Array.isArray(league?.matches) ? league.matches : [])) {
  let liveMatch = null;
  let finishedMatch = null;

  for (const match of matches) {
    if (!match || typeof match.homeTeam !== "string" || !match.homeTeam.trim() ||
        typeof match.awayTeam !== "string" || !match.awayTeam.trim()) continue;

    // A finished match must never displace an available live match.
    if (match.state === "live") {
      if (!liveMatch || compareLeaguePreviewMatches(match, liveMatch, league.code) < 0) {
        liveMatch = match;
      }
    } else if (match.state === "finished") {
      if (!finishedMatch || compareLeaguePreviewMatches(match, finishedMatch, league.code) < 0) {
        finishedMatch = match;
      }
    }
  }

  return liveMatch || finishedMatch;
}

function compareLeaguePreviewMatches(a, b, leagueCode) {
  const popularityDiff = getMatchPopularityScore(b, leagueCode) - getMatchPopularityScore(a, leagueCode);
  if (popularityDiff) return popularityDiff;
  return compareMatches(a, b) || getMatchKey(a).localeCompare(getMatchKey(b));
}

function getMatchPopularityScore(match, leagueCode = match?.leagueCode) {
  if (!match || !CLUB_POPULARITY_LEAGUES.has(leagueCode)) return 0;
  const teamWeight = (id, name) => {
    const idWeight = (typeof id === "string" || typeof id === "number") ? CLUB_POPULARITY_BY_ID.get(String(id)) : undefined;
    return idWeight ?? CLUB_POPULARITY_BY_NAME.get(normalizePopularityTeamName(name)) ?? 0;
  };
  return teamWeight(match.homeTeamId, match.homeTeam) + teamWeight(match.awayTeamId, match.awayTeam);
}

function createLeagueMatchPreview(match) {
  const halfTime = match.state === "live" && [match.status, match.minute].some((value) =>
    typeof value === "string" && /^(?:HT|half[\s-]*time|STATUS_HALFTIME)$/i.test(value.trim()));
  const kind = match.state === "finished" ? "finished" : halfTime ? "half-time" : "live";
  const statusLabel = kind === "finished" ? msg("fullTimeLabel") : halfTime ? msg("halfTimeLabel") : msg("live");
  const minute = kind === "live" && typeof match.minute === "string" &&
    /^\d{1,3}['′]?(?:\s*\+\s*\d{1,2}['′]?)?$/.test(match.minute.trim()) ? match.minute.trim() : "";
  const resultDate = getFallbackResultDate(match);
  const statusText = minute ? `${minute} · ${statusLabel}` : [statusLabel, resultDate].filter(Boolean).join(" · ");
  const homeScore = formatLeaguePreviewScore(match.homeScore);
  const awayScore = formatLeaguePreviewScore(match.awayScore);
  const summary = `${match.homeTeam} ${homeScore} – ${awayScore} ${match.awayTeam}`;
  const preview = document.createElement("div");
  preview.className = `league-pick-preview league-pick-preview--${kind}`;
  preview.title = `${summary} · ${statusText}`;

  const row = document.createElement("span");
  row.className = "league-preview-match";
  const home = createTextElement("bdi", "league-preview-team", match.homeTeam);
  const score = createTextElement("span", "league-preview-score", `${homeScore} – ${awayScore}`);
  const away = createTextElement("bdi", "league-preview-team", match.awayTeam);
  home.title = match.homeTeam;
  away.title = match.awayTeam;
  score.dir = "ltr";
  row.append(home, score, away);
  preview.append(row, createTextElement("span", "league-preview-status", statusText));
  return preview;
}

function formatLeaguePreviewScore(score) {
  if (typeof score !== "number" && (typeof score !== "string" || !/^\d{1,3}$/.test(score))) return "–";
  const value = Number(score);
  return Number.isInteger(value) && value >= 0 && value <= 999 ? String(value) : "–";
}

function renderLeagueDetail(league) {
  captureViewState();
  leagueDetailContent.replaceChildren();

  const header = document.createElement("div");
  header.className = "league-detail-header";

  const logo = createLogoImage("league-detail-logo", getLeagueLogo(league), league.name, {
    tone: league.logoTone,
  });
  const copy = document.createElement("div");
  copy.className = "league-detail-copy";
  const liveCount = countLiveMatches(league.matches);
  const upcomingCount = countUpcomingMatches(league.matches);

  const metaText = buildLeagueMetaText(league, liveCount, upcomingCount);

  copy.appendChild(createTextElement("h2", "league-detail-title", league.name));
  if (metaText) {
    copy.appendChild(createTextElement("p", "league-detail-meta", metaText));
  }

  header.append(
    logo,
    copy,
    createFavoriteButton({
      active: isFavoriteLeague(getLeagueKey(league)),
      label: msg("favoriteLeague"),
      onClick: () => toggleFavoriteLeague(getLeagueKey(league)),
    }),
  );
  leagueDetailContent.appendChild(header);

  const card = document.createElement("article");
  card.className = "league-card";

  const liveMatches = league.matches.filter((match) => match.state === "live");
  const finishedMatches = league.matches.filter((match) => match.state === "finished");
  const upcomingMatches = league.matches.filter((match) => match.state === "scheduled");
  const otherMatches = league.matches.filter(
    (match) => !["live", "finished", "scheduled"].includes(match.state),
  );

  card.setAttribute("aria-label", (league.name || msg("unknownLeague")) + " · " + msg("matches"));
  appendMatchSection(card, "● " + msg("live"), liveMatches, league);
  appendMatchSection(card, msg("results"), finishedMatches, league);
  appendMatchSection(card, msg("upcoming"), upcomingMatches, league);
  if (otherMatches.length > 0) appendMatchSection(card, msg("other"), otherMatches, league);
  const bracketSection = createTournamentBracketSection(league);
  if (bracketSection) card.appendChild(bracketSection);
  if (league.hasStandings !== false) card.appendChild(createStandingsSection(league));

  if (card.childElementCount) leagueDetailContent.appendChild(card);
  backBtn.textContent = formatBackLabel();
  showOnly("detail");
  restoreViewState(`league:${getLeagueKey(league)}`, leagueStandingsCache.get(league.code)?.status === "loading");
}

function buildLeagueMetaText(league, liveCount, upcomingCount) {
  const metaParts = [];
  const matches = Array.isArray(league?.matches) ? league.matches : [];
  const totalMatches = matches.length;
  const completedCount = matches.filter(match => match?.state === "finished").length;
  const otherCount = Math.max(0, totalMatches - liveCount - upcomingCount - completedCount);

  if (liveCount > 0) metaParts.push(matchCountMessage("live", liveCount));
  if (upcomingCount > 0) metaParts.push(matchCountMessage("upcoming", upcomingCount));
  if (completedCount > 0) metaParts.push(matchCountMessage("completed", completedCount));
  if (otherCount > 0) metaParts.push(matchCountMessage("matches", otherCount));
  if (totalMatches === 0) metaParts.push(msg("noLiveMatches"));

  return metaParts.join(" · ");
}

function appendMatchSection(card, title, matches, league) {
  if (matches.length === 0) return;

  const section = document.createElement("section");
  section.className = "match-section";
  const sectionTitle = createTextElement("h3", "section-title", title);
  const stack = document.createElement("div");
  stack.className = "match-stack";

  for (const match of sortMatchesForDisplay(matches)) {
    stack.appendChild(createMatchCard(match, league));
  }

  section.append(sectionTitle, stack);
  card.appendChild(section);
}

function createMatchCard(match, league) {
  const resultDate = getFallbackResultDate(match);
  const card = document.createElement("article");
  card.className = "match-card match-card--clickable";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute(
    "aria-label",
    [formatMatchAriaLabel(match.homeTeam, match.awayTeam), resultDate].filter(Boolean).join(" · "),
  );
  card.addEventListener("click", () => openMatchDetail(league, match));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMatchDetail(league, match);
    }
  });

  const statusText = match.state === "scheduled" ? "" : translateStatus(match.status);
  card.append(
    createTextElement("span", resultDate ? "time-badge time-badge--result-date" : "time-badge", resultDate || getMatchTimeLabel(match)),
    createTeamsBlock(match),
    createTextElement(
      "span",
      statusText ? "status-pill" : "status-pill status-pill--empty",
      statusText,
    ),
  );

  return card;
}

function createTeamsBlock(match) {
  const teams = document.createElement("div");
  teams.className = "match-teams";
  teams.append(
    createTeamRow({
      name: match.homeTeam,
      score: match.homeScore,
      logo: match.homeLogo,
    }),
    createTeamRow({
      name: match.awayTeam,
      score: match.awayScore,
      logo: match.awayLogo,
    }),
  );
  return teams;
}

function createTeamRow(team) {
  const row = document.createElement("div");
  row.className = "team-row";

  row.append(
    createLogoImage("team-logo", team.logo, team.name),
    createTextElement("span", "team-name", team.name || msg("unknownTeam")),
    createTextElement("span", "team-score", String(Number(team.score) || 0)),
  );
  return row;
}

function createFavoriteButton({ active, label, onClick }) {
  const button = document.createElement("button");
  button.className = "favorite-btn";
  if (active) button.classList.add("favorite-btn--active");
  button.type = "button";
  button.title = active ? msg("removeFavorite") : label || msg("favorite");
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", String(active));
  button.textContent = active ? "★" : "☆";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function normalizeLeagueGroups(payload) {
  const leagues = Array.isArray(payload.leagues) && payload.leagues.length > 0
    ? payload.leagues.filter((league) => league && typeof league.name === "string" && Array.isArray(league.matches))
    : buildLeagueGroupsFromMatches(payload.matches || []);
  const now = Date.now();

  return leagues
    .map((league) => ({
      ...league,
      name: league.code === FIFA_WORLD_CUP_LEAGUE_CODE ? "FIFA World Cup 2030" : league.name,
      // The picker needs counts and a preview, not sorted match rows.
      // Only the selected league sorts its visible sections.
      matches: selectLeagueResults(league.code === FIFA_WORLD_CUP_LEAGUE_CODE
        ? league.matches.filter(isWorldCup2030Match) : league.matches, now),
    }))
    .filter((league) => league.matches.length > 0 || league.code || league.id)
    .sort(compareLeagues);
}

function selectLeagueResults(matches, now = Date.now()) {
  const selected = [];
  let hasRecentResult = false;
  let fallback = null;
  let fallbackKickoff = -Infinity;
  for (const match of matches) {
    if (!isVisibleMatch(match, now)) continue;
    if (match.state !== "finished") {
      selected.push(match);
      continue;
    }
    const kickoff = Date.parse(match.kickoff || "");
    if (kickoff >= now - RECENT_RESULT_WINDOW_MS) {
      hasRecentResult = true;
      selected.push(match);
    } else if (kickoff > fallbackKickoff || (kickoff === fallbackKickoff && String(match.id) < String(fallback?.id))) {
      fallback = match;
      fallbackKickoff = kickoff;
    }
  }
  if (!hasRecentResult && fallback) selected.push(fallback);
  return selected;
}

function getFallbackResultDate(match) {
  if (match.state !== "finished") return "";
  const age = Date.now() - Date.parse(match.kickoff || "");
  return age > RECENT_RESULT_WINDOW_MS && age <= LAST_RESULT_WINDOW_MS ? formatShortDate(match.kickoff) : "";
}

function buildLeagueGroupsFromMatches(matches) {
  const groups = new Map();

  for (const match of matches) {
    if (!isVisibleMatch(match)) continue;

    const key = match.leagueId || match.leagueCode || match.league || "unknown";
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        code: match.leagueCode || null,
        name: match.league || msg("unknownLeague"),
        logo: null,
        logoTone: match.leagueLogoTone || "dark",
        matches: [],
      });
    }
    groups.get(key).matches.push(match);
  }

  return [...groups.values()];
}

function getLeagueLogo(league) {
  return LOCAL_LEAGUE_LOGOS[league?.code] || league?.logo || FALLBACK_LOGO;
}

function compareLeagues(a, b) {
  const favoriteDiff = Number(isFavoriteLeague(getLeagueKey(b))) - Number(isFavoriteLeague(getLeagueKey(a)));
  if (favoriteDiff !== 0) return favoriteDiff;

  const activityDiff = getLeagueActivityRank(a) - getLeagueActivityRank(b);
  if (activityDiff !== 0) return activityDiff;

  const liveDiff = countLiveMatches(b.matches) - countLiveMatches(a.matches);
  return liveDiff !== 0 ? liveDiff : a.name.localeCompare(b.name);
}

function getLeagueActivityRank(league) {
  const matches = Array.isArray(league.matches) ? league.matches : [];
  if (matches.some((match) => match.state === "live")) return 0;
  if (matches.some(isUpcomingWithinWindow)) return 1;
  return matches.length ? 2 : 3;
}

function sortMatchesForDisplay(matches) {
  return [...matches].sort(compareMatches);
}

function compareMatches(a, b) {
  const stateDiff = getMatchStateRank(a.state) - getMatchStateRank(b.state);
  if (stateDiff !== 0) return stateDiff;

  if (a.state === "finished") {
    const aTime = typeof a.kickoff === "string" ? Date.parse(a.kickoff) : NaN;
    const bTime = typeof b.kickoff === "string" ? Date.parse(b.kickoff) : NaN;
    const latestDiff = (Number.isFinite(bTime) ? bTime : -Infinity) - (Number.isFinite(aTime) ? aTime : -Infinity);
    if (latestDiff) return latestDiff;
  }

  return (a.homeTeam || "").localeCompare(b.homeTeam || "");
}

function countLiveMatches(matches) {
  return matches.filter((match) => match.state === "live").length;
}

function hasLiveMatches(payload) {
  return Boolean(
    payload &&
      Array.isArray(payload.matches) &&
      payload.matches.some((match) => match?.state === "live"),
  );
}

function hasUpcomingMatches(payload) {
  return Boolean(
    payload &&
      Array.isArray(payload.matches) &&
      payload.matches.some((match) => isUpcomingWithinWindow(match)),
  );
}

function countUpcomingMatches(matches) {
  return matches.filter(isUpcomingWithinWindow).length;
}

function isWorldCup2030Match(match) {
  if (!match || typeof match !== "object") return false;
  if (match.seasonYear != null && Number(match.seasonYear) !== FIFA_WORLD_CUP_YEAR) return false;
  if (!match.kickoff) return Number(match.seasonYear) === FIFA_WORLD_CUP_YEAR;
  const kickoff = new Date(match.kickoff);
  return Number.isFinite(kickoff.getTime()) && kickoff.getUTCFullYear() === FIFA_WORLD_CUP_YEAR;
}

function isVisibleMatch(match, now = Date.now()) {
  if (!match) return false;
  if (match.leagueCode === FIFA_WORLD_CUP_LEAGUE_CODE && !isWorldCup2030Match(match)) return false;
  if (match.state === "finished") {
    const kickoff = Date.parse(match.kickoff || "");
    return kickoff >= now - LAST_RESULT_WINDOW_MS && kickoff <= now;
  }
  if (match.state !== "scheduled") return true;
  return isUpcomingWithinWindow(match);
}

function isUpcomingWithinWindow(match) {
  if (!match || match.state !== "scheduled") return false;
  const kickoffTime = Date.parse(match.kickoff || "");
  if (!Number.isFinite(kickoffTime)) return false;
  const now = Date.now();
  return (
    kickoffTime >= now - 60 * 60 * 1000 &&
    kickoffTime <= now + UPCOMING_MATCH_WINDOW_MS
  );
}

function getMatchStateRank(state) {
  if (state === "live") return 0;
  if (state === "finished") return 1;
  if (state === "scheduled") return 2;
  return 3;
}

function isFavoriteLeague(leagueKey) {
  return favoriteLeagues.has(leagueKey);
}

function getLeagueKey(league) {
  return String(league.id || league.code || league.name || "unknown");
}

function getMatchKey(match) {
  return String(match.id || `${match.leagueCode}:${match.homeTeam}:${match.awayTeam}`);
}

function getDetailCacheKey(match) {
  return `${match.leagueCode || "unknown"}:${getMatchKey(match)}`;
}
