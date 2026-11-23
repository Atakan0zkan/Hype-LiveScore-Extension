function openMatchDetail(league, match) {
  if (!isEnabled) return;
  selectedLeagueKey = getLeagueKey(league);
  selectedMatchKey = getMatchKey(match);
  selectedMatchSnapshot = { ...match };
  clearTimeout(refreshTimer);
  renderMatchDetail(league, selectedMatchSnapshot);
}

function renderMatchDetail(league, match) {
  captureViewState();
  leagueDetailContent.replaceChildren();
  backBtn.textContent = formatBackLabel(league.name);

  const meta = document.createElement("section");
  meta.className = "detail-meta-grid";
  appendMetaItem(meta, msg("kickoff"), formatDateTime(match.kickoff));
  appendMetaItem(meta, msg("venue"), match.venue || "-");
  appendMetaItem(meta, msg("matchDetails"), translateStatus(match.status));
  leagueDetailContent.appendChild(meta);

  const header = document.createElement("article");
  header.className = "match-detail-hero";
  header.append(
    createDetailTeam(match.homeLogo, match.homeTeam),
    createScoreBlock(match),
    createDetailTeam(match.awayLogo, match.awayTeam),
  );
  leagueDetailContent.appendChild(header);

  const key = getDetailCacheKey(match);
  let cacheEntry = matchDetailCache.get(key);
  if (isExpiredLazyError(cacheEntry)) {
    matchDetailCache.delete(key);
    cacheEntry = null;
  }

  if (match.leagueCode && (!cacheEntry || shouldRefreshMatchDetail(cacheEntry, match))) {
    loadMatchDetail(match, cacheEntry);
    cacheEntry = matchDetailCache.get(key);
  }
  const displayEntry = cacheEntry?.previous || cacheEntry;
  if (!match.leagueCode) {
    leagueDetailContent.appendChild(createStatePanel(msg("detailsUnavailable")));
  } else if (displayEntry?.status === "loaded") {
    renderLoadedMatchDetail(displayEntry.data);
  } else if (displayEntry?.status === "error") {
    leagueDetailContent.appendChild(createStatePanel(msg("detailsUnavailable"), true));
  } else {
    leagueDetailContent.appendChild(createStatePanel(msg("loadingDetails")));
  }

  showOnly("detail");
  restoreViewState(`match:${key}`, cacheEntry?.status === "loading" && !cacheEntry.previous);
}

const MATCH_DETAIL_REFRESH_MS = 60000;
const EMPTY_FINISHED_DETAIL_REFRESH_MS = 5 * MATCH_DETAIL_REFRESH_MS;

function shouldRefreshMatchDetail(entry, match, now = Date.now()) {
  if (entry.status !== "loaded" || !Number.isFinite(entry.loadedAt) || entry.retryAt > now) return false;
  if (entry.matchState !== match.state) return true;
  if (match.state === "finished" && entry.data?.state === "finished") {
    return !entry.data.lineups?.length && now - entry.loadedAt >= EMPTY_FINISHED_DETAIL_REFRESH_MS;
  }
  return now - entry.loadedAt >= MATCH_DETAIL_REFRESH_MS;
}

function createDetailTeam(logoUrl, name) {
  const team = document.createElement("div");
  team.className = "detail-team";
  const label = createTextElement("strong", "detail-team-name", name || msg("team"));
  label.title = name || msg("team");
  team.append(
    createLogoImage("detail-team-logo", logoUrl, name),
    label,
  );
  return team;
}

function createScoreBlock(match) {
  const block = document.createElement("div");
  block.className = "detail-score-block";
  block.append(
    createTextElement("span", "detail-minute", getMatchTimeLabel(match)),
    createTextElement("span", "detail-score", `${Number(match.homeScore) || 0} - ${Number(match.awayScore) || 0}`),
  );
  return block;
}

function restoreAbortedMatchDetail(key, entry) {
  if (entry?.status !== "loading" || matchDetailCache.get(key) !== entry) return;
  if (entry.previous) matchDetailCache.set(key, entry.previous);
  else matchDetailCache.delete(key);
}

