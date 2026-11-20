function startLiveDataFlow() {
  if (isFilePreview()) {
    hasLoadedOnce = true;
    showError(msg("extensionRuntimeRequired"));
    return;
  }

  refreshDailyRequestLimitState();
  const hydrated = hydrateFromClientCache();

  if (dailyLimitReached) {
    setStatus(msg("requestLimitReached"));
    if (!hydrated && !hasLoadedOnce) showError(msg("requestLimitReached"));
    return;
  }

  if (!hydrated) {
    if (lastPayload) renderPayload(lastPayload);
    loadMatches();
  }
}

function resumeAutomaticRefreshWindow() {
  sessionStartedAt = Date.now();
  lastInteractionAt = Date.now();
  autoPausedForSession = false;
  inactivePaused = false;
  resetSessionAutoPauseTimer();
  resetInactivityTimer();
}

function installActivityListeners() {
  for (const eventName of ["click", "keydown", "mousemove", "scroll", "touchstart"]) {
    document.addEventListener(eventName, recordActivity, { passive: true });
  }
  leaguePickList.addEventListener("scroll", recordActivity, { passive: true });
  leagueDetailContent.addEventListener("scroll", recordActivity, { passive: true });
  settingsPanel.addEventListener("scroll", recordActivity, { passive: true });
}

function installScrollBoundaryGuard() {
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  window.addEventListener("scroll", lockDocumentScroll, { passive: true });
  document.addEventListener("wheel", guardScrollBoundary, { passive: false });
}

function lockDocumentScroll() {
  if (window.scrollX !== 0 || window.scrollY !== 0) {
    window.scrollTo(0, 0);
  }
}

function guardScrollBoundary(event) {
  const target = event.target instanceof Element
    ? event.target.closest(".league-pick-list, .league-detail-scroll, .settings-panel")
    : null;

  if (!target || target.hidden) {
    event.preventDefault();
    return;
  }

  const deltaY = event.deltaY || 0;
  if (deltaY === 0) return;

  const canScroll = target.scrollHeight > target.clientHeight + 1;
  const atTop = target.scrollTop <= 0;
  const atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 1;

  if (!canScroll || (deltaY < 0 && atTop) || (deltaY > 0 && atBottom)) {
    event.preventDefault();
  }
}

function recordActivity() {
  const now = Date.now();
  lastInteractionAt = now;

  if (
    !inactivePaused &&
    now - lastActivityTimerResetAt < ACTIVITY_TIMER_RESET_THROTTLE_MS
  ) {
    return;
  }

  resetInactivityTimer();
  if (!inactivePaused) return;

  inactivePaused = false;
  setStatus(
    lastFetchCompletedAt
      ? `${msg("updated")} ${formatClockTime(lastFetchCompletedAt)}`
      : msg("ready"),
  );
  refreshIfStaleOrSchedule({ minAgeMs: STALE_VISIBLE_REFRESH_MS });
}

function resetSessionAutoPauseTimer() {
  clearTimeout(sessionAutoPauseTimer);
  if (!isEnabled || dailyLimitReached) return;

  const remainingMs = Math.max(0, AUTO_PAUSE_AFTER_MS - (Date.now() - sessionStartedAt));
  sessionAutoPauseTimer = setTimeout(handleSessionAutoPause, remainingMs);
}

function handleSessionAutoPause() {
  if (!isEnabled || document.hidden || dailyLimitReached) return;
  autoPausedForSession = true;
  clearTimeout(refreshTimer);
  setStatus(msg("autoPaused"));
}

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  lastActivityTimerResetAt = Date.now();
  if (!isEnabled || dailyLimitReached) return;
  inactivityTimer = setTimeout(handleInactivityPause, INACTIVITY_PAUSE_AFTER_MS);
}

function handleInactivityPause() {
  if (!isEnabled || document.hidden || dailyLimitReached) return;
  inactivePaused = true;
  clearTimeout(refreshTimer);
  setStatus(msg("idlePaused"));
}

