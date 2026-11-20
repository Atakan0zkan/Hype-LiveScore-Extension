function createDetailSection(title, key = title) {
  const section = document.createElement("details");
  section.className = "detail-section detail-section--accordion";
  section.dataset.sectionKey = key;

  const summary = document.createElement("summary");
  summary.className = "detail-section-summary";
  summary.appendChild(createTextElement("span", "detail-section-title", title));

  section.appendChild(summary);
  return section;
}

function createStatePanel(text, isError = false) {
  const panel = createTextElement("section", "state-card detail-state", text);
  if (isError) panel.classList.add("state-card--error");
  return panel;
}

function appendMetaItem(parent, label, value) {
  const item = document.createElement("div");
  item.className = "detail-meta-item";
  item.append(
    createTextElement("span", "detail-meta-label", label),
    createTextElement("strong", "detail-meta-value", value || "-"),
  );
  parent.appendChild(item);
}

function createLogoImage(className, src, alt, options = {}) {
  const isLeagueLogo = className === "league-pick-logo" || className === "league-detail-logo";
  const img = document.createElement("img");
  img.className = isLeagueLogo ? "league-logo-image" : className;
  img.alt = isLeagueLogo ? "" : alt || "";
  img.referrerPolicy = "no-referrer";
  img.decoding = "async";
  img.src = getSafeLogoUrl(src);
  img.onerror = function () {
    this.onerror = null;
    this.src = FALLBACK_LOGO;
  };
  if (isLeagueLogo) {
    const wrapper = document.createElement("span");
    wrapper.className = className;
    // The official Süper Lig wordmark is black; old API tone metadata must
    // not make the packaged replacement disappear against a dark background.
    if (options.tone === "light" || src === LOCAL_LEAGUE_LOGOS["tur.1"]) {
      wrapper.classList.add("league-logo--light");
    }
    wrapper.setAttribute("role", "img");
    wrapper.setAttribute("aria-label", alt || "");

    wrapper.appendChild(img);
    return wrapper;
  }

  return img;
}

function getSafeLogoUrl(value) {
  if (value === FALLBACK_LOGO || Object.values(LOCAL_LEAGUE_LOGOS).includes(value)) return value;
  if (typeof value !== "string" || value.length > 2048) return FALLBACK_LOGO;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowedHost = host === "espncdn.com" || host.endsWith(".espncdn.com") ||
      ["cancunfc.mx", "www.cancunfc.mx", "commons.wikimedia.org", "upload.wikimedia.org"].includes(host);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && allowedHost
      ? url.href : FALLBACK_LOGO;
  } catch {
    return FALLBACK_LOGO;
  }
}

function createExternalLink(text, href) {
  const safeHref = sanitizeExternalUrl(href, ["espn.com"]);
  if (!safeHref) {
    return createTextElement("span", "detail-link detail-link--disabled", text || msg("links"));
  }

  const link = document.createElement("a");
  link.className = "detail-link";
  link.href = safeHref;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text || safeHref;
  return link;
}

function sanitizeExternalUrl(value, allowedHostSuffixes) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const isAllowedHost = allowedHostSuffixes.some(
      (suffix) => host === suffix || host.endsWith("." + suffix),
    );
    if (url.protocol !== "https:" || url.username || url.password || url.port || !isAllowedHost) return "";
    return url.href;
  } catch (error) {
    return "";
  }
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}
