const state = {
  containers: [],
  busy: false,
  checkById: {},
  selectedById: {},
  updateLockedById: {},
  rollbackLockedById: {},
  rollbackOptionsById: {},
  rollbackTargetById: {},
  theme: "auto",
  themeStyle: "modern",
  fontSize: "50",
  lang: "en"
};

const els = {
  themeStyleCss: document.getElementById("themeStyleCss"),
  themeToggle: document.getElementById("themeToggle"),
  themeMenu: document.getElementById("themeMenu"),
  themeCurrentIcon: document.getElementById("themeCurrentIcon"),
  themeCurrentLabel: document.getElementById("themeCurrentLabel"),
  themeSelect: document.getElementById("themeSelect"),
  themeDropdown: document.getElementById("themeDropdown"),
  themeStyleToggle: document.getElementById("themeStyleToggle"),
  themeStyleMenu: document.getElementById("themeStyleMenu"),
  themeStyleCurrentLabel: document.getElementById("themeStyleCurrentLabel"),
  themeStyleSelect: document.getElementById("themeStyleSelect"),
  themeStyleDropdown: document.getElementById("themeStyleDropdown"),
  fontToggle: document.getElementById("fontToggle"),
  fontMenu: document.getElementById("fontMenu"),
  fontCurrentLabel: document.getElementById("fontCurrentLabel"),
  fontSizeSelect: document.getElementById("fontSizeSelect"),
  fontDropdown: document.getElementById("fontDropdown"),
  langToggle: document.getElementById("langToggle"),
  langMenu: document.getElementById("langMenu"),
  langCurrentIcon: document.getElementById("langCurrentIcon"),
  langCurrentLabel: document.getElementById("langCurrentLabel"),
  langSelect: document.getElementById("langSelect"),
  langDropdown: document.getElementById("langDropdown"),
  selectAll: document.getElementById("selectAll"),
  containersBody: document.getElementById("containersBody"),
  rowTemplate: document.getElementById("rowTemplate"),
  logBox: document.getElementById("logBox"),
  connectionBadge: document.getElementById("connectionBadge"),
  countLabel: document.getElementById("countLabel"),
  bulkButtons: Array.from(document.querySelectorAll("[data-bulk-action]")),
  bulkUpdateButton: document.querySelector('[data-bulk-action="update"]'),
  bulkUpdateIcon: document.querySelector('[data-bulk-action="update"] .bulk-update-icon'),
  bulkUpdateLabel: document.querySelector('[data-bulk-action="update"] .bulk-update-label')
};

const THEME_ITEMS = [
  { value: "auto", labelKey: "auto", icon: "/images/ui/theme-auto.svg" },
  { value: "light", labelKey: "light", icon: "/images/ui/theme-light.svg" },
  { value: "dark", labelKey: "dark", icon: "/images/ui/theme-dark.svg" }
];

