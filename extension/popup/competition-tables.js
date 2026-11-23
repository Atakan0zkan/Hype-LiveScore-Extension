function createTournamentBracketSection(league) {
  if (league.code !== FIFA_WORLD_CUP_LEAGUE_CODE) {
    return null;
  }

  const leagueCode = league.code;
  if (!tournamentBracketCache.has(leagueCode)) openTournamentBracketLeagueCodes.add(leagueCode);
  const section = document.createElement("details");
  section.className = "tournament-bracket detail-section detail-section--accordion";
  section.dataset.sectionKey = "bracket";
  section.open = openTournamentBracketLeagueCodes.has(leagueCode);

  const summary = document.createElement("summary");
  summary.className = "detail-section-summary";
  summary.appendChild(
    createTextElement("span", "detail-section-title", `${msg("matches")} · ${FIFA_WORLD_CUP_YEAR}`),
  );

  section.appendChild(summary);
  const body = document.createElement("div");
  body.className = "tournament-bracket-body";
  body.dataset.leagueCode = leagueCode;
  section.appendChild(body);

  section.addEventListener("toggle", () => {
    if (section.open) {
      openTournamentBracketLeagueCodes.add(leagueCode);
      renderTournamentBracketBody(body, league);
    } else {
      openTournamentBracketLeagueCodes.delete(leagueCode);
    }
  });

  if (section.open) {
    renderTournamentBracketBody(body, league);
  }

  return section;
}

function renderTournamentBracketBody(container, league) {
  container.replaceChildren();
  const leagueCode = league.code;
  let cached = tournamentBracketCache.get(leagueCode);

  if (isExpiredLazyError(cached)) {
    tournamentBracketCache.delete(leagueCode);
    cached = null;
  }

  if (!cached) {
    tournamentBracketCache.set(leagueCode, { status: "loading" });
    container.appendChild(
      createTextElement("p", "bracket-message", msg("loadingBracket")),
    );
    loadTournamentBracket(leagueCode);
    return;
  }

  if (cached.status === "loading") {
    container.appendChild(
      createTextElement("p", "bracket-message", msg("loadingBracket")),
    );
    return;
  }

  if (cached.status === "error") {
    container.appendChild(
      createTextElement("p", "bracket-message bracket-message--error", msg("bracketUnavailable")),
    );
    return;
  }

  const rounds = Array.isArray(cached.rounds) ? cached.rounds : [];

  if (rounds.length === 0) {
    container.appendChild(createTextElement("p", "bracket-message", msg("noSectionData")));
    return;
  }

  const roundsWrap = document.createElement("div");
  roundsWrap.className = "bracket-rounds";

  for (const round of rounds) {
    roundsWrap.appendChild(createBracketRound(round, league));
  }

  container.appendChild(roundsWrap);
}

function createBracketRound(round, league) {
  const wrapper = document.createElement("section");
  wrapper.className = "bracket-round";
  wrapper.appendChild(
    createTextElement(
      "h4",
      "bracket-round-title",
      getTournamentRoundLabel(round.slug, round.name),
    ),
  );

  const list = document.createElement("div");
  list.className = "bracket-match-list";

  for (const match of Array.isArray(round.matches) ? round.matches : []) {
    list.appendChild(createBracketMatchCard(match, league));
  }

  wrapper.appendChild(list);
  return wrapper;
}

function createBracketMatchCard(match, league) {
  const card = document.createElement("article");
  card.className = "bracket-match-card";

  if (match.id && match.leagueCode) {
    card.classList.add("bracket-match-card--clickable");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute(
    "aria-label",
    formatMatchAriaLabel(match.homeTeam, match.awayTeam),
  );
    const openDetail = () => openMatchDetail(league, normalizeBracketMatchForDetail(match));
    card.addEventListener("click", openDetail);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail();
      }
    });
  }

  const meta = document.createElement("div");
  meta.className = "bracket-match-meta";
  meta.append(
    createTextElement("span", "bracket-match-date", formatDateTime(match.kickoff)),
    createTextElement("span", "bracket-match-status", translateStatus(match.status)),
  );

  const teams = document.createElement("div");
  teams.className = "bracket-teams";
  teams.append(
    createBracketTeamRow(match.homeTeam, match.homeLogo, getBracketScore(match, "home")),
    createBracketTeamRow(match.awayTeam, match.awayLogo, getBracketScore(match, "away")),
  );

  card.append(meta, teams);
  return card;
}

function createBracketTeamRow(name, logo, score) {
  const row = document.createElement("div");
  row.className = "bracket-team-row";
  row.append(
    createLogoImage("bracket-team-logo", logo, name),
    createTextElement("span", "bracket-team-name", name || msg("tbd")),
    createTextElement("strong", "bracket-team-score", score),
  );
  return row;
}

function normalizeBracketMatchForDetail(match) {
  return {
    ...match,
    minute: match.minute || "-",
    status: match.status || "",
    state: match.state || "scheduled",
    venue: match.venue || "",
  };
}