function hydrateFromClientCache() {
  const cached = readClientLiveCache();
  if (!cached || !isClientLiveCacheFresh(cached)) {
    return false;
  }

  lastPayload = cached.payload;
  lastDataUpdatedAt = cached.savedAt;
  lastDataIsStale = false;
  lastFetchCompletedAt = cached.savedAt;
  hasLoadedOnce = true;
  renderPayload(cached.payload);
  setStatus(`${msg("updated")} ${formatClockTime(lastFetchCompletedAt)}`);
  scheduleNextRefresh(
    cached.payload,
    getRemainingRefreshDelay(cached.payload, cached.savedAt),
  );
  return true;
}

function loadMatches(options = {}) {
  if (!liveLoadPromise) {
    liveLoadPromise = performLoadMatches(options).finally(() => {
      liveLoadPromise = null;
    });
  }

  return liveLoadPromise;
}

async function performLoadMatches({ force = false } = {}) {
  clearTimeout(refreshTimer);

  refreshDailyRequestLimitState();
  if (!(force ? canFetchLiveData() : shouldAutoRefresh())) return;

  if (!hasLoadedOnce) {
    showOnly("loading");
  }
  setStatus(hasLoadedOnce ? msg("refreshing") : msg("loading"));

  let didSucceed = false;
  let didHitDailyLimit = false;

  try {
    const payload = await fetchJsonWithTimeout(BACKEND_URL, { cache: "no-store" });
    if (!isValidLivePayload(payload)) {
      throw new Error("Invalid live match payload");
    }

    const freshness = getPayloadFreshness(payload);
    lastPayload = { ...payload, freshness: {
      updatedAt: new Date(freshness.updatedAt).toISOString(), stale: freshness.stale,
    } };
    lastDataUpdatedAt = freshness.updatedAt;
    lastDataIsStale = freshness.stale;
    lastFetchCompletedAt = Date.now();
    if (!lastDataIsStale) consecutiveRefreshErrors = 0;
    writeClientLiveCache(lastPayload, lastDataUpdatedAt);
    renderPayload(lastPayload);
    setStatus(`${msg("updated")} ${formatClockTime(lastDataUpdatedAt)}`);
    hasLoadedOnce = true;
    didSucceed = true;
  } catch (error) {
    if (isDailyRequestLimitError(error)) {
      didHitDailyLimit = true;
      dailyLimitReached = true;
      setStatus(msg("requestLimitReached"));
    } else {
      consecutiveRefreshErrors += 1;
      console.error(error);
      setStatus(msg("refreshFailed"));
    }

    if (!restoreRecentSnapshot()) {
      discardSnapshot();
      showError(
        didHitDailyLimit ? msg("requestLimitReached") : msg("error"),
      );
    }
    hasLoadedOnce = true;
  } finally {
    if (didSucceed) {
      scheduleNextRefresh(lastPayload, lastDataIsStale
        ? Math.min(LIVE_REFRESH_INTERVAL_MS, getRefreshInterval(lastPayload))
        : getRefreshInterval(lastPayload));
    } else if (!didHitDailyLimit) {
      scheduleErrorRetry();
    }
  }
}

function shouldAutoRefresh() {
  refreshDailyRequestLimitState();
  return (
    canFetchLiveData() &&
    !selectedLeagueKey &&
    !selectedMatchKey &&
    !autoPausedForSession &&
    !inactivePaused
  );
}

function canFetchLiveData() {
  return isEnabled && !document.hidden && !dailyLimitReached;
}

function scheduleNextRefresh(payload, delayMs = getRefreshInterval(payload)) {
  clearTimeout(refreshTimer);

  if (!shouldAutoRefresh()) {
    return;
  }

  const delay = Number.isFinite(delayMs)
    ? Math.max(0, delayMs)
    : getRefreshInterval(payload);
  refreshTimer = setTimeout(loadMatches, delay);
}

