const DEFAULT_TIMEOUT_MS = 15000;

class RouterOsRequestError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RouterOsRequestError";
    this.details = details;
  }
}

function normalizePathSegment(path) {
  if (!path) return "";
  return path.startsWith("/") ? path : `/${path}`;
}

function parseJsonEnv(envValue, fallbackValue) {
  if (!envValue) return fallbackValue;
  try {
    return JSON.parse(envValue);
  } catch (error) {
    throw new Error(`Invalid JSON in env value: ${envValue}`);
  }
}

function boolFromEnv(value, fallbackValue) {
  if (value === undefined) return fallbackValue;
  return !(value === "false" || value === "0" || value === "no");
}

class RouterOsClient {
  constructor(config) {
    this.baseUrl = (config.baseUrl || "").replace(/\/+$/, "");
    this.restPrefix = normalizePathSegment(config.restPrefix || "/rest");
    this.username = config.username;
    this.password = config.password;
    this.timeoutMs = Number(config.timeoutMs || DEFAULT_TIMEOUT_MS);

    if (!this.baseUrl) {
      throw new Error("Missing ROUTEROS_BASE_URL");
    }

    if (!this.username) {
      throw new Error("Missing ROUTEROS_USERNAME");
    }

    if (!this.password) {
      throw new Error("Missing ROUTEROS_PASSWORD");
    }

    const allowInsecureTls = boolFromEnv(config.allowInsecureTls, false);
    if (allowInsecureTls) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }

    this.targetField = config.actionTargetField || "number";

    this.actionDefs = {
      check: {
        method: (config.checkMethod || "POST").toUpperCase(),
        pathTemplate: config.checkPath || "/container/check-for-updates",
        sendTarget: boolFromEnv(config.checkSendTarget, false),
        bodyTemplate: parseJsonEnv(config.checkBodyJson, {})
      },
      update: {
        method: (config.updateMethod || "POST").toUpperCase(),
        pathTemplate: config.updatePath || "/container/update",
        sendTarget: boolFromEnv(config.updateSendTarget, true),
        bodyTemplate: parseJsonEnv(config.updateBodyJson, {})
      },
      rollback: {
        method: (config.rollbackMethod || "POST").toUpperCase(),
        pathTemplate: config.rollbackPath || "/container/rollback",
        sendTarget: boolFromEnv(config.rollbackSendTarget, true),
        bodyTemplate: parseJsonEnv(config.rollbackBodyJson, {})
      }
    };
  }

  buildAuthHeader() {
    const token = Buffer.from(`${this.username}:${this.password}`).toString("base64");
    return `Basic ${token}`;
  }

  buildUrl(path) {
    const normalizedPath = normalizePathSegment(path);
    return `${this.baseUrl}${this.restPrefix}${normalizedPath}`;
  }

  async request(path, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers = {
      Accept: "application/json",
      Authorization: this.buildAuthHeader(),
      ...(options.headers || {})
    };

    const fetchOptions = {
      method: options.method || "GET",
      headers,
      signal: controller.signal
    };

    if (options.body && Object.keys(options.body).length > 0) {
      fetchOptions.body = JSON.stringify(options.body);
      fetchOptions.headers["Content-Type"] = "application/json";
    }

    let response;

    try {
      response = await fetch(this.buildUrl(path), fetchOptions);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        throw new RouterOsRequestError("RouterOS request timed out", {
          path,
          timeoutMs: this.timeoutMs
        });
      }

      throw new RouterOsRequestError("RouterOS request failed", {
        path,
        cause: error.message
      });
    }

    clearTimeout(timeoutId);

    const rawText = await response.text();
    let data = rawText;

    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch (error) {
        data = rawText;
      }
    }

    if (!response.ok) {
      throw new RouterOsRequestError("RouterOS returned an error", {
        status: response.status,
        path,
        data
      });
    }

    return data;
  }

  async listContainers() {
    const data = await this.request("/container", { method: "GET" });

    if (Array.isArray(data)) {
      return data;
    }

    if (data && typeof data === "object") {
      return [data];
    }

    return [];
  }

  resolveActionPath(pathTemplate, container) {
    return pathTemplate
      .replaceAll("{id}", encodeURIComponent(container.id || ""))
      .replaceAll("{name}", encodeURIComponent(container.name || ""));
  }

  buildActionBody(action, container, pathTemplate) {
    const def = this.actionDefs[action];
    const payload = { ...(def.bodyTemplate || {}) };

    const templateContainsId = pathTemplate.includes("{id}");
    const templateContainsName = pathTemplate.includes("{name}");

    if (def.sendTarget && !templateContainsId && container.id) {
      payload[this.targetField] = container.id;
    }

    if (def.sendTarget && !templateContainsName && !payload.name && container.name) {
      payload.name = container.name;
    }

    return payload;
  }

  async runContainerAction(action, container) {
    const def = this.actionDefs[action];
    if (!def) {
      throw new Error(`Unsupported action: ${action}`);
    }

    const path = this.resolveActionPath(def.pathTemplate, container);
    const body = this.buildActionBody(action, container, def.pathTemplate);

    return this.request(path, {
      method: def.method,
      body
    });
  }
}

module.exports = {
  RouterOsClient,
  RouterOsRequestError
};
