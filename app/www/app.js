const state = {
  containers: [],
  busy: false,
  connection: { ok: null, key: "checkingConnection", params: {} },
  checkById: {},
  selectedById: {},
  updateLockedById: {},
  rollbackLockedById: {},
  rollbackOptionsById: {},
  rollbackTargetById: {},
  theme: "auto",
  themeStyle: "modern",
  fontSize: "100",
  language: "en",
  resolvedLanguage: "en",
  themeOptions: [],
  themeStyleOptions: [],
  languageOptions: [],
  branding: {},
  translations: {},
  fallbackTranslations: {}
};

const els = {
  themeStyleCss: document.getElementById("theme-style-css"),
  brandText: document.getElementById("brand-text"),
  subtitle: document.getElementById("subtitle"),
  themeStyleLabel: document.getElementById("theme-style-label"),
  themeLabel: document.getElementById("theme-label"),
  fontLabel: document.getElementById("font-label"),
  languageLabel: document.getElementById("lang-label"),
  themeToggle: document.getElementById("theme-toggle"),
  themeMenu: document.getElementById("theme-menu"),
  themeCurrentIcon: document.getElementById("theme-current-icon"),
  themeCurrentLabel: document.getElementById("theme-current-label"),
  themeSelect: document.getElementById("theme"),
  themeDropdown: document.getElementById("theme-dropdown"),
  themeStyleToggle: document.getElementById("theme-style-toggle"),
  themeStyleMenu: document.getElementById("theme-style-menu"),
  themeStyleCurrentLabel: document.getElementById("theme-style-current-label"),
  themeStyleSelect: document.getElementById("theme-style"),
  themeStyleDropdown: document.getElementById("theme-style-dropdown"),
  fontToggle: document.getElementById("font-toggle"),
  fontMenu: document.getElementById("font-menu"),
  fontCurrentLabel: document.getElementById("font-current-label"),
  fontSelect: document.getElementById("font-size"),
  fontDropdown: document.getElementById("font-dropdown"),
  languageToggle: document.getElementById("lang-toggle"),
  languageMenu: document.getElementById("lang-menu"),
  languageCurrentIcon: document.getElementById("lang-current-icon"),
  languageCurrentLabel: document.getElementById("lang-current-label"),
  languageSelect: document.getElementById("lang"),
  languageDropdown: document.getElementById("lang-dropdown"),
  selectAll: document.getElementById("selectAll"),
  bulkCheckButton: document.getElementById("bulkCheckButton"),
  containersBody: document.getElementById("containersBody"),
  rowTemplate: document.getElementById("rowTemplate"),
  logBox: document.getElementById("logBox"),
  activityTitle: document.getElementById("activityTitle"),
  activityTimeHeader: document.getElementById("activityTimeHeader"),
  activityEventHeader: document.getElementById("activityEventHeader"),
  activityDetailsHeader: document.getElementById("activityDetailsHeader"),
  connectionBadge: document.getElementById("connectionBadge"),
  countLabel: document.getElementById("countLabel"),
  headerName: document.getElementById("headerName"),
  headerId: document.getElementById("headerId"),
  headerStatus: document.getElementById("headerStatus"),
  headerUpdate: document.getElementById("headerUpdate"),
  headerImage: document.getElementById("headerImage"),
  headerActions: document.getElementById("headerActions"),
  bulkButtons: Array.from(document.querySelectorAll("[data-bulk-action]")),
  bulkUpdateButton: document.querySelector('[data-bulk-action="update"]'),
  bulkUpdateIcon: document.querySelector('[data-bulk-action="update"] .bulk-update-icon'),
  bulkUpdateLabel: document.querySelector('[data-bulk-action="update"] .bulk-update-label')
};

function refreshHeaderElements() {
  els.brandText = document.getElementById("brand-text");
  els.subtitle = document.getElementById("subtitle");
  els.themeStyleLabel = document.getElementById("theme-style-label");
  els.themeLabel = document.getElementById("theme-label");
  els.fontLabel = document.getElementById("font-label");
  els.languageLabel = document.getElementById("lang-label");
  els.themeToggle = document.getElementById("theme-toggle");
  els.themeMenu = document.getElementById("theme-menu");
  els.themeCurrentIcon = document.getElementById("theme-current-icon");
  els.themeCurrentLabel = document.getElementById("theme-current-label");
  els.themeSelect = document.getElementById("theme");
  els.themeDropdown = document.getElementById("theme-dropdown");
  els.themeStyleToggle = document.getElementById("theme-style-toggle");
  els.themeStyleMenu = document.getElementById("theme-style-menu");
  els.themeStyleCurrentLabel = document.getElementById("theme-style-current-label");
  els.themeStyleSelect = document.getElementById("theme-style");
  els.themeStyleDropdown = document.getElementById("theme-style-dropdown");
  els.fontToggle = document.getElementById("font-toggle");
  els.fontMenu = document.getElementById("font-menu");
  els.fontCurrentLabel = document.getElementById("font-current-label");
  els.fontSelect = document.getElementById("font-size");
  els.fontDropdown = document.getElementById("font-dropdown");
  els.languageToggle = document.getElementById("lang-toggle");
  els.languageMenu = document.getElementById("lang-menu");
  els.languageCurrentIcon = document.getElementById("lang-current-icon");
  els.languageCurrentLabel = document.getElementById("lang-current-label");
  els.languageSelect = document.getElementById("lang");
  els.languageDropdown = document.getElementById("lang-dropdown");
}

const DEFAULT_THEME_OPTIONS = [
  { value: "auto", label: { en: "Auto", ro: "Auto" }, icon: "/images/ui/theme-auto.svg" },
  { value: "light", label: { en: "Light", ro: "Luminos" }, icon: "/images/ui/theme-light.svg" },
  { value: "dark", label: { en: "Dark", ro: "Intunecat" }, icon: "/images/ui/theme-dark.svg" }
];

const DEFAULT_THEME_STYLE_OPTIONS = [
  { value: "modern", label: { en: "Modern", ro: "Modern" }, css: "styles-modern.css" },
  { value: "classic", label: { en: "Classic", ro: "Clasic" }, css: "styles-classic.css" },
  { value: "glass", label: { en: "Glass", ro: "Glass" }, css: "styles-glass.css" }
];

