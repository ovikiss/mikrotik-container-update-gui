const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_ROUTER_SCHEME = "http";

function parseLittleEndianIpv4(hexValue) {
  const raw = String(hexValue || "").trim();
  if (!/^[0-9a-fA-F]{8}$/.test(raw)) {
    return "";
  }

  const bytes = raw.match(/../g);
  if (!bytes || bytes.length !== 4) {
    return "";
  }

  return bytes
    .reverse()
    .map((part) => String(parseInt(part, 16)))
    .join(".");
}

function detectRouterIpFromProcRoute() {
  try {
    const fs = require("node:fs");
    const content = fs.readFileSync("/proc/net/route", "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);

    for (let index = 1; index < lines.length; index += 1) {
      const columns = lines[index].trim().split(/\s+/);
      if (columns.length < 4) continue;

      const destination = columns[1];
      const gateway = columns[2];
      const flagsHex = columns[3];
      const flags = parseInt(flagsHex, 16);

      if (destination !== "00000000") continue;
      if (Number.isNaN(flags) || (flags & 0x2) === 0) continue;

      const gatewayIp = parseLittleEndianIpv4(gateway);
      if (gatewayIp) {
        return gatewayIp;
      }
    }
  } catch (error) {
    return "";
  }

  return "";
}

function resolveBaseUrl(baseUrl) {
  const explicit = String(baseUrl || "").trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const gatewayIp = detectRouterIpFromProcRoute();
  if (!gatewayIp) {
    throw new Error("Missing ROUTEROS_BASE_URL and auto-detect failed");
  }

  return `${DEFAULT_ROUTER_SCHEME}://${gatewayIp}`;
}

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

function normalizeDigest(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.startsWith("sha256:") ? raw.slice(7) : raw;
}

function parseImageReference(imageRef) {
  const input = String(imageRef || "").trim();
  if (!input) {
    throw new Error("Missing container remote-image");
  }

  const withoutDigest = input.split("@")[0];
  const slashIndex = withoutDigest.lastIndexOf("/");
  const colonIndex = withoutDigest.lastIndexOf(":");

  let reference = "latest";
  let repoPart = withoutDigest;
  if (colonIndex > slashIndex) {
    reference = withoutDigest.slice(colonIndex + 1);
    repoPart = withoutDigest.slice(0, colonIndex);
  }

  const firstPart = repoPart.split("/")[0];
  const hasRegistryPrefix =
    firstPart.includes(".") || firstPart.includes(":") || firstPart === "localhost";

  let registry;
  let repository;

  if (hasRegistryPrefix) {
    registry = firstPart;
    repository = repoPart.slice(firstPart.length + 1);
  } else {
    registry = "registry-1.docker.io";
    repository = repoPart.includes("/") ? repoPart : `library/${repoPart}`;
  }

  return { registry, repository, reference, original: input };
}

function parseBearerChallenge(headerValue) {
  const header = String(headerValue || "");
  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const params = {};
  const regex = /([a-zA-Z]+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(header))) {
    params[match[1].toLowerCase()] = match[2];
  }

  if (!params.realm) {
    return null;
  }

  return params;
}