let THEME_STYLE_ITEMS = [
  { value: "modern", labelKey: "modern" },
  { value: "classic", labelKey: "classic" }
];
const LANG_ITEMS = [
  { value: "en", label: "EN", icon: "/images/lang/en.svg" },
  { value: "ro", label: "RO", icon: "/images/lang/ro.svg" }
];
const FONT_SIZE_ITEMS = [
  { value: "25", labelKey: "fontLegacy" },
  { value: "50", labelKey: "fontCurrent" },
  { value: "100", labelKey: "fontLarge" }
];
const I18N = {
  en: {
    auto: "Auto", light: "Light", dark: "Dark", modern: "Modern", classic: "Classic",
    subtitle: "Auto-discovers all containers from RouterOS REST API",
    theme: "Theme", mode: "Style", language: "Language",
    fontSize: "Font size", fontLegacy: "Compact", fontCurrent: "Standard", fontLarge: "Large",
    checkAll: "Check selected/all", updateAll: "Update all",
    name: "Name", id: "ID", status: "Status", update: "Update", image: "Image", actions: "Actions",
    activity: "Activity", checking: "Checking connection..."
  },
  ro: {
    auto: "Auto", light: "Luminos", dark: "Întunecat", modern: "Modern", classic: "Clasic",
    subtitle: "Descoperă automat toate containerele prin RouterOS REST API",
    theme: "Temă", mode: "Stil", language: "Limbă",
    fontSize: "Mărime font", fontLegacy: "Compact", fontCurrent: "Standard", fontLarge: "Mare",
    checkAll: "Verifică selectate/toate", updateAll: "Actualizează tot",
    name: "Nume", id: "ID", status: "Status", update: "Update", image: "Imagine", actions: "Acțiuni",
    activity: "Activitate", checking: "Verific conexiunea..."
  }
};
const prefersDarkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function t(key) {
  return (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
}

function getThemeStyleLabel(item) {
  const labels = item && item.label;
  if (labels && typeof labels === "object") {
    if (state.lang === "ro" && labels.ro) return String(labels.ro);
    if (labels.en) return String(labels.en);
  }
  return t(item && item.labelKey ? item.labelKey : "modern");
}

function closeThemeMenu() {
  els.themeMenu.classList.remove("open");
  els.themeToggle.setAttribute("aria-expanded", "false");
}

function closeThemeStyleMenu() {
  els.themeStyleMenu.classList.remove("open");
  els.themeStyleToggle.setAttribute("aria-expanded", "false");
}

function closeLanguageMenu() {
  els.langMenu.classList.remove("open");
  els.langToggle.setAttribute("aria-expanded", "false");
}

function closeFontMenu() {
  els.fontMenu.classList.remove("open");
  els.fontToggle.setAttribute("aria-expanded", "false");
}

function updateThemeButton() {
  const picked = THEME_ITEMS.find((item) => item.value === state.theme) || THEME_ITEMS[0];
  els.themeCurrentIcon.setAttribute("src", picked.icon);
  els.themeCurrentLabel.textContent = t(picked.labelKey);
}

function updateThemeStyleButton() {
  const picked = THEME_STYLE_ITEMS.find((item) => item.value === state.themeStyle) || THEME_STYLE_ITEMS[0];
  els.themeStyleCurrentLabel.textContent = getThemeStyleLabel(picked);
}

function updateLanguageButton() {
  const picked = LANG_ITEMS.find((item) => item.value === state.lang) || LANG_ITEMS[0];
  els.langCurrentIcon.setAttribute("src", picked.icon);
  els.langCurrentLabel.textContent = picked.label;
  els.langSelect.value = picked.value;
}

function updateFontButton() {
  const picked = FONT_SIZE_ITEMS.find((item) => item.value === state.fontSize) || FONT_SIZE_ITEMS[1];
  els.fontCurrentLabel.textContent = t(picked.labelKey);
  els.fontSizeSelect.value = picked.value;
}

function applyLanguage() {
  document.documentElement.lang = state.lang;
  document.getElementById("subtitle").textContent = t("subtitle");
  document.getElementById("themeStyleLabel").textContent = t("theme");
  document.getElementById("themeLabel").textContent = t("mode");
  document.getElementById("fontLabel").textContent = t("fontSize");
  document.getElementById("langLabel").textContent = t("language");
  document.getElementById("bulkCheckLabel").textContent = t("checkAll");
  document.getElementById("bulkUpdateLabel").textContent = t("updateAll");
  document.getElementById("thName").textContent = t("name");
  document.getElementById("thId").textContent = t("id");
  document.getElementById("thStatus").textContent = t("status");
  document.getElementById("thUpdate").textContent = t("update");
  document.getElementById("thImage").textContent = t("image");
  document.getElementById("thActions").textContent = t("actions");
  document.getElementById("activityTitle").textContent = t("activity");
  if (!state.containers.length) {
    els.connectionBadge.textContent = t("checking");
  }
  updateThemeButton();
  updateThemeStyleButton();
  updateFontButton();
  updateLanguageButton();
}

function applyTheme() {
  const resolvedTheme = state.theme === "auto"
    ? (prefersDarkQuery && prefersDarkQuery.matches ? "dark" : "light")
    : state.theme;
  document.documentElement.setAttribute("data-theme", resolvedTheme);
  els.themeSelect.value = state.theme;
  updateThemeButton();
}

function applyThemeStyle() {
  document.documentElement.setAttribute("data-theme-style", state.themeStyle);
  const picked = THEME_STYLE_ITEMS.find((item) => item.value === state.themeStyle) || THEME_STYLE_ITEMS[0];
  const cssFile = (picked && picked.css) ? String(picked.css) : (state.themeStyle === "classic" ? "style-classic.css" : "style-modern.css");
  els.themeStyleCss.setAttribute(
    "href",
    "/" + cssFile.replace(/^\/+/, "")
  );
  els.themeStyleSelect.value = state.themeStyle;
  updateThemeStyleButton();
}

function applyFontSize() {
  const picked = FONT_SIZE_ITEMS.find((item) => item.value === state.fontSize) || FONT_SIZE_ITEMS[1];
  document.documentElement.setAttribute("data-font-size", picked.value);
  updateFontButton();
}

async function setTheme(value) {
  state.theme = ["auto", "light", "dark"].includes(value) ? value : "auto";
  applyTheme();
  await saveSettings({ theme: state.theme });
  await loadContainers();
}

async function setThemeStyle(value) {
  const allowed = THEME_STYLE_ITEMS.map((x) => x.value);
  state.themeStyle = allowed.includes(value) ? value : (THEME_STYLE_ITEMS[0] ? THEME_STYLE_ITEMS[0].value : "modern");
  applyThemeStyle();
  await saveSettings({ theme_style: state.themeStyle });
  await loadContainers();
}

function renderThemeMenu() {
  els.themeMenu.innerHTML = "";
  THEME_ITEMS.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-item";
    button.setAttribute("role", "option");
    button.innerHTML = `<img src="${item.icon}" alt="" /><span>${t(item.labelKey)}</span>`;
    button.addEventListener("click", async () => {
      closeThemeMenu();
      try {
        await setTheme(item.value);
      } catch (error) {
        appendLog(`Theme save failed: ${error.message}`);
      }
    });
    els.themeMenu.appendChild(button);
  });
  updateThemeButton();
}