async function loadMatchDetail(match, previous = null) {
  abortDetailRequest();
  const controller = new AbortController();
  detailAbortController = controller;
  const key = getDetailCacheKey(match);
  detailAbortKey = key;
  const loadingEntry = { status: "loading", previous };
  matchDetailCache.set(key, loadingEntry);
  let shouldRender = true;

  try {
    const data = await fetchMatchDetailWithRecovery(match, controller.signal, Boolean(previous));
    if (controller.signal.aborted) throw createAbortError();
    if (!isDetailRecord(data)) throw new Error("Invalid match detail payload");
    matchDetailCache.set(key, { status: "loaded", data, loadedAt: Date.now(), matchState: match.state });
  } catch (error) {
    if (error.name === "AbortError") {
      restoreAbortedMatchDetail(key, loadingEntry);
      shouldRender = false;
    } else {
      if (isDailyRequestLimitError(error)) {
        dailyLimitReached = true;
        setStatus(msg("requestLimitReached"));
      }
      console.error(error);
      const failedAt = Date.now();
      matchDetailCache.set(key, previous
        ? { ...previous, retryAt: failedAt + LAZY_ERROR_RETRY_MS }
        : { status: "error", failedAt });
    }
  } finally {
    if (detailAbortController === controller) {
      detailAbortController = null;
      detailAbortKey = null;
    }
    if (shouldRender && lastPayload && selectedMatchKey === getMatchKey(match)) {
      renderPayload(lastPayload);
    }
  }
}

async function fetchMatchDetailWithRecovery(match, signal, revalidate = false) {
  const options = revalidate ? { signal, cache: "no-store" } : { signal };
  const fetchDetail = () => fetchJsonWithTimeout(buildMatchDetailUrl(match), options);
  try {
    return await fetchDetail();
  } catch (error) {
    if (error.status !== 404 || signal.aborted) throw error;
    // A cold edge location may not know a card restored from local storage.
    // Re-prime the public scoreboard once, then retry only if it lists this ID.
    const payload = await fetchJsonWithTimeout(BACKEND_URL, { signal, cache: "reload" });
    if (!isValidLivePayload(payload) || !payload.matches.some((row) =>
      String(row.id) === String(match.id) && row.leagueCode === match.leagueCode)) throw error;
    return fetchDetail();
  }
}

function isDetailRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getDetailRows(rows) {
  return Array.isArray(rows) ? rows.filter(isDetailRecord) : [];
}

function renderLoadedMatchDetail(detail) {
  const beforeCount = leagueDetailContent.childElementCount;

  appendLineupsSection(detail.lineups);

  if (Array.isArray(detail.broadcasts) && detail.broadcasts.length > 0) {
    const meta = document.createElement("section");
    meta.className = "detail-meta-grid detail-meta-grid--secondary detail-meta-grid--single";
    appendMetaItem(meta, msg("broadcasts"), formatList(detail.broadcasts));
    leagueDetailContent.appendChild(meta);
  }

  appendStatsSection(detail.stats, detail.teams);
  appendDetailListSection(msg("timeline"), detail.timeline, createTimelineItem, msg("noSectionData"), true, "timeline");
  appendDetailListSection(msg("headToHead"), detail.headToHead, createHeadToHeadItem, "", false, "headToHead");
  appendNewsHighlightsSection(detail.news, detail.videos);
  appendLinkSection(msg("links"), detail.links, msg("noLinks"), true);

  if (leagueDetailContent.childElementCount === beforeCount) {
    leagueDetailContent.appendChild(createStatePanel(msg("noDetails")));
  }
}

function appendDetailListSection(title, rows, renderer, emptyText = "", alwaysRender = false, key = title) {
  const items = getDetailRows(rows);
  if (!alwaysRender && items.length === 0) return;
  const section = createDetailSection(title, key);
  const list = document.createElement("div");
  list.className = "detail-list";

  for (const row of items) {
    list.appendChild(renderer(row));
  }

  section.appendChild(
    list.childElementCount > 0
      ? list
      : createTextElement("p", "detail-empty", emptyText || msg("noSectionData")),
  );
  leagueDetailContent.appendChild(section);
}

