const path = require("node:path");
const fs = require("node:fs/promises");
const express = require("express");
const dotenv = require("dotenv");
const { RouterOsClient, RouterOsRequestError } = require("./routeros-client");

dotenv.config();

const app = express();
const port = Number(process.env.HTTP_PORT || process.env.PORT || 3030);
const settingsPath = path.join(__dirname, "..", "app", "settings.json");
const defaultSettings = {
  theme: "auto",
  theme_style: "modern"
};

const client = new RouterOsClient({
  baseUrl: process.env.ROUTEROS_BASE_URL,
  restPrefix: process.env.ROUTEROS_REST_PREFIX,
  username: process.env.ROUTEROS_USERNAME,
  password: process.env.ROUTEROS_PASSWORD,
  timeoutMs: process.env.ROUTEROS_TIMEOUT_MS,
  allowInsecureTls: process.env.ROUTEROS_ALLOW_INSECURE_TLS,

  checkPath: process.env.ROUTEROS_CHECK_PATH,
  checkMethod: process.env.ROUTEROS_CHECK_METHOD,
  checkSendTarget: process.env.ROUTEROS_CHECK_SEND_TARGET,
  checkBodyJson: process.env.ROUTEROS_CHECK_BODY_JSON,

  updatePath: process.env.ROUTEROS_UPDATE_PATH,
  updateMethod: process.env.ROUTEROS_UPDATE_METHOD,
  updateSendTarget: process.env.ROUTEROS_UPDATE_SEND_TARGET,
  updateBodyJson: process.env.ROUTEROS_UPDATE_BODY_JSON,

  rollbackPath: process.env.ROUTEROS_ROLLBACK_PATH,
  rollbackMethod: process.env.ROUTEROS_ROLLBACK_METHOD,
  rollbackSendTarget: process.env.ROUTEROS_ROLLBACK_SEND_TARGET,
  rollbackBodyJson: process.env.ROUTEROS_ROLLBACK_BODY_JSON
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "app", "www")));

function normalizeSettings(input) {
  const raw = input && typeof input === "object" ? input : {};
  const theme = ["auto", "light", "dark"].includes(String(raw.theme || "").toLowerCase())
    ? String(raw.theme).toLowerCase()
    : defaultSettings.theme;
  const rawThemeStyle = raw.theme_style || raw.themeStyle;
  const themeStyle = ["modern", "classic"].includes(String(rawThemeStyle || "").toLowerCase())
    ? String(rawThemeStyle).toLowerCase()
    : defaultSettings.theme_style;

  return { theme, theme_style: themeStyle };
}

async function readSettings() {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { ...defaultSettings };
    }
    throw error;
  }
}

