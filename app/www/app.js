const state = {
  containers: [],
  busy: false,
  checkById: {},
  theme: "light",
  themeStyle: "modern"
};

const els = {
  refreshBtn: document.getElementById("refreshBtn"),
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
  selectAll: document.getElementById("selectAll"),
  containersBody: document.getElementById("containersBody"),
  rowTemplate: document.getElementById("rowTemplate"),
  logBox: document.getElementById("logBox"),
  connectionBadge: document.getElementById("connectionBadge"),
  countLabel: document.getElementById("countLabel"),
  bulkButtons: Array.from(document.querySelectorAll("[data-bulk-action]"))
};

const THEME_ITEMS = [
  { value: "light", label: "Light", icon: "/images/ui/theme-light.svg" },
  { value: "dark", label: "Dark", icon: "/images/ui/theme-dark.svg" }
];

const THEME_STYLE_ITEMS = [
  { value: "modern", label: "Modern" },
  { value: "classic", label: "Classic" }
];

function closeThemeMenu() {
  els.themeMenu.classList.remove("open");
  els.themeToggle.setAttribute("aria-expanded", "false");
}

function closeThemeStyleMenu() {
  els.themeStyleMenu.classList.remove("open");
  els.themeStyleToggle.setAttribute("aria-expanded", "false");
}

function updateThemeButton() {
  const picked = THEME_ITEMS.find((item) => item.value === state.theme) || THEME_ITEMS[0];
  els.themeCurrentIcon.setAttribute("src", picked.icon);
  els.themeCurrentLabel.textContent = picked.label;
}

function updateThemeStyleButton() {
  const picked = THEME_STYLE_ITEMS.find((item) => item.value === state.themeStyle) || THEME_STYLE_ITEMS[0];
  els.themeStyleCurrentLabel.textContent = picked.label;
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  els.themeSelect.value = state.theme;
  updateThemeButton();
}

function applyThemeStyle() {
  document.documentElement.setAttribute("data-theme-style", state.themeStyle);
  els.themeStyleCss.setAttribute(
    "href",
    state.themeStyle === "classic" ? "/styles-classic.css" : "/styles-modern.css"
  );
  els.themeStyleSelect.value = state.themeStyle;
  updateThemeStyleButton();
}

function setTheme(value) {
  state.theme = value === "dark" ? "dark" : "light";
  localStorage.setItem("mcug_theme", state.theme);
  applyTheme();
}

function setThemeStyle(value) {
  state.themeStyle = value === "classic" ? "classic" : "modern";
  localStorage.setItem("mcug_theme_style", state.themeStyle);
  applyThemeStyle();
}

function renderThemeMenu() {
  els.themeMenu.innerHTML = "";
  THEME_ITEMS.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-item";
    button.setAttribute("role", "option");
    button.innerHTML = `<img src="${item.icon}" alt="" /><span>${item.label}</span>`;
    button.addEventListener("click", () => {
      closeThemeMenu();
      setTheme(item.value);
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
    button.innerHTML = `<img src="/images/ui/theme-style.svg" alt="" /><span>${item.label}</span>`;
    button.addEventListener("click", () => {
      closeThemeStyleMenu();
      setThemeStyle(item.value);
    });
    els.themeStyleMenu.appendChild(button);
  });
  updateThemeStyleButton();
}