function getRefreshInterval(payload) {
  if (hasLiveMatches(payload)) return LIVE_REFRESH_INTERVAL_MS;
  if (hasUpcomingMatches(payload)) return IDLE_REFRESH_INTERVAL_MS;
  return QUIET_REFRESH_INTERVAL_MS;
}

function scheduleErrorRetry() {
  if (!shouldAutoRefresh()) return;
  const index = Math.max(0, Math.min(consecutiveRefreshErrors - 1, ERROR_RETRY_DELAYS_MS.length - 1));
  scheduleNextRefresh(lastPayload, ERROR_RETRY_DELAYS_MS[index]);
}

function getRemainingRefreshDelay(payload, completedAt = lastFetchCompletedAt) {
  if (!completedAt) return 0;
  const elapsed = Math.max(0, Date.now() - completedAt);
  return Math.max(0, getRefreshInterval(payload) - elapsed);
}

function handleVisibilityChange() {
  enforceSnapshotExpiry();
  if (document.hidden) {
    clearTimeout(refreshTimer);
    clearTimeout(inactivityTimer);
    return;
  }

  refreshDailyRequestLimitState();
  if (!isEnabled || dailyLimitReached || selectedLeagueKey || selectedMatchKey) {
    return;
  }

  lastInteractionAt = Date.now();
  inactivePaused = false;
  resetInactivityTimer();

  if (Date.now() - sessionStartedAt >= AUTO_PAUSE_AFTER_MS) {
    handleSessionAutoPause();
    return;
  }

  resetSessionAutoPauseTimer();

  const isStale = Date.now() - lastFetchCompletedAt > STALE_VISIBLE_REFRESH_MS;

  if (!lastPayload || isStale) {
    loadMatches();
  } else {
    scheduleNextRefresh(lastPayload, getRemainingRefreshDelay(lastPayload));
  }
}

function refreshIfStaleOrSchedule({ minAgeMs = STALE_VISIBLE_REFRESH_MS } = {}) {
  if (!shouldAutoRefresh()) {
    return;
  }

  if (!lastPayload || Date.now() - lastFetchCompletedAt > minAgeMs) {
    loadMatches();
  } else {
    scheduleNextRefresh(lastPayload, getRemainingRefreshDelay(lastPayload));
  }
}

function readClientLiveCache() {
  const cached = safeReadStorageJson(STORAGE_KEY_LIVE_CACHE, null);
  if (!cached || cached.version !== CLIENT_LIVE_CACHE_VERSION) return null;
  if (!isValidLivePayload(cached.payload)) return null;
  if (!hasRequiredClientCacheLeagues(cached.payload)) return null;
  if (!Number.isFinite(cached.savedAt) || cached.savedAt <= 0 || cached.savedAt > Date.now()) return null;
  if (cached.payload.freshness !== undefined &&
      (typeof cached.payload.freshness?.stale !== "boolean" ||
       typeof cached.payload.freshness?.updatedAt !== "string" ||
       Date.parse(cached.payload.freshness?.updatedAt) !== cached.savedAt)) return null;
  return cached;
}

function isValidLivePayload(payload) {
  const validMatches = (matches) => Array.isArray(matches) && matches.every((match) =>
    match && typeof match === "object" && typeof match.homeTeam === "string" &&
    typeof match.awayTeam === "string" && typeof match.state === "string");
  return Boolean(payload && validMatches(payload.matches) &&
    (payload.leagues === undefined || (Array.isArray(payload.leagues) &&
      payload.leagues.every((league) => league && typeof league.name === "string" && validMatches(league.matches)))));
}

function hasRequiredClientCacheLeagues(payload) {
  if (!Array.isArray(payload.leagues)) return false;
  const leagueCodes = new Set(
    (payload.leagues || [])
      .map((league) => league?.code)
      .filter(Boolean),
  );

  return REQUIRED_CLIENT_CACHE_LEAGUE_CODES.every((code) => leagueCodes.has(code));
}

