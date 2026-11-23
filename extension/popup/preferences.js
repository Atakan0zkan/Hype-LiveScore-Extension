function restorePopupSize() {
  const stored = safeGetStorageItem(STORAGE_KEY_POPUP_SIZE);
  applyPopupSize(POPUP_SIZES.has(stored) ? stored : "default");
}

function applyPopupSize(value) {
  popupSize = POPUP_SIZES.has(value) ? value : "default";
  document.documentElement.dataset.popupSize = popupSize;
  for (const input of settingsPanel.querySelectorAll('input[name="popupSize"]')) {
    input.checked = input.value === popupSize;
  }
}

function savePopupSize(value) {
  if (!POPUP_SIZES.has(value)) return false;
  if (!safeSetStorageItem(STORAGE_KEY_POPUP_SIZE, value)) {
    applyPopupSize(popupSize);
    setSettingsStatus("settingsSaveError", true);
    return false;
  }
  applyPopupSize(value);
  clearSettingsStatus();
  return true;
}

function applySettingsLabels() {
  const label = msg("settings");
  settingsToggle.title = label;
  settingsToggle.setAttribute("aria-label", label);
  const closeLabel = msg("closeSettings");
  const close = document.getElementById("settingsClose");
  close.title = closeLabel;
  close.setAttribute("aria-label", closeLabel);
  const labels = {
    settingsTitle: label,
    popupSizeLabel: msg("popupSize"),
    sizeSmallLabel: msg("sizeSmall"),
    sizeDefaultLabel: msg("sizeDefault"),
    sizeBigLabel: msg("sizeBig"),
    settingsBackupTitle: msg("settingsBackup"),
    settingsBackupHint: msg("settingsBackupHint"),
    settingsFeedbackHint: msg("feedbackHint"),
    settingsVersionLabel: msg("extensionVersion"),
    exportSettings: msg("exportSettings"),
    importSettings: msg("importSettings"),
  };
  for (const [id, text] of Object.entries(labels)) document.getElementById(id).textContent = text;
  document.getElementById("privacyLink").firstChild.textContent = `${msg("privacyPolicy")} `;
  document.getElementById("settingsVersion").textContent = EXTENSION_VERSION === "unknown" ? "" : EXTENSION_VERSION;
  document.getElementById("settingsVersionRow").hidden = EXTENSION_VERSION === "unknown";
  settingsFile.setAttribute("aria-label", msg("importSettings"));
  if (settingsStatusMessage) settingsStatus.textContent = msg(settingsStatusMessage);
}

function setSettingsOpen(open) {
  if (isSettingsOpen === open) return;
  if (open) captureViewState();
  isSettingsOpen = open;
  enforceSnapshotExpiry();
  settingsPanel.hidden = !open;
  appShell.classList.toggle("app-shell--settings-open", open);
  settingsToggle.setAttribute("aria-expanded", String(open));
  syncFootballViewInteractivity();
  if (open) {
    clearSettingsStatus();
    settingsPanel.querySelector('input[name="popupSize"]:checked')?.focus();
  } else {
    // The hidden view must not overwrite its saved scroll with a clamped zero.
    if (renderedViewKey) restoreViewState(renderedViewKey, pendingViewRestore);
    if (lastPayload) renderPayload(lastPayload);
    settingsToggle.focus();
  }
}

function clearSettingsStatus() {
  settingsStatusMessage = null;
  settingsStatus.hidden = true;
  settingsStatus.textContent = "";
  settingsStatus.classList.remove("settings-status--error");
}

function setSettingsStatus(key, error = false) {
  settingsStatusMessage = key;
  settingsStatus.textContent = msg(key);
  settingsStatus.classList.toggle("settings-status--error", error);
  settingsStatus.hidden = false;
}

function buildPreferencesExport() {
  return {
    format: SETTINGS_FILE_FORMAT,
    version: SETTINGS_FILE_VERSION,
    favoriteLeagues: [...favoriteLeagues].filter((code) => typeof code === "string" && Object.hasOwn(LOCAL_LEAGUE_LOGOS, code)).sort(),
    popupSize,
  };
}