function initAppearance() {
  const savedTheme = localStorage.getItem("mcug_theme");
  const savedStyle = localStorage.getItem("mcug_theme_style");

  state.theme = savedTheme === "dark" ? "dark" : "light";
  state.themeStyle = savedStyle === "classic" ? "classic" : "modern";

  applyThemeStyle();
  applyTheme();
  renderThemeStyleMenu();
  renderThemeMenu();
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

function setBusy(value) {
  state.busy = value;
  const disabled = Boolean(value);
  els.refreshBtn.disabled = disabled;
  els.bulkButtons.forEach((btn) => {
    btn.disabled = disabled;
  });

  els.containersBody.querySelectorAll("button").forEach((btn) => {
    btn.disabled = disabled;
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
  return Array.from(els.containersBody.querySelectorAll(".row-select:checked"))
    .map((input) => input.dataset.id)
    .filter(Boolean);
}

function updateSelectAllState() {
  const checks = Array.from(els.containersBody.querySelectorAll(".row-select"));
  if (checks.length === 0) {
    els.selectAll.checked = false;
    return;
  }

  const checkedCount = checks.filter((input) => input.checked).length;
  els.selectAll.checked = checkedCount === checks.length;
}

function renderRows() {
  els.containersBody.innerHTML = "";

  state.containers.forEach((container) => {
    const fragment = els.rowTemplate.content.cloneNode(true);
    const tr = fragment.querySelector("tr");

    const rowSelect = fragment.querySelector(".row-select");
    rowSelect.dataset.id = container.id;
    rowSelect.addEventListener("change", updateSelectAllState);

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

    fragment.querySelectorAll("[data-action]").forEach((btn) => {
      if (btn.dataset.action === "update") {
        const allowUpdate = checkState.state === "available";
        btn.classList.toggle("hidden", !allowUpdate);
      }
      btn.addEventListener("click", () => runSingleAction(container.id, btn.dataset.action));
    });

    tr.dataset.id = container.id;
    els.containersBody.appendChild(fragment);
  });

  updateSelectAllState();
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
    appendLog(`Running '${action}' on container ${id}`);
    const result = await apiRequest(`/api/containers/${encodeURIComponent(id)}/actions/${action}`, {
      method: "POST"
    });
    appendLog(`Action '${action}' completed for ${result.container.name}`, result.result);

    if (action === "check") {
      applyCheckResult(id, result.result);
      renderRows();
    } else {
      state.checkById = {};
      await loadContainers();
    }
  } catch (error) {
    appendLog(`Action '${action}' failed on ${id}: ${error.message}`, error.details || {});
  } finally {
    setBusy(false);
  }
}

async function runBulkAction(action) {
  const selectedIds = selectedContainerIds();
  let ids = selectedIds;

  if (action === "update" && selectedIds.length === 0) {
    ids = state.containers
      .filter((container) => state.checkById[container.id]?.state === "available")
      .map((container) => container.id);
  }

  if (action === "update" && ids.length === 0) {
    appendLog("No containers marked with updates. Run check first or select specific containers.");
    return;
  }

  const scopeLabel = ids.length ? `${ids.length} selected containers` : "all containers";

  setBusy(true);
  try {
    appendLog(`Running bulk '${action}' on ${scopeLabel}`);
    const result = await apiRequest(`/api/containers/actions/${action}`, {
      method: "POST",
      body: JSON.stringify({ containerIds: ids })
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
    appendLog(`Bulk '${action}' failed: ${error.message}`, error.details || {});
  } finally {
    setBusy(false);
  }
}

els.refreshBtn.addEventListener("click", loadContainers);

els.themeToggle.addEventListener("click", () => {
  const open = els.themeMenu.classList.toggle("open");
  els.themeToggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    closeThemeStyleMenu();
  }
});

els.themeStyleToggle.addEventListener("click", () => {
  const open = els.themeStyleMenu.classList.toggle("open");
  els.themeStyleToggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    closeThemeMenu();
  }
});

document.addEventListener("click", (event) => {
  if (!els.themeDropdown.contains(event.target)) {
    closeThemeMenu();
  }
  if (!els.themeStyleDropdown.contains(event.target)) {
    closeThemeStyleMenu();
  }
});

els.selectAll.addEventListener("change", (event) => {
  const checked = event.target.checked;
  els.containersBody.querySelectorAll(".row-select").forEach((input) => {
    input.checked = checked;
  });
});

els.bulkButtons.forEach((btn) => {
  btn.addEventListener("click", () => runBulkAction(btn.dataset.bulkAction));
});

initAppearance();
loadContainers();