function getBracketScore(match, side) {
  if (match.state === "scheduled") {
    return "-";
  }

  return String(Number(side === "home" ? match.homeScore : match.awayScore) || 0);
}

function getTournamentRoundLabel(slug, fallbackName) {
  const labels = {
    "round-of-32": msg("roundOf32"),
    "round-of-16": msg("roundOf16"),
    quarterfinals: msg("quarterfinals"),
    semifinals: msg("semifinals"),
    "3rd-place-match": msg("thirdPlace"),
    final: msg("final"),
  };

  return labels[slug] || fallbackName || msg("bracket");
}

async function loadTournamentBracket(leagueCode) {
  const loadingEntry = tournamentBracketCache.get(leagueCode);
  try {
    const data = await fetchJsonWithTimeout(buildTournamentBracketUrl(leagueCode));
    tournamentBracketCache.set(leagueCode, {
      status: "loaded",
      rounds: data.seasonYear === FIFA_WORLD_CUP_YEAR && Array.isArray(data.rounds)
        ? data.rounds.filter((round) => round && Array.isArray(round.matches))
          .map((round) => ({ ...round, matches: round.matches.filter(isWorldCup2030Match) }))
          .filter((round) => round.matches.length > 0)
        : [],
    });
  } catch (error) {
    if (error.name === "AbortError") {
      if (tournamentBracketCache.get(leagueCode) === loadingEntry) tournamentBracketCache.delete(leagueCode);
      return;
    }
    if (isDailyRequestLimitError(error)) {
      dailyLimitReached = true;
      setStatus(msg("requestLimitReached"));
    }
    console.error(error);
    tournamentBracketCache.set(leagueCode, { status: "error", failedAt: Date.now() });
  } finally {
    if (isEnabled) updateVisibleTournamentBracket(leagueCode);
  }
}

function updateVisibleTournamentBracket(leagueCode) {
  if (!lastPayload || !selectedLeagueKey || selectedMatchKey || !leagueDetailContent) return;

  const body = leagueDetailContent.querySelector(".tournament-bracket-body");
  if (!body || body.dataset.leagueCode !== leagueCode) {
    renderPayload(lastPayload);
    return;
  }

  const league = normalizeLeagueGroups(lastPayload).find(
    (item) => getLeagueKey(item) === selectedLeagueKey,
  );

  if (league) {
    renderTournamentBracketBody(body, league);
  } else {
    renderPayload(lastPayload);
  }
}

function createStandingsSection(league) {
  const wrapper = document.createElement("section");
  wrapper.className = "standings";
  wrapper.appendChild(createTextElement("h3", "standings-title", msg("standings")));

  if (!league.code) {
    wrapper.appendChild(createTextElement("p", "standings-message", msg("noStandings")));
    return wrapper;
  }

  const cached = leagueStandingsCache.get(league.code);

  if (isExpiredLazyError(cached)) {
    leagueStandingsCache.delete(league.code);
  }

  const activeCached = leagueStandingsCache.get(league.code);

  if (!activeCached) {
    leagueStandingsCache.set(league.code, { status: "loading" });
    wrapper.appendChild(createTextElement("p", "standings-message", msg("loadingStandings")));
    loadLeagueStandings(league.code);
    return wrapper;
  }

  if (activeCached.status === "loading") {
    wrapper.appendChild(createTextElement("p", "standings-message", msg("loadingStandings")));
    return wrapper;
  }

  if (activeCached.status === "error") {
    wrapper.appendChild(
      createTextElement("p", "standings-message standings-message--error", msg("detailsUnavailable")),
    );
    return wrapper;
  }

  const standings = Array.isArray(activeCached.standings) ? activeCached.standings : [];

  if (standings.length === 0) {
    wrapper.appendChild(createTextElement("p", "standings-message", msg("noStandings")));
    return wrapper;
  }

  const table = document.createElement("table");
  table.className = "standings-table";
  table.append(createStandingsHead(), createStandingsBody(standings));

  const tableWrap = document.createElement("div");
  tableWrap.className = "standings-table-wrap";
  tableWrap.appendChild(table);
  wrapper.appendChild(tableWrap);
  const legend = createStandingsLegend(standings);
  if (legend) wrapper.appendChild(legend);

  return wrapper;
}

async function loadLeagueStandings(leagueCode) {
  const loadingEntry = leagueStandingsCache.get(leagueCode);
  try {
    const data = await fetchJsonWithTimeout(buildLeagueStandingsUrl(leagueCode));
    leagueStandingsCache.set(leagueCode, {
      status: "loaded",
      standings: Array.isArray(data.standings) &&
        (leagueCode !== FIFA_WORLD_CUP_LEAGUE_CODE || data.seasonYear === FIFA_WORLD_CUP_YEAR)
        ? data.standings : [],
    });
  } catch (error) {
    if (error.name === "AbortError") {
      if (leagueStandingsCache.get(leagueCode) === loadingEntry) leagueStandingsCache.delete(leagueCode);
      return;
    }
    if (isDailyRequestLimitError(error)) {
      dailyLimitReached = true;
      setStatus(msg("requestLimitReached"));
    }
    console.error(error);
    leagueStandingsCache.set(leagueCode, { status: "error", failedAt: Date.now() });
  } finally {
    if (isEnabled && lastPayload && selectedLeagueKey && !selectedMatchKey) {
      renderPayload(lastPayload);
    }
  }
}