function writeClientLiveCache(payload, savedAt) {
  safeWriteStorageJson(STORAGE_KEY_LIVE_CACHE, {
    payload,
    savedAt,
    version: CLIENT_LIVE_CACHE_VERSION,
  });
}

function isClientLiveCacheFresh(cached) {
  return cached.payload.freshness?.stale !== true &&
    Date.now() - cached.savedAt <= getClientLiveCacheMaxAge(cached.payload);
}

function getPayloadFreshness(payload) {
  const now = Date.now();
  // Older deployments do not yet supply source timestamps.
  if (payload.freshness === undefined) return { updatedAt: now, stale: false };
  const metadata = payload.freshness;
  const timestamp = typeof metadata?.updatedAt === "string" ? Date.parse(metadata.updatedAt) : NaN;
  if (typeof metadata?.stale !== "boolean" || !Number.isFinite(timestamp) || timestamp <= 0 ||
      timestamp > now + 5000 || now - timestamp >= CLIENT_SNAPSHOT_MAX_AGE_MS) {
    throw new Error("Invalid or expired score freshness metadata");
  }
  return { updatedAt: Math.min(now, timestamp), stale: metadata.stale };
}

function isRecentSnapshot(timestamp) {
  const age = Date.now() - timestamp;
  return Number.isFinite(timestamp) && timestamp > 0 && age >= 0 && age < CLIENT_SNAPSHOT_MAX_AGE_MS;
}

function restoreRecentSnapshot() {
  const cached = readClientLiveCache();
  if (cached && (!lastPayload || cached.savedAt > lastDataUpdatedAt)) {
    lastPayload = cached.payload;
    lastDataUpdatedAt = cached.savedAt;
  }
  if (!lastPayload || !isRecentSnapshot(lastDataUpdatedAt)) return false;
  lastDataIsStale = true;
  lastPayload = { ...lastPayload, freshness: {
    updatedAt: new Date(lastDataUpdatedAt).toISOString(), stale: true,
  } };
  hasLoadedOnce = true;
  renderPayload(lastPayload);
  return true;
}

function discardSnapshot() {
  clearTimeout(snapshotExpiryTimer);
  snapshotExpiryTimer = null;
  lastPayload = null;
  lastDataUpdatedAt = 0;
  lastDataIsStale = false;
  selectedMatchSnapshot = null;
  selectedMatchKey = null;
  selectedLeagueKey = null;
  abortDetailRequest();
}

function enforceSnapshotExpiry() {
  clearTimeout(snapshotExpiryTimer);
  snapshotExpiryTimer = null;
  if (lastPayload && lastDataIsStale && !isRecentSnapshot(lastDataUpdatedAt)) {
    discardSnapshot();
    showError(msg("error"));
    return false;
  }
  // No freshness text or banner is shown. Enforce the original source-time
  // limit even while settings are open or automatic refresh is paused.
  if (lastPayload && lastDataIsStale && !document.hidden) {
    snapshotExpiryTimer = setTimeout(enforceSnapshotExpiry,
      Math.max(1, CLIENT_SNAPSHOT_MAX_AGE_MS - (Date.now() - lastDataUpdatedAt)));
  }
}

function getClientLiveCacheMaxAge(payload) {
  if (hasLiveMatches(payload)) return CLIENT_LIVE_CACHE_MAX_AGE_LIVE_MS;
  if (hasUpcomingMatches(payload)) return CLIENT_LIVE_CACHE_MAX_AGE_IDLE_MS;
  return CLIENT_LIVE_CACHE_MAX_AGE_QUIET_MS;
}

function buildMatchDetailUrl(match) {
  const url = new URL(BACKEND_URL);
  url.pathname = "/match-detail";
  url.searchParams.set("eventId", match.id);
  url.searchParams.set("leagueCode", match.leagueCode);
  return url.href;
}