async function writeSettings(partial) {
  const current = await readSettings();
  const merged = {
    ...current,
    ...(partial && typeof partial === "object" ? partial : {})
  };
  const next = normalizeSettings(merged);
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function normalizeContainer(raw) {
  const id = raw[".id"] || raw.id || raw.number || raw.numbers || "";
  const name = raw.name || raw.comment || raw["remote-image"] || String(id);
  const image = raw["remote-image"] || raw.image || raw.file || "";
  const runningRaw = String(raw.running || "").toLowerCase();

  let status = "unknown";
  if (raw.status) {
    status = String(raw.status);
  } else if (["true", "1", "yes"].includes(runningRaw)) {
    status = "running";
  } else if (["false", "0", "no"].includes(runningRaw)) {
    status = "stopped";
  }

  return {
    id: String(id),
    name: String(name),
    status,
    image: String(image),
    created: String(raw.created || ""),
    raw
  };
}

function actionFromParam(value) {
  const action = String(value || "").toLowerCase();
  if (["check", "update", "rollback"].includes(action)) {
    return action;
  }
  return null;
}

function isUnsupportedActionError(action, error) {
  if (!(error instanceof RouterOsRequestError)) {
    return false;
  }

  if (!["rollback"].includes(action)) {
    return false;
  }

  const detail = String(error.details?.data?.detail || "").toLowerCase();
  return detail.includes("no such command");
}

async function fetchNormalizedContainers() {
  const containers = await client.listContainers();
  return containers.map(normalizeContainer).sort((a, b) => a.name.localeCompare(b.name));
}

app.get("/api/health", async (req, res, next) => {
  try {
    const containers = await fetchNormalizedContainers();
    res.json({
      ok: true,
      connected: true,
      containerCount: containers.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/containers", async (req, res, next) => {
  try {
    const containers = await fetchNormalizedContainers();
    res.json({ ok: true, containers });
  } catch (error) {
    next(error);
  }
});

app.get("/api/settings.json", async (req, res, next) => {
  try {
    const settings = await readSettings();
    res.json({ ok: true, settings });
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings", async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ ok: false, error: "Invalid settings payload" });
      return;
    }

    const patch = {};
    if (Object.prototype.hasOwnProperty.call(req.body, "theme")) {
      patch.theme = req.body.theme;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "theme_style")) {
      patch.theme_style = req.body.theme_style;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "themeStyle")) {
      patch.theme_style = req.body.themeStyle;
    }

    const settings = await writeSettings(patch);
    res.json({ ok: true, settings });
  } catch (error) {
    next(error);
  }
});

app.post("/api/containers/:id/actions/:action", async (req, res, next) => {
  const action = actionFromParam(req.params.action);
  if (!action) {
    res.status(400).json({ ok: false, error: "Invalid action" });
    return;
  }

  try {
    const containers = await fetchNormalizedContainers();
    const container = containers.find((item) => item.id === req.params.id);

    if (!container) {
      res.status(404).json({ ok: false, error: "Container not found" });
      return;
    }

    if (action === "check") {
      const checkResult = await client.checkContainerImage(container);
      res.json({
        ok: true,
        action,
        container: {
          id: container.id,
          name: container.name
        },
        result: checkResult
      });
      return;
    }

    let result;
    try {
      result = await client.runContainerAction(action, container);
    } catch (error) {
      if (isUnsupportedActionError(action, error)) {
        res.json({
          ok: true,
          action,
          unsupported: true,
          message: `Action '${action}' is not supported by this RouterOS REST build`,
          container: {
            id: container.id,
            name: container.name
          },
          details: error.details || null
        });
        return;
      }
      throw error;
    }

    res.json({
      ok: true,
      action,
      container: {
        id: container.id,
        name: container.name
      },
      result
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/containers/actions/:action", async (req, res, next) => {
  const action = actionFromParam(req.params.action);
  if (!action) {
    res.status(400).json({ ok: false, error: "Invalid action" });
    return;
  }

  try {
    const containers = await fetchNormalizedContainers();
    const ids = Array.isArray(req.body?.containerIds)
      ? req.body.containerIds.map((id) => String(id))
      : null;

    const targetContainers = ids && ids.length > 0
      ? containers.filter((container) => ids.includes(container.id))
      : containers;

    const results = [];
    for (const container of targetContainers) {
      try {
        if (action === "check") {
          const checkResult = await client.checkContainerImage(container);
          results.push({
            ok: true,
            container: { id: container.id, name: container.name },
            result: checkResult
          });
          continue;
        }

        const result = await client.runContainerAction(action, container);
        results.push({
          ok: true,
          container: { id: container.id, name: container.name },
          result
        });
      } catch (error) {
        if (isUnsupportedActionError(action, error)) {
          results.push({
            ok: true,
            unsupported: true,
            container: { id: container.id, name: container.name },
            message: `Action '${action}' is not supported by this RouterOS REST build`,
            details: error.details || null
          });
          continue;
        }

        results.push({
          ok: false,
          container: { id: container.id, name: container.name },
          error: error.message,
          details: error.details || null
        });
      }
    }

    const successCount = results.filter((entry) => entry.ok).length;
    const failedCount = results.length - successCount;

    res.json({
      ok: failedCount === 0,
      action,
      total: results.length,
      successCount,
      failedCount,
      results
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (error instanceof RouterOsRequestError) {
    res.status(502).json({
      ok: false,
      error: error.message,
      details: error.details || null
    });
    return;
  }

  res.status(500).json({
    ok: false,
    error: error.message || "Unknown error"
  });
});

app.listen(port, () => {
  console.log(`Server started on http://localhost:${port}`);
});