function appendLineupsSection(lineups) {
  const rows = getDetailRows(lineups).slice(0, 2);
  rows.sort((a, b) => Number(b.homeAway === "home") - Number(a.homeAway === "home"));
  const section = document.createElement("section");
  section.className = "detail-section lineup-section";
  section.setAttribute("aria-label", msg("lineups"));
  const layouts = rows.map(getPitchLayout);
  const hasPitch = rows.length === 2 && layouts.every(Boolean);
  if (hasPitch) {
    const legend = document.createElement("div");
    legend.className = "pitch-teams";
    rows.forEach((lineup) => legend.appendChild(createTextElement("span", "", [lineup.team, lineup.formation].filter(Boolean).join(" · "))));
    section.appendChild(legend);
    const pitch = document.createElement("div");
    pitch.className = "lineup-pitch";
    rows.forEach((lineup, index) => {
      const half = document.createElement("section");
      half.className = `pitch-half pitch-half--${index === 0 ? "home" : "away"}`;
      half.setAttribute("aria-label", lineup.team);
      const lines = index === 0 ? layouts[index] : [...layouts[index]].reverse();
      for (const line of lines) {
        const lane = document.createElement("div");
        lane.className = "pitch-line";
        for (const player of index === 0 ? line : [...line].reverse()) {
          const marker = document.createElement("div");
          marker.className = "pitch-player";
          marker.title = [player.name, player.position].filter(Boolean).join(" · ");
          marker.setAttribute("aria-label", marker.title);
          const shirt = createTextElement("span", "pitch-shirt", player.jersey || "•");
          appendPlayerMatchBadges(shirt, player);
          marker.append(
            shirt,
            createTextElement("span", "pitch-name", getPitchPlayerName(player)),
          );
          lane.appendChild(marker);
        }
        half.appendChild(lane);
      }
      pitch.appendChild(half);
    });
    section.appendChild(pitch);
  }
  // Never repeat the starting XI below a rendered pitch. If formation data
  // is incomplete, retain a starter-only fallback rather than inventing it.
  const createRosterGrid = (starter) => {
    const grid = document.createElement("div");
    grid.className = starter ? "lineup-grid lineup-starters" : "lineup-grid lineup-substitutes";
    for (const lineup of rows) {
      const column = document.createElement("div");
      column.className = "lineup-team";
      const title = document.createElement("div");
      title.className = "lineup-title";
      title.append(
        createLogoImage("lineup-logo", lineup.logo, lineup.team),
        createTextElement("strong", "", lineup.team),
      );
      const players = document.createElement("div");
      players.className = "lineup-players";
      for (const player of (Array.isArray(lineup.players) ? lineup.players : []).filter((player) => player && player.starter === starter).slice(0, 50)) {
        // ESPN sometimes sends SUB instead of a position, even for confirmed starters.
        const position = typeof player.position === "string" ? player.position.trim() : "";
        players.appendChild(
          createTextElement(
            "span",
            starter ? "lineup-player lineup-player--starter" : "lineup-player",
            [player.jersey, player.name, position.toUpperCase() === "SUB" ? "" : position].filter(Boolean).join(" · "),
          ),
        );
      }
      if (!players.childElementCount) players.appendChild(createTextElement("p", "detail-empty", msg("noSectionData")));
      column.append(title, players);
      grid.appendChild(column);
    }
    return grid;
  };
  if (!hasPitch && rows.some((lineup) => Array.isArray(lineup.players) && lineup.players.some((player) => player?.starter === true))) {
    section.appendChild(createTextElement("h3", "lineup-subheading", msg("startingXI")));
    section.appendChild(createRosterGrid(true));
  }
  if (rows.length) {
    section.appendChild(createTextElement("h3", "lineup-subheading", msg("substitutes")));
    section.appendChild(createRosterGrid(false));
  } else section.appendChild(createTextElement("p", "detail-empty", msg("noSectionData")));
  leagueDetailContent.appendChild(section);
}