function renderThemeStyleMenu() {
  els.themeStyleMenu.innerHTML = "";
  THEME_STYLE_ITEMS.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-item";
    button.setAttribute("role", "option");
    button.innerHTML = `<img src="/images/ui/theme-style.svg" alt="" /><span>${getThemeStyleLabel(item)}</span>`;
    button.addEventListener("click", async () => {
      closeThemeStyleMenu();
      try {
        await setThemeStyle(item.value);
      } catch (error) {
        appendLog(`Theme style save failed: ${error.message}`);
      }
    });
    els.themeStyleMenu.appendChild(button);
  });
  updateThemeStyleButton();
}

function renderLanguageMenu() {
  els.langMenu.innerHTML = "";
  LANG_ITEMS.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lang-item";
    button.setAttribute("role", "option");
    button.innerHTML = `<img src="${item.icon}" alt="" /><span>${item.label}</span>`;
    button.addEventListener("click", async () => {
      closeLanguageMenu();
      try {
        await setLanguage(item.value);
      } catch (error) {
        appendLog(`Language save failed: ${error.message}`);
      }
    });
    els.langMenu.appendChild(button);
  });
  updateLanguageButton();
}

function renderFontMenu() {
  els.fontMenu.innerHTML = "";
  FONT_SIZE_ITEMS.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-item";
    button.setAttribute("role", "option");
    button.innerHTML = `<img src="/images/ui/font-size.svg" alt="" /><span>${t(item.labelKey)}</span>`;
    button.addEventListener("click", async () => {
      closeFontMenu();
      try {
        await setFontSize(item.value);
      } catch (error) {
        appendLog(`Font size save failed: ${error.message}`);
      }
    });
    els.fontMenu.appendChild(button);
  });
  updateFontButton();
}