const DEFAULT_LANGUAGE_OPTIONS = [
  { code: "en", label: "English", icon: "/images/lang/en.svg", file: "/i18n/en.json" },
  { code: "ro", label: "Română", icon: "/images/lang/ro.svg", file: "/i18n/ro.json" }
];

const FONT_ITEMS = [
  { value: "25", labelKey: "fontLegacy" },
  { value: "50", labelKey: "fontCurrent" },
  { value: "100", labelKey: "fontLarge" }
];

const prefersDarkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const SHARED_HEADER_OWNS_CONTROLS = Boolean(window.MikroTikSharedHeader && window.MikroTikSharedHeader.ownsControls);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatTemplate(template, params = {}) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      return String(params[key]);
    }
    return `{${key}}`;
  });
}

function t(key, params = {}) {
  const value = state.branding[key] ?? state.translations[key] ?? state.fallbackTranslations[key] ?? key;
  return formatTemplate(value, params);
}

function normalizeList(items, fallback = []) {
  return Array.isArray(items) && items.length ? items : fallback.slice();
}

function languageMatches(code) {
  return typeof code === "string" && /^[a-z][a-z0-9-_]{1,15}$/i.test(code.trim());
}

function normalizeLanguageOptions(items) {
  const out = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((entry) => {
    const code = String(entry?.code || "").trim().toLowerCase();
    if (!languageMatches(code) || seen.has(code)) {
      return;
    }
    seen.add(code);
    out.push({
      code,
      label: String(entry.label || code.toUpperCase()).trim(),
      file: String(entry.file || `/i18n/${code}.json`).trim(),
      icon: String(entry.icon || `/images/lang/${code}.svg`).trim()
    });
  });
  return out.length ? out : DEFAULT_LANGUAGE_OPTIONS.slice();
}

function normalizeThemeOptions(items) {
  const out = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((entry) => {
    const value = String(entry?.value || "").trim().toLowerCase();
    if (!languageMatches(value) || seen.has(value)) {
      return;
    }
    seen.add(value);
    out.push({
      value,
      label: entry?.label && typeof entry.label === "object" ? entry.label : { en: String(entry?.label || value), ro: String(entry?.label || value) },
      icon: String(entry.icon || `/images/ui/theme-${value}.svg`).trim()
    });
  });
  return out.length ? out : DEFAULT_THEME_OPTIONS.slice();
}

function normalizeThemeStyleOptions(items) {
  const out = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((entry) => {
    const value = String(entry?.value || "").trim().toLowerCase();
    if (!languageMatches(value) || seen.has(value)) {
      return;
    }
    seen.add(value);
    out.push({
      value,
      label: entry?.label && typeof entry.label === "object" ? entry.label : { en: String(entry?.label || value), ro: String(entry?.label || value) },
      css: String(entry.css || `styles-${value}.css`).trim()
    });
  });
  return out.length ? out : DEFAULT_THEME_STYLE_OPTIONS.slice();
}

function getLocalizedLabel(entry) {
  if (!entry) return "";
  if (entry.label && typeof entry.label === "object") {
    return entry.label[state.resolvedLanguage] || entry.label.en || entry.label.ro || entry.label[Object.keys(entry.label)[0]] || "";
  }
  return String(entry.label || "");
}

function currentLanguageOption() {
  return state.languageOptions.find((entry) => entry.code === state.language) || null;
}

function currentThemeOption() {
  return state.themeOptions.find((entry) => entry.value === state.theme) || state.themeOptions[0] || DEFAULT_THEME_OPTIONS[0];
}

function currentThemeStyleOption() {
  return state.themeStyleOptions.find((entry) => entry.value === state.themeStyle) || state.themeStyleOptions[0] || DEFAULT_THEME_STYLE_OPTIONS[0];
}

function availableLanguageCode(code) {
  return state.languageOptions.some((entry) => entry.code === code);
}