function appendPlayerMatchBadges(shirt, player) {
  const count = (value, max) => Number.isInteger(value) && value > 0 && value <= max ? value : 0;
  const goals = count(player.goals, 20);
  if (goals) {
    const stack = createTextElement("span", "pitch-goals", "");
    stack.setAttribute("role", "img");
    stack.setAttribute("aria-label", `⚽ × ${goals}`);
    stack.title = `⚽ × ${goals}`;
    for (let i = 0; i < goals; i += 1) {
      const ball = createTextElement("span", "pitch-goal", "⚽︎");
      ball.setAttribute("aria-hidden", "true");
      ball.style.bottom = `${i * Math.min(6, 12 / Math.max(1, goals - 1))}px`;
      stack.appendChild(ball);
    }
    shirt.appendChild(stack);
  }
  const yellow = count(player.yellowCards, 2);
  const red = count(player.redCards, 1);
  if (yellow || red) {
    const cards = createTextElement("span", "pitch-cards", "");
    cards.setAttribute("role", "img");
    cards.setAttribute("aria-label", [yellow ? `🟨 × ${yellow}` : "", red ? "🟥 × 1" : ""].filter(Boolean).join(" · "));
    cards.title = cards.getAttribute("aria-label");
    for (const kind of [...Array(yellow).fill("yellow"), ...Array(red).fill("red")]) {
      const card = createTextElement("span", `pitch-card pitch-card--${kind}`, "");
      card.setAttribute("aria-hidden", "true");
      cards.appendChild(card);
    }
    shirt.appendChild(cards);
  }
}

function getPitchPlayerName(player) {
  if (player.shortName) return player.shortName;
  const parts = String(player.name || "").trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : parts[0];
}

// Verified ESPN formationPlace values, ordered goal-to-attack and left-to-right
// within each line. These are provider slot IDs, not shirt numbers or row indexes.
const ESPN_FORMATION_PLACES = new Map(Object.entries({
  "3-4-1-2": [[1], [4, 5, 6], [3, 8, 7, 2], [9], [11, 10]],
  "3-4-2-1": [[1], [4, 5, 6], [3, 8, 7, 2], [11, 10], [9]],
  "3-4-3": [[1], [4, 5, 6], [3, 8, 7, 2], [11, 9, 10]],
  "3-5-2": [[1], [4, 5, 6], [3, 8, 11, 7, 2], [9, 10]],
  "4-1-4-1": [[1], [3, 6, 5, 2], [4], [11, 10, 8, 7], [9]],
  "4-2-2-2": [[1], [3, 6, 5, 2], [8, 4], [11, 7], [9, 10]],
  "4-2-3-1": [[1], [3, 6, 5, 2], [8, 4], [11, 10, 7], [9]],
  "4-3-3": [[1], [3, 6, 5, 2], [8, 4, 7], [11, 9, 10]],
  "4-4-1-1": [[1], [3, 6, 5, 2], [11, 8, 4, 7], [10], [9]],
  "4-4-2": [[1], [3, 6, 5, 2], [11, 8, 4, 7], [9, 10]],
  "4-5-1": [[1], [3, 6, 5, 2], [11, 8, 10, 4, 7], [9]],
  "5-4-1": [[1], [3, 4, 5, 6, 2], [11, 10, 8, 7], [9]],
}));

function getProviderPitchLayout(formation, starters) {
  const template = ESPN_FORMATION_PLACES.get(formation);
  if (!template) return null;
  const playersByPlace = new Map();
  for (const player of starters) {
    const place = player.formationPlace;
    const position = typeof player.position === "string" ? player.position.trim().toUpperCase() : "";
    if (!Number.isInteger(place) || place < 1 || place > 11 || playersByPlace.has(place) ||
        position === "SUB" || ((position === "G" || position === "GK") && place !== 1)) return null;
    playersByPlace.set(place, player);
  }
  return template.map(line => line.map(place => playersByPlace.get(place)));
}