class RouterOsClient {
  constructor(config) {
    this.baseUrl = resolveBaseUrl(config.baseUrl);
    this.restPrefix = normalizePathSegment(config.restPrefix || "/rest");
    this.username = config.username;
    this.password = config.password;
    this.timeoutMs = Number(config.timeoutMs || DEFAULT_TIMEOUT_MS);

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

    const explicitTargetField = String(config.actionTargetField || "").trim();
    this.targetField = explicitTargetField || ".id";

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

  async registryFetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await fetch(url, {
        method: options.method || "GET",
        headers: options.headers || {},
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const rawText = await response.text();
    let data = null;

    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch (error) {
        data = rawText;
      }
    }

    return { response, data };
  }

  async fetchRegistryManifestWithAuth(registryUrl) {
    const acceptHeader = [
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
      "application/vnd.oci.image.index.v1+json",
      "application/vnd.docker.distribution.manifest.list.v2+json"
    ].join(", ");

    const firstTry = await this.registryFetchJson(registryUrl, {
      headers: { Accept: acceptHeader }
    });

    if (firstTry.response.ok) {
      return firstTry;
    }

    if (firstTry.response.status !== 401) {
      throw new Error(`Registry request failed with HTTP ${firstTry.response.status}`);
    }

    const challenge = parseBearerChallenge(firstTry.response.headers.get("www-authenticate"));
    if (!challenge) {
      throw new Error("Registry authentication challenge is not supported");
    }

    const tokenUrl = new URL(challenge.realm);
    if (challenge.service) tokenUrl.searchParams.set("service", challenge.service);
    if (challenge.scope) tokenUrl.searchParams.set("scope", challenge.scope);

    const tokenTry = await this.registryFetchJson(tokenUrl.toString());
    if (!tokenTry.response.ok) {
      throw new Error(`Registry token request failed with HTTP ${tokenTry.response.status}`);
    }

    const bearerToken = tokenTry.data?.token || tokenTry.data?.access_token;
    if (!bearerToken) {
      throw new Error("Registry token response did not include a bearer token");
    }

    const secondTry = await this.registryFetchJson(registryUrl, {
      headers: {
        Accept: acceptHeader,
        Authorization: `Bearer ${bearerToken}`
      }
    });

    if (!secondTry.response.ok) {
      throw new Error(`Registry request failed with HTTP ${secondTry.response.status}`);
    }

    return secondTry;
  }

  async resolveRemoteConfigDigest(imageRef) {
    const parsed = parseImageReference(imageRef);
    const baseUrl = `https://${parsed.registry}/v2/${parsed.repository}/manifests/${parsed.reference}`;

    const manifestResult = await this.fetchRegistryManifestWithAuth(baseUrl);
    let manifest = manifestResult.data;

    if (manifest && Array.isArray(manifest.manifests) && !manifest.config) {
      const preferredManifest =
        manifest.manifests.find((item) => item.platform?.architecture === "arm" && item.platform?.variant === "v7") ||
        manifest.manifests.find((item) => item.platform?.architecture === "arm64") ||
        manifest.manifests.find((item) => item.platform?.architecture === "arm") ||
        manifest.manifests[0];

      if (!preferredManifest?.digest) {
        throw new Error("Could not resolve a child manifest digest");
      }

      const nestedUrl = `https://${parsed.registry}/v2/${parsed.repository}/manifests/${preferredManifest.digest}`;
      const nestedResult = await this.fetchRegistryManifestWithAuth(nestedUrl);
      manifest = nestedResult.data;
    }

    const remoteConfigDigest = String(manifest?.config?.digest || "");
    if (!remoteConfigDigest) {
      throw new Error("Registry manifest did not include config digest");
    }

    return {
      imageRef: parsed.original,
      remoteConfigDigest,
      normalizedRemoteConfigDigest: normalizeDigest(remoteConfigDigest)
    };
  }

  async checkContainerImage(container) {
    const localImageId = String(container.raw?.["image-id"] || "");
    const normalizedLocalImageId = normalizeDigest(localImageId);
    const remoteImageRef = container.raw?.["remote-image"] || container.image;

    try {
      const remote = await this.resolveRemoteConfigDigest(remoteImageRef);
      const upToDate =
        normalizedLocalImageId &&
        remote.normalizedRemoteConfigDigest &&
        normalizedLocalImageId === remote.normalizedRemoteConfigDigest;

      return {
        mode: "digest-compare",
        upToDate: Boolean(upToDate),
        localImageId,
        remoteConfigDigest: remote.remoteConfigDigest,
        imageRef: remote.imageRef
      };
    } catch (error) {
      return {
        mode: "digest-compare",
        upToDate: null,
        localImageId,
        imageRef: String(remoteImageRef || ""),
        warning: `Digest check unavailable: ${error.message}`
      };
    }
  }
}

module.exports = {
  RouterOsClient,
  RouterOsRequestError
};