function buildLeagueStandingsUrl(leagueCode) {
  const url = new URL(BACKEND_URL);
  url.pathname = "/league-standings";
  url.searchParams.set("leagueCode", leagueCode);
  if (leagueCode === FIFA_WORLD_CUP_LEAGUE_CODE) url.searchParams.set("season", FIFA_WORLD_CUP_YEAR);
  return url.href;
}

function buildTournamentBracketUrl(leagueCode) {
  const url = new URL(BACKEND_URL);
  url.pathname = "/tournament-bracket";
  url.searchParams.set("leagueCode", leagueCode);
  url.searchParams.set("season", FIFA_WORLD_CUP_YEAR);
  return url.href;
}

function refreshDailyRequestLimitState() {
  const bucket = readDailyRequestBucket();
  dailyLimitReached = bucket.successful >= DAILY_REQUEST_LIMIT;
  return dailyLimitReached;
}

function tryStartDailyRequest() {
  const bucket = readDailyRequestBucket();
  if (bucket.successful >= DAILY_REQUEST_LIMIT) {
    dailyLimitReached = true;
    return false;
  }

  bucket.attempted += 1;
  writeDailyRequestBucket(bucket);
  dailyLimitReached = false;
  return true;
}

function recordDailyRequestSuccess() {
  const bucket = readDailyRequestBucket();
  bucket.successful += 1;
  writeDailyRequestBucket(bucket);
  dailyLimitReached = bucket.successful >= DAILY_REQUEST_LIMIT;
}

function readDailyRequestBucket() {
  const today = getUtcDateKey();
  const bucket = safeReadStorageJson(STORAGE_KEY_DAILY_REQUEST_BUCKET, null);
  if (!bucket || bucket.date !== today) {
    return { date: today, attempted: 0, successful: 0 };
  }

  const legacyCount = Number.isFinite(bucket.count)
    ? Math.max(0, Math.floor(bucket.count))
    : 0;
  const attempted = Number.isFinite(bucket.attempted)
    ? Math.max(0, Math.floor(bucket.attempted))
    : legacyCount;
  const successful = Number.isFinite(bucket.successful)
    ? Math.max(0, Math.floor(bucket.successful))
    : legacyCount;

  return { date: today, attempted, successful };
}

function writeDailyRequestBucket(bucket) {
  safeWriteStorageJson(STORAGE_KEY_DAILY_REQUEST_BUCKET, bucket);
}

function isExpiredLazyError(entry) {
  return Boolean(
    entry &&
      entry.status === "error" &&
      Number.isFinite(entry.failedAt) &&
      Date.now() - entry.failedAt >= LAZY_ERROR_RETRY_MS,
  );
}

function getUtcDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function createDailyRequestLimitError() {
  const error = new Error("Daily request limit reached");
  error.code = "DAILY_REQUEST_LIMIT";
  return error;
}

function isDailyRequestLimitError(error) {
  return Boolean(error && error.code === "DAILY_REQUEST_LIMIT");
}

function createAbortError() {
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

async function fetchJsonWithTimeout(url, options = {}) {
  const { headers = {}, signal: externalSignal, ...rest } = options;
  if (externalSignal && externalSignal.aborted) {
    throw createAbortError();
  }

  if (!tryStartDailyRequest()) {
    throw createDailyRequestLimitError();
  }

  const controller = new AbortController();
  let timedOut = false;
  let removeAbortListener = () => {};

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      const handleAbort = () => controller.abort();
      externalSignal.addEventListener("abort", handleAbort, { once: true });
      removeAbortListener = () =>
        externalSignal.removeEventListener("abort", handleAbort);
    }
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...rest,
      headers: {
        Accept: "application/json",
        ...headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = new Error("Backend returned " + response.status);
      error.status = response.status;
      throw error;
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType && !contentType.includes("json")) {
      throw new Error("Invalid response content type");
    }

    const data = await response.json();
    recordDailyRequestSuccess();
    return data;
  } catch (error) {
    if (timedOut && error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    removeAbortListener();
  }
}