function getPitchLayout(lineup) {
  const starters = (Array.isArray(lineup.players) ? lineup.players : []).filter((p) => p?.starter === true);
  if (starters.length !== 11) return null;
  const knownIds = starters.map(player => player.id).filter(id => typeof id === "string" && id);
  if (new Set(knownIds).size !== knownIds.length) return null;
  const providerLayout = getProviderPitchLayout(lineup.formation, starters);
  if (providerLayout) return providerLayout;
  const ranks = {
    G: 0, GK: 0,
    LB: 1, RB: 1, CB: 1, CD: 1, D: 1,
    LWB: 2, RWB: 2, DM: 2, CDM: 2,
    CM: 3, LM: 3, RM: 3, M: 3,
    AM: 4, CAM: 4, LW: 4, RW: 4, RCF: 4, // ESPN's Rear Center Forward plays behind the striker.
    F: 5, CF: 5, ST: 5, LF: 5, RF: 5,
  };
  const lanes = new Map();
  for (const player of starters) {
    const position = String(player.position || "").toUpperCase();
    const rank = ranks[position.split("-")[0]];
    if (rank === undefined) return null;
    if (!lanes.has(rank)) lanes.set(rank, []);
    lanes.get(rank).push(player);
  }
  if (lanes.get(0)?.length !== 1 || [...lanes.values()].some((line) => line.length > 5)) return null;
  const side = (p) => /^(LB|LM|LW|LWB|LF)$/.test(p.position) ? 0 : /-L$/.test(p.position) ? 1 : /-R$/.test(p.position) ? 3 : /^(RB|RM|RW|RWB|RF)$/.test(p.position) ? 4 : 2;
  return [...lanes.entries()].sort(([a], [b]) => a - b).map(([, players]) => players.sort((a, b) => side(a) - side(b)));
}

function appendStatsSection(stats, teams) {
  const rows = getDetailRows(stats);
  const section = createDetailSection(msg("stats"), "stats");
  const list = document.createElement("div");
  list.className = "stats-list";
  if (rows.length && teams?.home?.name && teams?.away?.name) {
    const legend = document.createElement("div");
    legend.className = "stats-teams";
    legend.append(createTextElement("span", "stat-value--home", teams.home.name), createTextElement("span", "stat-value--away", teams.away.name));
    list.appendChild(legend);
  }

  for (const stat of rows) {
    list.appendChild(createStatItem(stat));
  }

  section.appendChild(
    list.childElementCount > 0
      ? list
      : createTextElement("p", "detail-empty", msg("noStats")),
  );
  leagueDetailContent.appendChild(section);
}

function appendLinkSection(title, rows, emptyText = "", alwaysRender = false) {
  const section = createDetailSection(title, "links");
  const list = document.createElement("div");
  list.className = "link-list";
  for (const row of getDetailRows(rows)) {
    if (row.url) list.appendChild(createExternalLink(row.title || row.label, row.url));
  }
  if (list.childElementCount > 0) {
    section.appendChild(list);
    leagueDetailContent.appendChild(section);
    return;
  }

  if (emptyText) {
    section.appendChild(createTextElement("p", "detail-empty", emptyText));
    leagueDetailContent.appendChild(section);
  } else if (alwaysRender) {
    section.appendChild(createTextElement("p", "detail-empty", msg("noSectionData")));
    leagueDetailContent.appendChild(section);
  }
}

function appendNewsHighlightsSection(news, videos) {
  const section = createDetailSection(`${msg("news")} · ${msg("highlights")}`, "media");
  const list = document.createElement("div");
  list.className = "media-list";

  for (const video of getDetailRows(videos)) {
    const safeUrl = sanitizeExternalUrl(video.url, ["espn.com"]);
    const card = document.createElement(safeUrl ? "a" : "div");
    card.className = "video-card video-card--highlight";
    if (safeUrl) {
      card.href = safeUrl;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
    }
    if (video.thumbnail) {
      card.appendChild(createLogoImage("video-thumb", video.thumbnail, video.title));
    }
    const copy = document.createElement("span");
    copy.className = "highlight-copy";
    copy.append(createTextElement("strong", "highlight-badge", `▶ ${msg("highlights")}`), createTextElement("span", "highlight-title", video.title));
    card.appendChild(copy);
    list.appendChild(card);
  }

  for (const article of getDetailRows(news)) {
    if (article.url) list.appendChild(createExternalLink(article.title || article.label, article.url));
  }
  section.appendChild(list.childElementCount ? list : createTextElement("p", "detail-empty", msg("noSectionData")));
  leagueDetailContent.appendChild(section);
}

