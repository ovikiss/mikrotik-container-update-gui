const path = require("node:path");
const express = require("express");
const dotenv = require("dotenv");
const { RouterOsClient, RouterOsRequestError } = require("./routeros-client");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3030);

const client = new RouterOsClient({
  baseUrl: process.env.ROUTEROS_BASE_URL,
  restPrefix: process.env.ROUTEROS_REST_PREFIX,
  username: process.env.ROUTEROS_USERNAME,
  password: process.env.ROUTEROS_PASSWORD,
  timeoutMs: process.env.ROUTEROS_TIMEOUT_MS,
  allowInsecureTls: process.env.ROUTEROS_ALLOW_INSECURE_TLS,
  actionTargetField: process.env.ROUTEROS_ACTION_TARGET_FIELD,

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
app.use(express.static(path.join(__dirname, "..", "public")));

function normalizeContainer(raw) {
  const id = raw[".id"] || raw.id || raw.number || raw.numbers || "";
  const name = raw.name || raw.comment || raw["remote-image"] || String(id);
  const image = raw["remote-image"] || raw.image || raw.file || "";

  return {
    id: String(id),
    name: String(name),
    status: String(raw.status || "unknown"),
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

    const result = await client.runContainerAction(action, container);
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
        const result = await client.runContainerAction(action, container);
        results.push({
          ok: true,
          container: { id: container.id, name: container.name },
          result
        });
      } catch (error) {
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