function parsePreferencesImport(text) {
  if (typeof text !== "string" || text.length > MAX_SETTINGS_FILE_BYTES) throw new Error("Invalid settings file");
  const data = JSON.parse(text);
  if (!data || Array.isArray(data) || typeof data !== "object" ||
      Object.keys(data).sort().join(",") !== "favoriteLeagues,format,popupSize,version" ||
      data.format !== SETTINGS_FILE_FORMAT || data.version !== SETTINGS_FILE_VERSION ||
      !POPUP_SIZES.has(data.popupSize) || !Array.isArray(data.favoriteLeagues) ||
      data.favoriteLeagues.length > Object.keys(LOCAL_LEAGUE_LOGOS).length ||
      !data.favoriteLeagues.every((code) => typeof code === "string" && Object.hasOwn(LOCAL_LEAGUE_LOGOS, code))) {
    throw new Error("Invalid settings file");
  }
  return { favoriteLeagues: [...new Set(data.favoriteLeagues)].sort(), popupSize: data.popupSize };
}

function applyImportedPreferences(preferences) {
  const oldFavorites = safeGetStorageItem(STORAGE_KEY_FAVORITE_LEAGUES);
  const oldSize = safeGetStorageItem(STORAGE_KEY_POPUP_SIZE);
  const restore = (key, value) => value === null ? safeRemoveStorageItem(key) : safeSetStorageItem(key, value);
  if (!safeWriteStorageJson(STORAGE_KEY_FAVORITE_LEAGUES, preferences.favoriteLeagues) ||
      !safeSetStorageItem(STORAGE_KEY_POPUP_SIZE, preferences.popupSize)) {
    restore(STORAGE_KEY_FAVORITE_LEAGUES, oldFavorites);
    restore(STORAGE_KEY_POPUP_SIZE, oldSize);
    return false;
  }
  favoriteLeagues = new Set(preferences.favoriteLeagues);
  applyPopupSize(preferences.popupSize);
  if (lastPayload) renderPayload(lastPayload);
  return true;
}