function createTimelineItem(item) {
  const row = document.createElement("div");
  const kind = getTimelineKind(item);
  row.className = `timeline-item timeline-item--${kind}`;
  const icons = { goal: "⚽", "own-goal": "⚽", "yellow-card": "▮", "red-card": "▮", substitution: "⇄", kickoff: "⚑", halftime: "Ⅱ", fulltime: "■", penalty: "!", var: "▣", event: "•" };
  const icon = createTextElement("span", `timeline-icon timeline-icon--${kind}`, icons[kind]);
  icon.setAttribute("aria-hidden", "true");
  const body = document.createElement("div");
  body.className = "timeline-body";
  body.appendChild(createTextElement("strong", "timeline-type", item.type || msg("matchDetails")));
  if (item.team || item.players?.length) body.appendChild(createTextElement("span", "timeline-people", [item.team, formatList(item.players)].filter(Boolean).join(" · ")));
  if (item.text && item.text !== item.type) body.appendChild(createTextElement("span", "timeline-text", item.text));
  row.append(
    createTextElement("span", "timeline-minute", item.minute || "-"),
    icon,
    body,
  );
  return row;
}

function getTimelineKind(item) {
  const type = String(item.kind || item.type || "").toLowerCase().replace(/-/g, " ");
  if (/red card|second yellow/.test(type)) return "red-card";
  if (/yellow card/.test(type)) return "yellow-card";
  if (/own goal/.test(type)) return "own-goal";
  if (/goal|penalty.*scored/.test(type) && !/miss|disallow|no goal|cancel/.test(type)) return "goal";
  if (/substitution/.test(type)) return "substitution";
  if (/kickoff|kick off|start.*half/.test(type)) return "kickoff";
  if (/halftime|half time/.test(type)) return "halftime";
  if (/fulltime|full time|end regular|end extra/.test(type)) return "fulltime";
  if (/penalty/.test(type)) return "penalty";
  if (/var/.test(type)) return "var";
  return "event";
}

function createHeadToHeadItem(item) {
  const row = document.createElement("div");
  row.className = "h2h-item";
  row.append(
    createTextElement("span", "h2h-date", formatShortDate(item.date)),
    createTextElement("span", "h2h-match", `${item.homeTeam} ${item.homeScore} - ${item.awayScore} ${item.awayTeam}`),
  );
  return row;
}

function createStatItem(stat) {
  const row = document.createElement("div");
  row.className = "stat-item";
  row.append(
    createTextElement("strong", "stat-value stat-value--home", String(stat.homeValue ?? "—")),
    createTextElement("span", "stat-label", stat.label || msg("stats")),
    createTextElement("strong", "stat-value stat-value--away", String(stat.awayValue ?? "—")),
  );
  const bar = document.createElement("div");
  bar.className = "stat-bar";
  bar.setAttribute("aria-hidden", "true");
  const values = [stat.homeValue, stat.awayValue].map(parseStatValue);
  if (values.every((v) => v !== null) && values[0] + values[1] > 0) {
    const maximum = Math.max(...values);
    const scaled = values.map((value) => value / maximum);
    ["home", "away"].forEach((side, i) => {
      const fill = document.createElement("span");
      fill.className = `stat-bar-fill stat-bar-fill--${side}`;
      fill.style.width = `${scaled[i] / (scaled[0] + scaled[1]) * 100}%`;
      bar.appendChild(fill);
    });
  }
  row.appendChild(bar);
  return row;
}

function parseStatValue(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?%?$/.test(text)) return null;
  const number = Number(text.replace("%", ""));
  return Number.isFinite(number) ? number : null;
}

function hasAnyDetail(detail) {
  return [
    detail.stats,
    detail.timeline,
    detail.lineups,
    detail.headToHead,
    detail.news,
    detail.videos,
    detail.links,
  ].some((value) => Array.isArray(value) && value.length > 0);
}