function createStandingsHead() {
  const head = document.createElement("thead");
  const row = document.createElement("tr");

  for (const label of [
    "#",
    msg("club"),
    msg("played"),
    msg("wins"),
    msg("draws"),
    msg("losses"),
    msg("goalsFor"),
    msg("goalsAgainst"),
    msg("goalDifference"),
    msg("points"),
  ]) {
    row.appendChild(createTextElement("th", "", label));
  }

  head.appendChild(row);
  return head;
}

function createStandingsBody(standings) {
  const body = document.createElement("tbody");
  const groups = new Set(standings.map((team) => team.group).filter(Boolean));
  const shouldShowGroups = groups.size > 1;
  let currentGroup = "";

  for (const team of standings) {
    if (shouldShowGroups && team.group && team.group !== currentGroup) {
      currentGroup = team.group;
      const groupRow = document.createElement("tr");
      const groupCell = createTextElement("td", "standings-group-cell", currentGroup);
      groupCell.colSpan = 10;
      groupRow.className = "standings-group-row";
      groupRow.appendChild(groupCell);
      body.appendChild(groupRow);
    }

    const row = document.createElement("tr");
    const position = createTextElement("td", "standings-position", String(team.position));
    const zone = getStandingZonePresentation(team.zone);
    if (zone) {
      position.classList.add(`standings-position--${zone.kind}`);
      if (zone.phase !== "direct") position.classList.add("standings-position--conditional");
      position.title = zone.label;
      position.setAttribute("aria-label", `${team.position} · ${zone.label}`);
    }
    row.append(
      position,
      createStandingTeamCell(team),
      createTextElement("td", "", String(team.played)),
      createTextElement("td", "", String(team.wins)),
      createTextElement("td", "", String(team.draws)),
      createTextElement("td", "", String(team.losses)),
      createTextElement("td", "", String(team.goalsFor)),
      createTextElement("td", "", String(team.goalsAgainst)),
      createTextElement("td", "", team.goalDifference),
      createTextElement("td", "", String(team.points)),
    );
    body.appendChild(row);
  }

  return body;
}

function getStandingZonePresentation(zone) {
  if (!zone || typeof zone !== "object" || Array.isArray(zone)) return null;
  if (typeof zone.kind !== "string" || typeof zone.phase !== "string") return null;
  const competitions = {
    "champions-league": "UEFA Champions League",
    "europa-league": "UEFA Europa League",
    "conference-league": "UEFA Conference League",
  };
  if (zone.kind === "elimination" && zone.phase === "direct") {
    return { kind: zone.kind, phase: zone.phase, label: msg("standingsElimination") };
  }
  if (zone.kind === "relegation" && ["direct", "playoff"].includes(zone.phase)) {
    return { kind: zone.kind, phase: zone.phase,
      label: msg(zone.phase === "playoff" ? "standingsRelegationPlayoff" : "standingsRelegation") };
  }
  if (!Object.hasOwn(competitions, zone.kind) || !["direct", "qualifying"].includes(zone.phase)) return null;
  const label = competitions[zone.kind] + (zone.phase === "qualifying" ? ` · ${msg("qualifying")}` : "");
  return { kind: zone.kind, phase: zone.phase, label };
}

function createStandingsLegend(standings) {
  const zones = new Map();
  for (const team of standings) {
    const zone = getStandingZonePresentation(team.zone);
    if (zone) zones.set(`${zone.kind}:${zone.phase}`, zone);
  }
  if (zones.size === 0) return null;
  const legend = document.createElement("ul");
  legend.className = "standings-legend";
  for (const zone of zones.values()) {
    const item = document.createElement("li");
    item.className = `standings-legend-item standings-position--${zone.kind}`;
    const marker = document.createElement("span");
    marker.className = "standings-legend-marker";
    if (zone.phase !== "direct") marker.classList.add("standings-legend-marker--conditional");
    marker.setAttribute("aria-hidden", "true");
    item.append(marker, createTextElement("span", "", zone.label));
    legend.appendChild(item);
  }
  return legend;
}

function createStandingTeamCell(team) {
  const cell = document.createElement("td");
  const content = document.createElement("span");
  content.className = "standings-team";
  content.append(
    createLogoImage("standings-team-logo", team.logo, team.team),
    createTextElement("span", "standings-team-name", team.team),
  );
  cell.appendChild(content);
  return cell;
}
