let appShell;
let appTitle;
let statusBar;
let powerToggle;
let englishToggle;
let settingsToggle;
let settingsPanel;
let settingsStatus;
let settingsFile;
let popupSize = "default";
let isSettingsOpen = false;
let settingsStatusMessage = null;
let settingsImportPending = false;
let loadingState;
let errorState;
let emptyState;
let leaguePickList;
let leagueDetailView;
let leagueDetailContent;
let backBtn;

let hasLoadedOnce = false;
let lastPayload = null;
let lastFetchCompletedAt = 0;
let lastDataUpdatedAt = 0;
let lastDataIsStale = false;
let snapshotExpiryTimer = null;
let refreshTimer = null;
let sessionAutoPauseTimer = null;
let inactivityTimer = null;
let sessionStartedAt = Date.now();
let lastInteractionAt = Date.now();
let lastActivityTimerResetAt = lastInteractionAt;
let autoPausedForSession = false;
let inactivePaused = false;
let dailyLimitReached = false;
let consecutiveRefreshErrors = 0;
let selectedLeagueKey = null;
let selectedMatchKey = null;
let selectedMatchSnapshot = null;
// Navigation preferences are session-only, never analytics or persistent IDs.
const viewStates = new Map();
let renderedViewKey = null;
let pendingViewRestore = false;
let isEnabled = true;
let isEnglishOverride = false;
let contentOverlay = null;
let detailAbortController = null;
let detailAbortKey = null;
let liveLoadPromise = null;
let favoriteLeagues = new Set();
const matchDetailCache = new Map();
const leagueStandingsCache = new Map();
const tournamentBracketCache = new Map();
const openTournamentBracketLeagueCodes = new Set();

document.addEventListener("DOMContentLoaded", () => {
  appShell = document.querySelector(".app-shell");
  appTitle = document.getElementById("appTitle");
  statusBar = document.getElementById("statusBar");
  powerToggle = document.getElementById("powerToggle");
  englishToggle = document.getElementById("englishToggle");
  settingsToggle = document.getElementById("settingsToggle");
  settingsPanel = document.getElementById("settingsPanel");
  settingsStatus = document.getElementById("settingsStatus");
  settingsFile = document.getElementById("settingsFile");
  loadingState = document.getElementById("loadingState");
  errorState = document.getElementById("errorState");
  emptyState = document.getElementById("emptyState");
  leaguePickList = document.getElementById("leaguePickList");
  leagueDetailView = document.getElementById("leagueDetailView");
  leagueDetailContent = document.getElementById("leagueDetailContent");
  backBtn = document.getElementById("backBtn");

  restorePopupSize();
  restoreEnglishOverride();
  applyDocumentDirection();
  applyI18n();
  restoreFavorites();
  restoreEnabledState();

  englishToggle.addEventListener("click", toggleEnglishOverride);
  powerToggle.addEventListener("click", togglePower);
  settingsToggle.addEventListener("click", () => setSettingsOpen(!isSettingsOpen));
  document.getElementById("settingsClose").addEventListener("click", () => setSettingsOpen(false));
  for (const input of settingsPanel.querySelectorAll('input[name="popupSize"]')) {
    input.addEventListener("change", () => { if (input.checked) savePopupSize(input.value); });
  }
  document.getElementById("exportSettings").addEventListener("click", exportPreferences);
  document.getElementById("importSettings").addEventListener("click", () => settingsFile.click());
  settingsFile.addEventListener("change", () => importPreferencesFile(settingsFile.files?.[0]));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isSettingsOpen) {
      event.preventDefault();
      setSettingsOpen(false);
    }
  });
  backBtn.addEventListener("click", handleBack);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  installActivityListeners();
  installScrollBoundaryGuard();
  resetSessionAutoPauseTimer();
  resetInactivityTimer();

  if (isEnabled) {
    startLiveDataFlow();
  }
});