function detectBrowserLanguage() {
  const raw = [
    navigator.language,
    ...(Array.isArray(navigator.languages) ? navigator.languages : [])
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  for (const candidate of raw) {
    if (availableLanguageCode(candidate)) {
      return candidate;
    }
    const base = candidate.split("-")[0];
    if (availableLanguageCode(base)) {
      return base;
    }
  }
  return state.languageOptions[0]?.code || "en";
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path}`);
  }
  return response.json();
}

function closeThemeMenu() {
  closeDropdownMenu(els.themeMenu, els.themeToggle);
}

function closeThemeStyleMenu() {
  closeDropdownMenu(els.themeStyleMenu, els.themeStyleToggle);
}

function closeLanguageMenu() {
  closeDropdownMenu(els.languageMenu, els.languageToggle);
}

function renderFontMenu() {
  if (!els.fontMenu) return;
  els.fontMenu.innerHTML = "";
  FONT_ITEMS.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-item";
    button.setAttribute("role", "option");
    button.setAttribute("data-font-size", item.value);
    button.innerHTML = `<img src="/images/ui/font-size.svg" alt="" /><span>${t(item.labelKey)}</span>`;
    button.addEventListener("click", async () => {
      closeFontMenu();
      try {
        await setFontSize(item.value);
      } catch (error) {
        appendLog(t("fontSaveFailed", { message: error.message }));
      }
    });
    els.fontMenu.appendChild(button);
  });
  updateFontButton();
}

function getOptionLabel(entry) {
  if (!entry) return "";
  if (entry.labelKey) {
    return t(entry.labelKey, entry.labelParams || {});
  }
  if (entry.label && typeof entry.label === "object") {
    return entry.label[state.resolvedLanguage] || entry.label.en || entry.label.ro || entry.label[Object.keys(entry.label)[0]] || "";
  }
  return String(entry.label || entry.code || entry.value || "");
}

function updateThemeButton() {
  if (!els.themeCurrentIcon || !els.themeCurrentLabel || !els.themeSelect) return;
  const picked = currentThemeOption();
  els.themeCurrentIcon.setAttribute("src", picked.icon || "/images/ui/theme-auto.svg");
  els.themeCurrentLabel.textContent = getOptionLabel(picked);
  els.themeSelect.value = state.theme;
}

function updateThemeStyleButton() {
  if (!els.themeStyleCurrentLabel || !els.themeStyleSelect) return;
  const picked = currentThemeStyleOption();
  els.themeStyleCurrentLabel.textContent = getOptionLabel(picked);
  els.themeStyleSelect.value = state.themeStyle;
}

function updateFontButton() {
  if (!els.fontCurrentLabel || !els.fontSelect) return;
  const key = state.fontSize === "25" ? "fontLegacy" : state.fontSize === "100" ? "fontLarge" : "fontCurrent";
  els.fontCurrentLabel.textContent = t(key);
  els.fontSelect.value = state.fontSize;
}

function updateLanguageButton() {
  if (!els.languageCurrentIcon || !els.languageCurrentLabel || !els.languageSelect) return;
  const picked = currentLanguageOption() || state.languageOptions[0];
  if (picked?.icon) {
    els.languageCurrentIcon.setAttribute("src", picked.icon);
  }
  els.languageCurrentLabel.textContent = getOptionLabel(picked);
  els.languageSelect.value = state.language;
}

function applyTheme() {
  const resolvedTheme = state.theme === "auto"
    ? (prefersDarkQuery && prefersDarkQuery.matches ? "dark" : "light")
    : state.theme;
  document.documentElement.setAttribute("data-theme", resolvedTheme);
  updateThemeButton();
}

function applyThemeStyle() {
  const picked = currentThemeStyleOption();
  document.documentElement.setAttribute("data-theme-style", state.themeStyle);
  if (els.themeStyleCss) {
    els.themeStyleCss.setAttribute("href", `/${String(picked.css || `styles-${state.themeStyle}.css`).replace(/^\/+/, "")}`);
  }
  updateThemeStyleButton();
}

function closeFontMenu() {
  closeDropdownMenu(els.fontMenu, els.fontToggle);
}

function toggleFontMenu() {
  toggleDropdownMenu(els.fontMenu, els.fontToggle, [closeThemeMenu, closeThemeStyleMenu, closeLanguageMenu]);
}

function applyFontSize() {
  const mode = (state.fontSize === "25" || state.fontSize === "50" || state.fontSize === "100") ? state.fontSize : "100";
  state.fontSize = mode;
  document.documentElement.setAttribute("data-font-size", mode);
  if (els.fontSelect) {
    els.fontSelect.value = mode;
  }
  updateFontButton();
}

function applyLanguage() {
  document.documentElement.lang = state.resolvedLanguage || "en";
  updateLanguageButton();
}

function translateContainerStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "running") return t("running");
  if (normalized === "stopped") return t("stopped");
  return status || "-";
}

function applyStaticTranslations() {
  document.title = t("appTitle");
  if (els.brandText) els.brandText.textContent = t("brandText");
  if (els.subtitle) els.subtitle.textContent = t("subtitle");
  if (els.themeStyleLabel) els.themeStyleLabel.textContent = t("themeStyleMenuLabel");
  if (els.themeLabel) els.themeLabel.textContent = t("themeMenuLabel");
  if (els.fontLabel) els.fontLabel.textContent = t("fontSize");
  if (els.languageLabel) els.languageLabel.textContent = t("language");
  if (els.themeStyleMenu) els.themeStyleMenu.setAttribute("aria-label", t("themeStyleOptions"));
  if (els.themeMenu) els.themeMenu.setAttribute("aria-label", t("themeOptions"));
  if (els.fontMenu) els.fontMenu.setAttribute("aria-label", t("fontSize"));
  if (els.languageMenu) els.languageMenu.setAttribute("aria-label", t("languageOptions"));
  const fontLegacy = document.getElementById("font-opt-legacy");
  const fontCurrent = document.getElementById("font-opt-current");
  const fontLarge = document.getElementById("font-opt-large");
  if (fontLegacy) fontLegacy.textContent = t("fontLegacy");
  if (fontCurrent) fontCurrent.textContent = t("fontCurrent");
  if (fontLarge) fontLarge.textContent = t("fontLarge");
  els.bulkCheckButton.textContent = t("checkSelectedAll");
  els.headerName.textContent = t("name");
  els.headerId.textContent = t("id");
  els.headerStatus.textContent = t("status");
  els.headerUpdate.textContent = t("update");
  els.headerImage.textContent = t("image");
  els.headerActions.textContent = t("actions");
  els.activityTitle.textContent = t("activity");
  els.activityTimeHeader.textContent = t("activityTime");
  els.activityEventHeader.textContent = t("activityEvent");
  els.activityDetailsHeader.textContent = t("activityDetails");
  if (state.connection) {
    setConnection(state.connection.ok, state.connection.key, state.connection.params || {}, true);
  }
  refreshBulkUpdateButton();
}

function normalizeCssPath(value, fallbackName) {
  const cleaned = String(value || fallbackName || "").trim().replace(/^\/+/, "");
  return cleaned ? `/${cleaned}` : "";
}

function renderThemeMenu() {
  els.themeMenu.innerHTML = "";
  els.themeSelect.innerHTML = "";
  state.themeOptions.forEach((item) => {
    const label = getOptionLabel(item);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-item";
    button.setAttribute("role", "option");
    button.innerHTML = `<img src="${item.icon || "/images/ui/theme-auto.svg"}" alt="" /><span>${label}</span>`;
    button.addEventListener("click", async () => {
      closeThemeMenu();
      try {
        await setTheme(item.value);
      } catch (error) {
        appendLog(t("themeSaveFailed", { message: error.message }));
      }
    });
    els.themeMenu.appendChild(button);

    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = label;
    els.themeSelect.appendChild(option);
  });
  updateThemeButton();
}

function renderThemeStyleMenu() {
  els.themeStyleMenu.innerHTML = "";
  els.themeStyleSelect.innerHTML = "";
  state.themeStyleOptions.forEach((item) => {
    const label = getOptionLabel(item);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-item";
    button.setAttribute("role", "option");
    button.innerHTML = `<img src="${item.icon || "/images/ui/theme-style.svg"}" alt="" /><span>${label}</span>`;
    button.addEventListener("click", async () => {
      closeThemeStyleMenu();
      try {
        await setThemeStyle(item.value);
      } catch (error) {
        appendLog(t("themeStyleSaveFailed", { message: error.message }));
      }
    });
    els.themeStyleMenu.appendChild(button);

    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = label;
    els.themeStyleSelect.appendChild(option);
  });
  updateThemeStyleButton();
}

function renderLanguageMenu() {
  els.languageMenu.innerHTML = "";
  els.languageSelect.innerHTML = "";
  state.languageOptions.forEach((item) => {
    const label = getOptionLabel(item);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-item";
    button.setAttribute("role", "option");
    button.innerHTML = `<img src="${item.icon || "/images/ui/theme-auto.svg"}" alt="" /><span>${label}</span>`;
    button.addEventListener("click", async () => {
      closeLanguageMenu();
      try {
        await setLanguage(item.code);
      } catch (error) {
        appendLog(t("languageSaveFailed", { message: error.message }));
      }
    });
    els.languageMenu.appendChild(button);

    const option = document.createElement("option");
    option.value = item.code;
    option.textContent = label;
    els.languageSelect.appendChild(option);
  });
  updateLanguageButton();
}

async function saveSettings(patch) {
  await apiRequest("/api/settings", {
    method: "POST",
    body: JSON.stringify(patch || {})
  });
}

async function loadSettings() {
  const result = await apiRequest("/api/settings.json");
  const incoming = result?.settings || {};
  state.theme = state.themeOptions.some((entry) => entry.value === incoming.theme) ? incoming.theme : (state.themeOptions[0]?.value || "auto");
  state.themeStyle = state.themeStyleOptions.some((entry) => entry.value === (incoming.theme_style || incoming.themeStyle))
    ? (incoming.theme_style || incoming.themeStyle)
    : (state.themeStyleOptions[0]?.value || "modern");
  const requestedFontSize = String(incoming.font_size || incoming.fontSize || "100").trim();
  state.fontSize = FONT_ITEMS.some((entry) => entry.value === requestedFontSize) ? requestedFontSize : "100";
  const requestedLanguage = String(incoming.language || "").trim().toLowerCase();
  const browserLanguage = detectBrowserLanguage();
  if (state.languageOptions.some((entry) => entry.code === requestedLanguage)) {
    state.language = requestedLanguage;
  } else if (state.languageOptions.some((entry) => entry.code === browserLanguage)) {
    state.language = browserLanguage;
  } else {
    state.language = "en";
  }
}

async function loadUiRegistries() {
  const [themeOptions, themeStyleOptions, languageOptions] = await Promise.allSettled([
    fetchJson("/common/theme-options.json"),
    fetchJson("/common/theme-styles.json"),
    fetchJson("/i18n/languages.json")
  ]);

  state.themeOptions = normalizeThemeOptions(themeOptions.status === "fulfilled" ? themeOptions.value : DEFAULT_THEME_OPTIONS);
  state.themeStyleOptions = normalizeThemeStyleOptions(themeStyleOptions.status === "fulfilled" ? themeStyleOptions.value : DEFAULT_THEME_STYLE_OPTIONS);
  const languageItems = normalizeLanguageOptions(languageOptions.status === "fulfilled" ? languageOptions.value : DEFAULT_LANGUAGE_OPTIONS);
  state.languageOptions = languageItems.length ? languageItems : DEFAULT_LANGUAGE_OPTIONS.slice();
}

async function loadTranslationsForLanguage(languageCode) {
  const requested = String(languageCode || "en").trim().toLowerCase();
  state.resolvedLanguage = state.languageOptions.some((entry) => entry.code === requested) ? requested : "en";

  const [fallbackResult, selectedResult] = await Promise.allSettled([
    fetchJson("/i18n/en.json"),
    state.resolvedLanguage === "en" ? Promise.resolve({}) : fetchJson(`/i18n/${state.resolvedLanguage}.json`)
  ]);
  state.fallbackTranslations = fallbackResult.status === "fulfilled" ? fallbackResult.value : {};
  state.translations = selectedResult.status === "fulfilled" ? selectedResult.value : state.fallbackTranslations;
}

async function loadBranding() {
  try {
    const branding = await fetchJson("/branding.json");
    state.branding = branding && typeof branding === "object" ? branding : {};
  } catch (error) {
    state.branding = {};
  }
}

async function setTheme(value) {
  const picked = state.themeOptions.find((entry) => entry.value === value) || state.themeOptions[0];
  state.theme = picked?.value || "auto";
  applyTheme();
  await saveSettings({ theme: state.theme });
  await loadContainers();
}

async function setThemeStyle(value) {
  const picked = state.themeStyleOptions.find((entry) => entry.value === value) || state.themeStyleOptions[0];
  state.themeStyle = picked?.value || "modern";
  applyThemeStyle();
  await saveSettings({ theme_style: state.themeStyle });
  await loadContainers();
}

async function setFontSize(value) {
  const next = FONT_ITEMS.some((entry) => entry.value === value) ? value : "100";
  state.fontSize = next;
  await saveSettings({ font_size: next });
  applyFontSize();
}

async function setLanguage(value) {
  const picked = state.languageOptions.find((entry) => entry.code === value) || state.languageOptions[0];
  state.language = picked?.code || "en";
  await saveSettings({ language: state.language });
  await loadTranslationsForLanguage(state.language);
  applyLanguage();
  applyStaticTranslations();
  renderRows();
}

async function initAppearance() {
  try {
    await loadUiRegistries();
  } catch (error) {
    appendLog(t("uiRegistryLoadFailedUsingBuiltInFallbacks", { message: error.message }));
    state.themeOptions = DEFAULT_THEME_OPTIONS.slice();
    state.themeStyleOptions = DEFAULT_THEME_STYLE_OPTIONS.slice();
    state.languageOptions = DEFAULT_LANGUAGE_OPTIONS.slice();
  }

  try {
    await loadSettings();
  } catch (error) {
    appendLog(t("settingsLoadFailedUsingDefaults", { message: error.message }));
  }

  try {
    await loadBranding();
  } catch (error) {
    appendLog(t("settingsLoadFailedUsingDefaults", { message: error.message }));
  }

  try {
    await loadTranslationsForLanguage(state.language);
  } catch (error) {
    appendLog(t("translationLoadFailedFallingBackToEnglish", { message: error.message }));
    state.resolvedLanguage = "en";
    try {
      state.fallbackTranslations = await fetchJson("/i18n/en.json");
      state.translations = state.fallbackTranslations;
    } catch (fallbackError) {
      appendLog(t("englishFallbackLoadFailed", { message: fallbackError.message }));
    }
  }

  applyThemeStyle();
  applyTheme();
  applyFontSize();
  applyLanguage();
  applyStaticTranslations();
  if (!SHARED_HEADER_OWNS_CONTROLS) {
    renderLanguageMenu();
    renderThemeStyleMenu();
    renderThemeMenu();
    renderFontMenu();
  }
}

function nowLabel() {
  return new Date().toLocaleTimeString();
}

function formatActivityDetails(obj) {
  if (obj === undefined || obj === null || (typeof obj === "object" && Object.keys(obj).length === 0)) {
    return "";
  }
  if (typeof obj === "string") {
    return obj;
  }
  return JSON.stringify(obj, null, 2);
}

function summarizeActivityDetails(obj) {
  if (obj === undefined || obj === null) return "";
  if (typeof obj === "string") {
    const compact = obj.trim().replace(/\s+/g, " ");
    return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact;
  }
  if (typeof obj !== "object") {
    return String(obj);
  }

  const containerName = obj?.container?.name;
  const containerId = obj?.container?.id;
  const result = obj?.result;
  const mode = result?.mode || obj?.mode;
  const imageRef = result?.imageRef || obj?.imageRef;
  const imageTag = imageRef ? extractImageReference(imageRef) : "";
  const localImageId = result?.localImageId || obj?.localImageId;
  const remoteDigest = result?.remoteConfigDigest || obj?.remoteConfigDigest;
  const rollbackOptions = Array.isArray(result?.rollbackOptions)
    ? result.rollbackOptions.length
    : Array.isArray(obj?.rollbackOptions)
      ? obj.rollbackOptions.length
      : 0;

  const parts = [];
  if (containerName) {
    parts.push(containerId ? `${containerName} (${containerId})` : containerName);
  }
  if (imageTag) parts.push(imageTag);
  if (mode) parts.push(mode);
  if (rollbackOptions > 0) parts.push(`${rollbackOptions} rollback options`);
  if (typeof result?.upToDate === "boolean") {
    parts.push(result.upToDate ? "up to date" : "update available");
  }
  if (localImageId && remoteDigest) {
    parts.push(localImageId === remoteDigest ? "digest matched" : "digest changed");
  } else if (obj?.ok === true) {
    parts.push("ok");
  }

  if (parts.length > 0) {
    return parts.join(" • ");
  }

  const keys = Object.keys(obj);
  return keys.length > 0 ? `JSON payload (${keys.length} keys)` : "";
}

function appendLog(message, obj) {
  if (!els.logBox) return;
  const row = document.createElement("tr");
  const timeCell = document.createElement("td");
  const eventCell = document.createElement("td");
  const detailsCell = document.createElement("td");
  const detailsText = formatActivityDetails(obj);
  const detailsSummary = summarizeActivityDetails(obj);

  timeCell.className = "activity-time mono";
  eventCell.className = "activity-event";
  detailsCell.className = "activity-details";

  timeCell.textContent = nowLabel();
  eventCell.textContent = message;

  if (!detailsText) {
    const empty = document.createElement("span");
    empty.className = "activity-details-empty";
    empty.textContent = t("activityNoDetails");
    detailsCell.appendChild(empty);
  } else {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const pre = document.createElement("pre");

    details.className = "activity-details-toggle";
    summary.className = "activity-details-summary";
    pre.className = "activity-details-code mono";

    summary.textContent = detailsSummary || t("activityShowDetails");
    pre.textContent = detailsText;

    details.append(summary, pre);
    detailsCell.appendChild(details);
  }

  row.append(timeCell, eventCell, detailsCell);
  els.logBox.prepend(row);

  while (els.logBox.children.length > 60) {
    els.logBox.lastElementChild.remove();
  }
}

function isTransientFetchDrop(error) {
  return /failed to fetch/i.test(String(error?.message || ""));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setBusy(value) {
  state.busy = value;
  const disabled = Boolean(value);

  els.bulkButtons.forEach((btn) => {
    if (disabled) {
      btn.disabled = true;
      return;
    }

    const action = btn.dataset.bulkAction;
    const hasRollbackSelection = Object.values(state.rollbackTargetById).some(Boolean);
    if (action === "rollback" && !hasRollbackSelection) {
      btn.disabled = true;
      btn.title = t("noRollbackTargetSelected");
      return;
    }

    btn.disabled = false;
    btn.title = "";
  });

  els.containersBody.querySelectorAll("button").forEach((btn) => {
    const staticDisabled = btn.dataset.staticDisabled === "1";
    btn.disabled = disabled || staticDisabled;
  });
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json();
  if (!response.ok || data.ok === false) {
    const err = new Error(data.error || `HTTP ${response.status}`);
    err.details = data.details || null;
    throw err;
  }

  return data;
}

function selectedContainerIds() {
  const validIds = new Set(state.containers.map((container) => container.id));
  return Object.entries(state.selectedById)
    .filter(([id, isSelected]) => Boolean(isSelected) && validIds.has(id))
    .map(([id]) => id);
}

function updateSelectAllState() {
  const checks = Array.from(els.containersBody.querySelectorAll(".row-select"));
  if (checks.length === 0) {
    els.selectAll.checked = false;
    refreshBulkUpdateButton();
    return;
  }

  const checkedCount = checks.filter((input) => input.checked).length;
  els.selectAll.checked = checkedCount === checks.length;
  refreshBulkUpdateButton();
}

function extractImageReference(imageRef) {
  const raw = String(imageRef || "").trim();
  if (!raw) return "";
  const withoutDigest = raw.split("@")[0];
  const slashIndex = withoutDigest.lastIndexOf("/");
  const colonIndex = withoutDigest.lastIndexOf(":");
  if (colonIndex > slashIndex) {
    return withoutDigest.slice(colonIndex + 1).trim().toLowerCase();
  }
  return "latest";
}

function getContainerById(containerId) {
  return state.containers.find((entry) => entry.id === containerId);
}

function isChannelSwitchPending(container, selectedTargetImageRef) {
  const selectedRef = extractImageReference(selectedTargetImageRef);
  if (selectedRef !== "latest" && selectedRef !== "stable") {
    return false;
  }
  const currentRef = extractImageReference(container?.image || "");
  return Boolean(currentRef) && selectedRef !== currentRef;
}

function isContainerUpdateEligible(container) {
  if (!container) return false;
  if (container.isSelf) return false;
  const checkAvailable = state.checkById[container.id]?.state === "available";
  const selectedTarget = state.rollbackTargetById[container.id] || "";
  const channelSwitchPending = isChannelSwitchPending(container, selectedTarget);
  return checkAvailable || channelSwitchPending;
}

function availableUpdatesCount() {
  return state.containers.filter((container) => !container.isSelf && state.checkById[container.id]?.state === "available").length;
}

function refreshBulkUpdateButton() {
  if (!els.bulkUpdateButton) {
    return;
  }

  let iconEl = els.bulkUpdateIcon;
  let labelEl = els.bulkUpdateLabel;
  if (!iconEl || !labelEl) {
    const existingText = (els.bulkUpdateButton.textContent || "").trim() || t("updateAll");
    els.bulkUpdateButton.textContent = "";
    iconEl = document.createElement("span");
    iconEl.className = "bulk-update-icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = "↓";
    labelEl = document.createElement("span");
    labelEl.className = "bulk-update-label";
    labelEl.textContent = existingText;
    els.bulkUpdateButton.appendChild(iconEl);
    els.bulkUpdateButton.appendChild(labelEl);
    els.bulkUpdateIcon = iconEl;
    els.bulkUpdateLabel = labelEl;
  }

  const selectedIds = selectedContainerIds();
  const selectedCount = selectedIds.length;
  const selectedEligibleCount = selectedIds.filter((id) => {
    const container = state.containers.find((entry) => entry.id === id);
    return isContainerUpdateEligible(container);
  }).length;
  const checkedCount = Object.keys(state.checkById).length;
  const availableCount = availableUpdatesCount();
  els.bulkUpdateButton.classList.remove("is-pending", "is-ready", "is-empty", "is-selected");

  if (selectedCount > 0) {
    if (selectedEligibleCount > 0) {
      els.bulkUpdateButton.classList.add("is-selected");
      iconEl.textContent = "↑";
      labelEl.textContent = t("updateSelectedCount", { count: selectedCount });
    } else {
      els.bulkUpdateButton.classList.add("is-empty");
      iconEl.textContent = "↓";
      labelEl.textContent = t("updateSelectedCount", { count: selectedCount });
    }
    return;
  }

  if (checkedCount === 0) {
    els.bulkUpdateButton.classList.add("is-pending");
    iconEl.textContent = "↓";
    labelEl.textContent = t("updateAll");
    return;
  }

  if (availableCount > 0) {
    els.bulkUpdateButton.classList.add("is-ready");
    iconEl.textContent = "↑";
    labelEl.textContent = t("updateAllCount", { count: availableCount });
    return;
  }

  els.bulkUpdateButton.classList.add("is-empty");
  iconEl.textContent = "↓";
  labelEl.textContent = t("updateAllCount", { count: 0 });
}

function renderRows() {
  els.containersBody.innerHTML = "";

  state.containers.forEach((container) => {
    const fragment = els.rowTemplate.content.cloneNode(true);
    const tr = fragment.querySelector("tr");

    const rowSelect = fragment.querySelector(".row-select");
    rowSelect.dataset.id = container.id;
    rowSelect.checked = Boolean(state.selectedById[container.id]);
    rowSelect.addEventListener("change", () => {
      state.selectedById[container.id] = rowSelect.checked;
      updateSelectAllState();
    });

    fragment.querySelector('[data-col="name"]').textContent = container.name;
    fragment.querySelector('[data-col="id"]').textContent = container.id;
    fragment.querySelector('[data-col="status"]').textContent = translateContainerStatus(container.status);
    fragment.querySelector('[data-col="image"]').textContent = container.image || "-";

    const checkState = state.checkById[container.id] || { state: "unchecked", key: "unchecked" };
    const updatePill = fragment.querySelector('[data-col="updateState"]');
    updatePill.textContent = t(checkState.key || "unchecked");
    updatePill.classList.remove("available", "current", "unknown");
    if (checkState.state === "available") updatePill.classList.add("available");
    if (checkState.state === "current") updatePill.classList.add("current");
    if (checkState.state === "unknown" || checkState.state === "unchecked") {
      updatePill.classList.add("unknown");
    }

    const rollbackSelect = fragment.querySelector('[data-role="rollback-select"]');
    const rollbackOptions = Array.isArray(state.rollbackOptionsById[container.id])
      ? state.rollbackOptionsById[container.id]
      : [];
    const selectedTarget = state.rollbackTargetById[container.id] || "";
    rollbackSelect.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = rollbackOptions.length > 0
      ? t("selectRollbackVersion")
      : t("runCheckToLoadVersions");
    rollbackSelect.appendChild(defaultOption);
    rollbackOptions.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.imageRef;
      opt.textContent = option.label;
      rollbackSelect.appendChild(opt);
    });
    rollbackSelect.value = selectedTarget && rollbackOptions.some((entry) => entry.imageRef === selectedTarget)
      ? selectedTarget
      : "";
    rollbackSelect.disabled = rollbackOptions.length === 0 || Boolean(container.isSelf);
    rollbackSelect.title = t("rollbackTargetVersion");
    const rollbackButton = fragment.querySelector('[data-action="rollback"]');
    rollbackSelect.addEventListener("change", () => {
      state.rollbackTargetById[container.id] = rollbackSelect.value || "";
      const ready = Boolean(state.rollbackTargetById[container.id]);
      rollbackButton.dataset.staticDisabled = ready ? "0" : "1";
      rollbackButton.disabled = state.busy || !ready;
      rollbackButton.title = ready
        ? ""
        : t("chooseRollbackVersion");
      setBusy(state.busy);
    });

    fragment.querySelectorAll("[data-action]").forEach((btn) => {
      btn.dataset.staticDisabled = "0";
      btn.textContent = t(btn.dataset.action === "check" ? "check" : btn.dataset.action === "update" ? "update" : "rollback");

      if (btn.dataset.action === "update") {
        const updateLocked = Boolean(state.updateLockedById[container.id]);
        const selectedTarget = state.rollbackTargetById[container.id] || "";
        const channelSwitchPending = isChannelSwitchPending(container, selectedTarget);
        const allowUpdate = (checkState.state === "available" || channelSwitchPending) && !updateLocked;
        btn.classList.toggle("hidden", !allowUpdate);
        if (updateLocked) {
          btn.dataset.staticDisabled = "1";
          btn.title = t("updateAlreadySent");
        } else if (channelSwitchPending && checkState.state !== "available") {
          btn.title = t("applySelectedChannelSwitch");
        } else {
          btn.title = "";
        }
      }

      if (btn.dataset.action === "rollback") {
        if (container.isSelf) {
          btn.classList.add("hidden");
          btn.dataset.staticDisabled = "1";
          btn.title = t("selfRollbackDisabled");
          return;
        }
        const rollbackLocked = Boolean(state.rollbackLockedById[container.id]);
        btn.classList.toggle("hidden", rollbackLocked);
        if (rollbackLocked) {
          btn.dataset.staticDisabled = "1";
          btn.title = t("rollbackAlreadySent");
          return;
        }

        const rollbackReady = Boolean(state.rollbackTargetById[container.id]);
        btn.dataset.staticDisabled = rollbackReady ? "0" : "1";
        btn.title = rollbackReady
          ? ""
          : t("chooseRollbackVersion");
      }

      btn.addEventListener("click", () => runSingleAction(container.id, btn.dataset.action));
    });

    tr.dataset.id = container.id;
    els.containersBody.appendChild(fragment);
  });

  updateSelectAllState();
  refreshBulkUpdateButton();
}

function digestCheckToUiState(result) {
  if (!result || result.mode !== "digest-compare") {
    return { state: "unknown", key: "unknown" };
  }

  if (result.upToDate === false) {
    return { state: "available", key: "updateAvailable" };
  }

  if (result.upToDate === true) {
    return { state: "current", key: "upToDate" };
  }

  return { state: "unknown", key: "unknown" };
}

function applyCheckResult(containerId, result) {
  state.checkById[containerId] = digestCheckToUiState(result);
  const container = getContainerById(containerId);
  if (container?.isSelf) {
    state.selectedById[containerId] = false;
  } else {
    state.selectedById[containerId] = state.checkById[containerId].state === "available";
  }
  delete state.updateLockedById[containerId];
  delete state.rollbackLockedById[containerId];
  const options = Array.isArray(result?.rollbackOptions) ? result.rollbackOptions : [];
  state.rollbackOptionsById[containerId] = options;
  const currentRef = extractImageReference(container?.image || "");
  const preferredCurrent = options.find((option) => extractImageReference(option.imageRef) === currentRef);

  if (!options.some((option) => option.imageRef === state.rollbackTargetById[containerId])) {
    if ((currentRef === "stable" || currentRef === "latest") && preferredCurrent) {
      state.rollbackTargetById[containerId] = preferredCurrent.imageRef;
    } else {
      state.rollbackTargetById[containerId] = options[0]?.imageRef || "";
    }
  }
}

function setConnection(ok, key, params = {}) {
  state.connection = {
    ok,
    key,
    params
  };
  els.connectionBadge.classList.remove("ok", "error");
  if (ok === null || ok === undefined) {
    // Keep the neutral state while the app is still booting.
  } else if (ok) {
    els.connectionBadge.classList.add("ok");
  } else {
    els.connectionBadge.classList.add("error");
  }
  els.connectionBadge.textContent = t(key, params);
}

async function loadContainers() {
  setBusy(true);
  try {
    const [health, data] = await Promise.all([
      apiRequest("/api/health"),
      apiRequest("/api/containers")
    ]);

    setConnection(true, "connectedToRouterOS");
    state.containers = data.containers || [];
    const validIds = new Set(state.containers.map((container) => container.id));
    Object.keys(state.rollbackOptionsById).forEach((id) => {
      if (!validIds.has(id)) delete state.rollbackOptionsById[id];
    });
    Object.keys(state.rollbackTargetById).forEach((id) => {
      if (!validIds.has(id)) delete state.rollbackTargetById[id];
    });
    Object.keys(state.updateLockedById).forEach((id) => {
      if (!validIds.has(id)) delete state.updateLockedById[id];
    });
    Object.keys(state.rollbackLockedById).forEach((id) => {
      if (!validIds.has(id)) delete state.rollbackLockedById[id];
    });
    Object.keys(state.selectedById).forEach((id) => {
      if (!validIds.has(id)) delete state.selectedById[id];
    });
    renderRows();
    els.countLabel.textContent = t("containersCount", { count: health.containerCount });
    appendLog(t("loadedContainers", { count: health.containerCount }));
  } catch (error) {
    setConnection(false, "connectionFailed");
    appendLog(t("loadFailed", { message: error.message }), error.details || {});
  } finally {
    setBusy(false);
  }
}

async function runSingleAction(id, action) {
  setBusy(true);
  try {
    if (action === "update") {
      state.updateLockedById[id] = true;
      renderRows();
    }
    if (action === "rollback") {
      state.rollbackLockedById[id] = true;
      renderRows();
    }

    appendLog(t("runningAction", { action: t(`action${action[0].toUpperCase()}${action.slice(1)}`), id }));
    const body = {};
    if (action === "update") {
      const container = state.containers.find((entry) => entry.id === id);
      const selectedTarget = state.rollbackTargetById[id] || "";
      if (isChannelSwitchPending(container, selectedTarget)) {
        body.targetImageRef = selectedTarget;
      }
    }
    if (action === "rollback") {
      body.targetImageRef = state.rollbackTargetById[id] || "";
    }
    const result = await apiRequest(`/api/containers/${encodeURIComponent(id)}/actions/${action}`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    appendLog(
      t("actionCompleted", { action: t(`action${action[0].toUpperCase()}${action.slice(1)}`), name: result.container.name }),
      result.warning ? { ...result.result, warning: result.warning } : result.result
    );

    if (action === "check") {
      applyCheckResult(id, result.result);
      renderRows();
    } else {
      state.checkById = {};
      await loadContainers();
    }
  } catch (error) {
    if (action === "update" && isTransientFetchDrop(error)) {
      appendLog(t("updateConnectionDropped", { id }));
      await sleep(2200);
      state.checkById = {};
      await loadContainers();
    } else {
      appendLog(t("actionFailed", { action: t(`action${action[0].toUpperCase()}${action.slice(1)}`), id, message: error.message }), error.details || {});
    }
  } finally {
    setBusy(false);
  }
}

async function runBulkAction(action) {
  const selectedIds = selectedContainerIds();
  let ids = selectedIds;

  if (action === "update" && selectedIds.length === 0) {
    ids = state.containers
      .filter((container) => isContainerUpdateEligible(container) && !state.updateLockedById[container.id])
      .map((container) => container.id);
  }

  if (action === "update" && selectedIds.length > 0) {
    ids = selectedIds.filter((id) => {
      const container = state.containers.find((entry) => entry.id === id);
      return isContainerUpdateEligible(container) && !state.updateLockedById[id];
    });
  }

  if (action === "update" && ids.length === 0) {
    appendLog(t("noEligibleUpdates"));
    return;
  }

  if (action === "rollback") {
    const source = selectedIds.length > 0 ? selectedIds : state.containers.map((container) => container.id);
    ids = source.filter((containerId) => Boolean(state.rollbackTargetById[containerId]));
    if (ids.length === 0) {
      appendLog(t("noRollbackTargets"));
      return;
    }
  }

  const scopeLabel = ids.length ? t("selectedContainersScope", { count: ids.length }) : t("allContainers");

  setBusy(true);
  try {
    if (action === "update") {
      ids.forEach((containerId) => {
        state.updateLockedById[containerId] = true;
      });
      renderRows();
    }
    if (action === "rollback") {
      ids.forEach((containerId) => {
        state.rollbackLockedById[containerId] = true;
      });
      renderRows();
    }

    appendLog(t("runningBulkAction", { action: t(`action${action[0].toUpperCase()}${action.slice(1)}`), scope: scopeLabel }));
    const rollbackTargets = {};
    const updateTargets = {};
    if (action === "update") {
      ids.forEach((containerId) => {
        const container = state.containers.find((entry) => entry.id === containerId);
        const selectedTarget = state.rollbackTargetById[containerId] || "";
        if (isChannelSwitchPending(container, selectedTarget)) {
          updateTargets[containerId] = selectedTarget;
        }
      });
    }
    if (action === "rollback") {
      ids.forEach((containerId) => {
        rollbackTargets[containerId] = state.rollbackTargetById[containerId];
      });
    }
    const result = await apiRequest(`/api/containers/actions/${action}`, {
      method: "POST",
      body: JSON.stringify({ containerIds: ids, rollbackTargets, updateTargets })
    });

    appendLog(
      t("bulkFinished", { action: t(`action${action[0].toUpperCase()}${action.slice(1)}`), successCount: result.successCount, failedCount: result.failedCount }),
      result.results
    );

    if (action === "check") {
      result.results.forEach((entry) => {
        if (entry?.container?.id) {
          applyCheckResult(entry.container.id, entry.result);
        }
      });
      renderRows();
    } else {
      state.checkById = {};
      await loadContainers();
    }
  } catch (error) {
    if (action === "update" && isTransientFetchDrop(error)) {
      appendLog(t("bulkUpdateConnectionDropped"));
      await sleep(2200);
      state.checkById = {};
      await loadContainers();
    } else {
      appendLog(t("bulkFailed", { action: t(`action${action[0].toUpperCase()}${action.slice(1)}`), message: error.message }), error.details || {});
    }
  } finally {
    setBusy(false);
  }
}

if (!SHARED_HEADER_OWNS_CONTROLS) {
  els.themeToggle.addEventListener("click", () => {
    toggleDropdownMenu(els.themeMenu, els.themeToggle, [closeThemeStyleMenu, closeLanguageMenu]);
  });

  els.themeStyleToggle.addEventListener("click", () => {
    toggleDropdownMenu(els.themeStyleMenu, els.themeStyleToggle, [closeThemeMenu, closeLanguageMenu]);
  });

  els.fontToggle.addEventListener("click", () => {
    toggleFontMenu();
  });

  els.languageToggle.addEventListener("click", () => {
    toggleDropdownMenu(els.languageMenu, els.languageToggle, [closeThemeMenu, closeThemeStyleMenu]);
  });

  document.addEventListener("click", (event) => {
    if (!els.themeDropdown.contains(event.target)) {
      closeThemeMenu();
    }
    if (!els.themeStyleDropdown.contains(event.target)) {
      closeThemeStyleMenu();
    }
    if (!els.fontDropdown.contains(event.target)) {
      closeFontMenu();
    }
    if (!els.languageDropdown.contains(event.target)) {
      closeLanguageMenu();
    }
  });
}

window.addEventListener("mikrotik:header-setting-changed", async (event) => {
  const detail = event?.detail || {};
  if (detail.key === "theme") {
    state.theme = detail.value || state.theme;
    applyTheme();
    await loadContainers();
  } else if (detail.key === "themeStyle") {
    state.themeStyle = detail.value || state.themeStyle;
    applyThemeStyle();
    await loadContainers();
  } else if (detail.key === "fontSize") {
    state.fontSize = detail.value || state.fontSize;
    applyFontSize();
  } else if (detail.key === "language") {
    state.language = detail.value || state.language;
    await loadTranslationsForLanguage(state.language);
    applyLanguage();
    applyStaticTranslations();
    renderRows();
  }
});

els.selectAll.addEventListener("change", (event) => {
  const checked = event.target.checked;
  els.containersBody.querySelectorAll(".row-select").forEach((input) => {
    input.checked = checked;
    state.selectedById[input.dataset.id] = checked;
  });
  updateSelectAllState();
});

els.bulkButtons.forEach((btn) => {
  btn.addEventListener("click", () => runBulkAction(btn.dataset.bulkAction));
});

if (prefersDarkQuery) {
  const onThemePrefChange = () => {
    if (state.theme === "auto") {
      applyTheme();
    }
  };
  if (prefersDarkQuery.addEventListener) {
    prefersDarkQuery.addEventListener("change", onThemePrefChange);
  } else if (prefersDarkQuery.addListener) {
    prefersDarkQuery.addListener(onThemePrefChange);
  }
}

async function start() {
  if (window.MikroTikSharedHeader && typeof window.MikroTikSharedHeader.whenReady === "function") {
    try {
      await window.MikroTikSharedHeader.whenReady();
      const sharedState = window.MikroTikSharedHeader.getState ? window.MikroTikSharedHeader.getState() : null;
      if (sharedState) {
        if (sharedState.theme) state.theme = sharedState.theme;
        if (sharedState.themeStyle) state.themeStyle = sharedState.themeStyle;
        if (sharedState.fontSize) state.fontSize = sharedState.fontSize;
        if (sharedState.language) state.language = sharedState.language;
      }
      refreshHeaderElements();
    } catch (_) {}
  }
  await initAppearance();
  await loadContainers();
}

start();