function exportPreferences() {
  let url;
  try {
    const blob = new Blob([JSON.stringify(buildPreferencesExport(), null, 2) + "\n"], { type: "application/json" });
    url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "hype-settings.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setSettingsStatus("settingsExported");
  } catch {
    setSettingsStatus("settingsExportError", true);
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function importPreferencesFile(file) {
  if (!file || settingsImportPending) return;
  settingsImportPending = true;
  document.getElementById("importSettings").disabled = true;
  document.getElementById("exportSettings").disabled = true;
  try {
    if (file.size > MAX_SETTINGS_FILE_BYTES) throw new Error("Settings file is too large");
    const preferences = parsePreferencesImport(await file.text());
    const applied = applyImportedPreferences(preferences);
    setSettingsStatus(applied ? "settingsImported" : "settingsSaveError", !applied);
  } catch {
    setSettingsStatus("settingsImportError", true);
  } finally {
    settingsFile.value = "";
    settingsImportPending = false;
    document.getElementById("importSettings").disabled = false;
    document.getElementById("exportSettings").disabled = false;
  }
}

function toggleEnglishOverride() {
  isEnglishOverride = !isEnglishOverride;
  safeSetStorageItem(STORAGE_KEY_ENGLISH_OVERRIDE, isEnglishOverride ? "1" : "0");
  applyLanguageState();
}

function restoreEnglishOverride() {
  isEnglishOverride = safeGetStorageItem(STORAGE_KEY_ENGLISH_OVERRIDE) === "1";
  updateEnglishToggleLabel();
}

function applyLanguageState() {
  applyI18n();
  applyEnabledState();

  if (lastPayload) {
    renderPayload(lastPayload);
  } else if (!leaguePickList.hidden || !leagueDetailView.hidden) {
    showOnly("empty");
  } else if (!errorState.hidden) {
    showError(isFilePreview() ? msg("extensionRuntimeRequired") : msg("error"));
  }
}

function updateEnglishToggleLabel() {
  if (!englishToggle) return;
  const label = isEnglishOverride ? msg("forceEnglishOff") : msg("forceEnglishOn");
  englishToggle.title = label;
  englishToggle.setAttribute("aria-label", label);
  englishToggle.setAttribute("aria-pressed", String(isEnglishOverride));
  englishToggle.classList.toggle("language-toggle--active", isEnglishOverride);
}

function togglePower() {
  isEnabled = !isEnabled;
  safeSetStorageItem(STORAGE_KEY_ENABLED, isEnabled ? "1" : "0");
  applyEnabledState();

  if (isEnabled) {
    resumeAutomaticRefreshWindow();
    startLiveDataFlow();
  } else {
    clearTimeout(refreshTimer);
    clearTimeout(sessionAutoPauseTimer);
    clearTimeout(inactivityTimer);
    abortPendingApiRequests();
  }
}

function restoreEnabledState() {
  isEnabled = safeGetStorageItem(STORAGE_KEY_ENABLED) !== "0";
  applyEnabledState();
}

function applyEnabledState() {
  updatePowerToggleLabel();
  enforceSnapshotExpiry();
  syncFootballViewInteractivity();

  if (isEnabled) {
    appShell.classList.remove("app-shell--disabled");
    powerToggle.classList.remove("power-toggle--off");
    removeOverlay();
  } else {
    appShell.classList.add("app-shell--disabled");
    powerToggle.classList.add("power-toggle--off");
    addOverlay();
    setStatus(msg("paused"));
  }
}

function syncFootballViewInteractivity() {
  for (const element of [loadingState, errorState, emptyState, leaguePickList, leagueDetailView]) {
    element.inert = isSettingsOpen || !isEnabled;
  }
}

function updatePowerToggleLabel() {
  const label = isEnabled ? msg("turnOff") : msg("turnOn");
  powerToggle.title = label;
  powerToggle.setAttribute("aria-label", label);
  powerToggle.setAttribute("aria-pressed", String(isEnabled));
}

function addOverlay() {
  if (contentOverlay) return;
  contentOverlay = document.createElement("div");
  contentOverlay.className = "content-overlay";
  appShell.style.position = "relative";
  appShell.appendChild(contentOverlay);
}

function removeOverlay() {
  if (!contentOverlay) return;
  contentOverlay.remove();
  contentOverlay = null;
}

function restoreFavorites() {
  favoriteLeagues = readSet(STORAGE_KEY_FAVORITE_LEAGUES);
  safeRemoveStorageItem(LEGACY_STORAGE_KEY_FAVORITE_TEAMS);
}

function readSet(key) {
  const value = safeReadStorageJson(key, []);
  return new Set(Array.isArray(value) ? value : []);
}

function writeSet(key, values) {
  safeWriteStorageJson(key, [...values]);
}

function toggleFavoriteLeague(leagueKey) {
  if (favoriteLeagues.has(leagueKey)) favoriteLeagues.delete(leagueKey);
  else favoriteLeagues.add(leagueKey);
  writeSet(STORAGE_KEY_FAVORITE_LEAGUES, favoriteLeagues);
  if (lastPayload) renderPayload(lastPayload);
}

function safeGetStorageItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn("Could not read local storage", error);
    return null;
  }
}

function safeSetStorageItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn("Could not write local storage", error);
    return false;
  }
}

function safeRemoveStorageItem(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn("Could not remove local storage item", error);
    return false;
  }
}

function safeReadStorageJson(key, fallbackValue) {
  try {
    const rawValue = safeGetStorageItem(key);
    return rawValue ? JSON.parse(rawValue) : fallbackValue;
  } catch (error) {
    console.warn("Could not parse local storage JSON", error);
    return fallbackValue;
  }
}

function safeWriteStorageJson(key, value) {
  try {
    return safeSetStorageItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("Could not serialize local storage JSON", error);
    return false;
  }
}