async function loadSettings() {
  const result = await apiRequest("/api/settings.json");
  const incoming = result?.settings || {};
  state.theme = ["auto", "light", "dark"].includes(incoming.theme) ? incoming.theme : "auto";
  const rawThemeStyle = incoming.theme_style || incoming.themeStyle;
  const allowed = THEME_STYLE_ITEMS.map((x) => x.value);
  state.themeStyle = allowed.includes(rawThemeStyle) ? rawThemeStyle : (THEME_STYLE_ITEMS[0] ? THEME_STYLE_ITEMS[0].value : "modern");
  state.fontSize = ["25", "50", "100"].includes(String(incoming.font_size || "")) ? String(incoming.font_size) : state.fontSize;
  state.lang = incoming.language === "ro" ? "ro" : "en";
}

function normalizeThemeStyleConfig(items) {
  if (!Array.isArray(items)) return null;
  const out = [];
  items.forEach((x) => {
    if (!x || typeof x !== "object") return;
    const value = String(x.value || "").trim().toLowerCase();
    const css = String(x.css || "").trim();
    if (!value || !css) return;
    const label = (x.label && typeof x.label === "object") ? x.label : null;
    out.push({ value, css, label, labelKey: x.labelKey || value });
  });
  return out.length ? out : null;
}

async function loadThemeStylesConfig() {
  const q = `?_=${Date.now()}`;
  try {
    const cfg = await fetch("/i18n/theme-styles.json" + q).then((r) => r.json());
    const parsed = normalizeThemeStyleConfig(cfg);
    if (parsed) THEME_STYLE_ITEMS = parsed;
  } catch (_) {}
}

async function saveSettings(patch) {
  await apiRequest("/api/settings", {
    method: "POST",
    body: JSON.stringify(patch || {})
  });
}

async function initAppearance() {
  try {
    await loadSettings();
  } catch (error) {
    appendLog(`Settings load failed, using defaults: ${error.message}`);
  }
  applyThemeStyle();
  applyTheme();
  applyFontSize();
  applyLanguage();
  renderThemeStyleMenu();
  renderThemeMenu();
  renderFontMenu();
  renderLanguageMenu();
}

function applyHeaderControlsConfig(cfg) {
  const controlsRoot = document.querySelector(".controls");
  if (!controlsRoot || !cfg || typeof cfg !== "object") return;
  const controls = new Map();
  controlsRoot.querySelectorAll("[data-header-control]").forEach((el) => {
    controls.set(el.getAttribute("data-header-control"), el);
  });

  const visible = (cfg.visible && typeof cfg.visible === "object") ? cfg.visible : {};
  controls.forEach((el, key) => {
    if (Object.prototype.hasOwnProperty.call(visible, key) && visible[key] === false) {
      el.style.display = "none";
    } else {
      el.style.display = "";
    }
  });

  if (Array.isArray(cfg.order)) {
    cfg.order.forEach((key) => {
      const el = controls.get(String(key));
      if (el) controlsRoot.appendChild(el);
    });
  }
}

async function loadHeaderControlsConfig() {
  const q = `?_=${Date.now()}`;
  try {
    const cfg = await fetch("/i18n/header-controls.json" + q).then((r) => r.json());
    applyHeaderControlsConfig(cfg);
  } catch (_) {}
}

async function setLanguage(value) {
  state.lang = value === "ro" ? "ro" : "en";
  applyLanguage();
  renderThemeStyleMenu();
  renderThemeMenu();
  renderFontMenu();
  renderLanguageMenu();
  renderRows();
  refreshBulkUpdateButton();
  await saveSettings({ language: state.lang });
}

async function setFontSize(value) {
  state.fontSize = ["25", "50", "100"].includes(String(value)) ? String(value) : "50";
  applyFontSize();
  try {
    await saveSettings({ font_size: state.fontSize });
  } catch (_) {}
  try {
    localStorage.setItem("mcug_font_size", state.fontSize);
  } catch (_) {}
}

function nowLabel() {
  return new Date().toLocaleTimeString();
}