function renderPayload(payload) {
  if (enforceSnapshotExpiry() === false) return;
  if (isSettingsOpen) return;
  const leagues = normalizeLeagueGroups(payload);

  if (leagues.length === 0) {
    showOnly("empty");
    return;
  }

  if (selectedLeagueKey) {
    const league = leagues.find(
      (item) => getLeagueKey(item) === selectedLeagueKey,
    );

    if (!league) {
      selectedLeagueKey = null;
      selectedMatchKey = null;
      selectedMatchSnapshot = null;
      renderLeaguePickList(leagues);
      return;
    }

    if (selectedMatchKey) {
      const snapshotMatchesSelection =
        selectedMatchSnapshot &&
        getMatchKey(selectedMatchSnapshot) === selectedMatchKey &&
        (selectedMatchSnapshot.state !== "finished" || isVisibleMatch(selectedMatchSnapshot));
      const match =
        league.matches.find((item) => getMatchKey(item) === selectedMatchKey) ||
        (snapshotMatchesSelection ? selectedMatchSnapshot : null);

      if (match) {
        renderMatchDetail(league, match);
        return;
      }
      selectedMatchKey = null;
      selectedMatchSnapshot = null;
    }

    renderLeagueDetail(league);
    return;
  }

  renderLeaguePickList(leagues);
}

function captureViewState() {
  if (isSettingsOpen || !renderedViewKey || pendingViewRestore) return;
  const container = renderedViewKey === "pick" ? leaguePickList : leagueDetailContent;
  const sections = {};
  for (const section of container.querySelectorAll("details[data-section-key]")) {
    sections[section.dataset.sectionKey] = section.open;
  }
  viewStates.delete(renderedViewKey);
  viewStates.set(renderedViewKey, { scrollTop: container.scrollTop, sections });
  while (viewStates.size > 80) viewStates.delete(viewStates.keys().next().value);
}

function restoreViewState(key, loading = false) {
  renderedViewKey = key;
  const container = key === "pick" ? leaguePickList : leagueDetailContent;
  const state = viewStates.get(key);
  for (const section of container.querySelectorAll("details[data-section-key]")) {
    if (Object.hasOwn(state?.sections || {}, section.dataset.sectionKey)) {
      section.open = state.sections[section.dataset.sectionKey];
    }
  }
  container.scrollTop = state?.scrollTop || 0;
  pendingViewRestore = loading && Boolean(state?.scrollTop);
  // A deliberate user scroll during loading takes precedence over restoration.
  if (!container.dataset.navigationTracking) {
    container.dataset.navigationTracking = "true";
    for (const event of ["wheel", "touchstart", "keydown", "pointerdown"]) {
      container.addEventListener(event, () => { pendingViewRestore = false; }, { passive: true });
    }
  }
}

function handleBack() {
  if (selectedMatchKey) {
    selectedMatchKey = null;
    selectedMatchSnapshot = null;
    if (lastPayload) renderPayload(lastPayload);
    refreshIfStaleOrSchedule();
    return;
  }

  selectedLeagueKey = null;
  selectedMatchSnapshot = null;
  if (lastPayload) renderPayload(lastPayload);
  refreshIfStaleOrSchedule({ minAgeMs: DETAIL_RETURN_REFRESH_MIN_INTERVAL_MS });
}

function setStatus(text) {
  if (statusBar) {
    statusBar.textContent = text || "";
  }
}

function abortDetailRequest() {
  if (detailAbortController) {
    detailAbortController.abort();
    if (matchDetailCache.get(detailAbortKey)?.status === "loading") {
      matchDetailCache.delete(detailAbortKey);
    }
    detailAbortController = null;
    detailAbortKey = null;
  }
}

function showError(message = msg("error")) {
  errorState.textContent = message;
  showOnly("error");
}

function showOnly(state) {
  loadingState.hidden = state !== "loading";
  errorState.hidden = state !== "error";
  emptyState.hidden = state !== "empty";
  leaguePickList.hidden = state !== "pick";
  leagueDetailView.hidden = state !== "detail";
}