function appendLog(message, obj) {
  const line = `[${nowLabel()}] ${message}`;
  if (obj === undefined) {
    els.logBox.textContent = `${line}\n${els.logBox.textContent}`;
  } else {
    els.logBox.textContent = `${line}\n${JSON.stringify(obj, null, 2)}\n\n${els.logBox.textContent}`;
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
      btn.title = "No rollback target selected. Run check and choose a rollback version.";
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
      labelEl.textContent = `${state.lang === "ro" ? "Actualizeaza selectate" : "Update selected"} (${selectedCount})`;
    } else {
      els.bulkUpdateButton.classList.add("is-empty");
      iconEl.textContent = "↓";
      labelEl.textContent = `${state.lang === "ro" ? "Actualizeaza selectate" : "Update selected"} (${selectedCount})`;
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
    labelEl.textContent = `${t("updateAll")} (${availableCount})`;
    return;
  }

  els.bulkUpdateButton.classList.add("is-empty");
  iconEl.textContent = "↓";
  labelEl.textContent = `${t("updateAll")} (0)`;
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
    fragment.querySelector('[data-col="status"]').textContent = container.status;
    fragment.querySelector('[data-col="image"]').textContent = container.image || "-";

    const checkState = state.checkById[container.id] || { state: "unchecked", text: "unchecked" };
    const updatePill = fragment.querySelector('[data-col="updateState"]');
    updatePill.textContent = checkState.text;
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
      ? (state.lang === "ro" ? "Selecteaza versiunea rollback" : "Select rollback version")
      : (state.lang === "ro" ? "Ruleaza check pentru versiuni" : "Run check to load versions");
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
    const rollbackButton = fragment.querySelector('[data-action="rollback"]');
    rollbackSelect.addEventListener("change", () => {
      state.rollbackTargetById[container.id] = rollbackSelect.value || "";
      const ready = Boolean(state.rollbackTargetById[container.id]);
      rollbackButton.dataset.staticDisabled = ready ? "0" : "1";
      rollbackButton.disabled = state.busy || !ready;
      rollbackButton.title = ready
        ? ""
        : "Choose rollback version from dropdown (run check first).";
      setBusy(state.busy);
    });

    fragment.querySelectorAll("[data-action]").forEach((btn) => {
      if (btn.dataset.action === "check") btn.textContent = state.lang === "ro" ? "Verifica" : "Check";
      if (btn.dataset.action === "update") btn.textContent = state.lang === "ro" ? "Actualizeaza" : "Update";
      if (btn.dataset.action === "rollback") btn.textContent = "Rollback";
      btn.dataset.staticDisabled = "0";

      if (btn.dataset.action === "update") {
        const updateLocked = Boolean(state.updateLockedById[container.id]);
        const selectedTarget = state.rollbackTargetById[container.id] || "";
        const channelSwitchPending = isChannelSwitchPending(container, selectedTarget);
        const allowUpdate = (checkState.state === "available" || channelSwitchPending) && !updateLocked;
        btn.classList.toggle("hidden", !allowUpdate);
        if (updateLocked) {
          btn.dataset.staticDisabled = "1";
          btn.title = "Update already sent once. Run check again before retrying.";
        } else if (channelSwitchPending && checkState.state !== "available") {
          btn.title = "Apply selected channel switch.";
        } else {
          btn.title = "";
        }
      }

      if (btn.dataset.action === "rollback") {
        if (container.isSelf) {
          btn.classList.add("hidden");
          btn.dataset.staticDisabled = "1";
          btn.title = "Self rollback is disabled in UI.";
          return;
        }
        const rollbackLocked = Boolean(state.rollbackLockedById[container.id]);
        btn.classList.toggle("hidden", rollbackLocked);
        if (rollbackLocked) {
          btn.dataset.staticDisabled = "1";
          btn.title = "Rollback already sent once. Run check again before retrying.";
          return;
        }

        const rollbackReady = Boolean(state.rollbackTargetById[container.id]);
        btn.dataset.staticDisabled = rollbackReady ? "0" : "1";
        btn.title = rollbackReady
          ? ""
          : "Choose rollback version from dropdown (run check first).";
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
    return { state: "unknown", text: "unknown" };
  }

  if (result.upToDate === false) {
    return { state: "available", text: "update available" };
  }

  if (result.upToDate === true) {
    return { state: "current", text: "up to date" };
  }

  return { state: "unknown", text: "unknown" };
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

function setConnection(ok, text) {
  els.connectionBadge.classList.remove("ok", "error");
  if (ok) {
    els.connectionBadge.classList.add("ok");
  } else {
    els.connectionBadge.classList.add("error");
  }
  els.connectionBadge.textContent = text;
}

async function loadContainers() {
  setBusy(true);
  try {
    const [health, data] = await Promise.all([
      apiRequest("/api/health"),
      apiRequest("/api/containers")
    ]);

    setConnection(true, "Connected to RouterOS");
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
    els.countLabel.textContent = `Containers: ${health.containerCount}`;
    appendLog(`Loaded ${health.containerCount} containers`);
  } catch (error) {
    setConnection(false, "Connection failed");
    appendLog(`Load failed: ${error.message}`, error.details || {});
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

    appendLog(`Running '${action}' on container ${id}`);
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
      `Action '${action}' completed for ${result.container.name}`,
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
      appendLog(`Action '${action}' on ${id}: connection dropped during update, refreshing status...`);
      await sleep(2200);
      state.checkById = {};
      await loadContainers();
    } else {
      appendLog(`Action '${action}' failed on ${id}: ${error.message}`, error.details || {});
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
    appendLog("No eligible updates in current selection. Run check first or choose a channel switch.");
    return;
  }

  if (action === "rollback") {
    const source = selectedIds.length > 0 ? selectedIds : state.containers.map((container) => container.id);
    ids = source.filter((containerId) => Boolean(state.rollbackTargetById[containerId]));
    if (ids.length === 0) {
      appendLog("No rollback targets selected. Run check first and pick versions from dropdown.");
      return;
    }
  }

  const scopeLabel = ids.length ? `${ids.length} selected containers` : "all containers";

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

    appendLog(`Running bulk '${action}' on ${scopeLabel}`);
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
      `Bulk '${action}' finished: ${result.successCount} ok, ${result.failedCount} failed`,
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
      appendLog("Bulk 'update': connection dropped during update, refreshing status...");
      await sleep(2200);
      state.checkById = {};
      await loadContainers();
    } else {
      appendLog(`Bulk '${action}' failed: ${error.message}`, error.details || {});
    }
  } finally {
    setBusy(false);
  }
}

els.themeToggle.addEventListener("click", () => {
  const open = els.themeMenu.classList.toggle("open");
  els.themeToggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    closeThemeStyleMenu();
    closeFontMenu();
    closeLanguageMenu();
  }
});

els.themeStyleToggle.addEventListener("click", () => {
  const open = els.themeStyleMenu.classList.toggle("open");
  els.themeStyleToggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    closeThemeMenu();
    closeFontMenu();
    closeLanguageMenu();
  }
});

els.fontToggle.addEventListener("click", () => {
  const open = els.fontMenu.classList.toggle("open");
  els.fontToggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    closeThemeMenu();
    closeThemeStyleMenu();
    closeLanguageMenu();
  }
});

els.langToggle.addEventListener("click", () => {
  const open = els.langMenu.classList.toggle("open");
  els.langToggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    closeThemeMenu();
    closeThemeStyleMenu();
    closeFontMenu();
  }
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
  if (!els.langDropdown.contains(event.target)) {
    closeLanguageMenu();
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
  try {
    const localFont = localStorage.getItem("mcug_font_size");
    if (["25", "50", "100"].includes(String(localFont))) state.fontSize = String(localFont);
  } catch (_) {}
  await loadThemeStylesConfig();
  await loadHeaderControlsConfig();
  await initAppearance();
  await loadContainers();
}

start();
