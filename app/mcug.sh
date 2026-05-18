#!/bin/sh
set -eu

: "${HTTP_PORT:=8090}"
: "${DATA_DIR:=/data}"
: "${TZ:=Europe/Bucharest}"

export HTTP_PORT
export DATA_DIR
export TZ

mkdir -p "$DATA_DIR"

cat >/tmp/routeros_client.py <<'PY_ROUTEROS'
import base64
import json
import re
from typing import Any, Dict, List, Optional
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request
import socket
import ssl


DEFAULT_TIMEOUT_MS = 15000
DEFAULT_ROUTER_SCHEME = "http"


def parse_little_endian_ipv4(hex_value: str) -> str:
    raw = str(hex_value or "").strip()
    if not re.fullmatch(r"[0-9a-fA-F]{8}", raw):
        return ""

    parts = [raw[i : i + 2] for i in range(0, 8, 2)]
    parts.reverse()
    return ".".join(str(int(part, 16)) for part in parts)


def detect_router_ip_from_proc_route() -> str:
    try:
        with open("/proc/net/route", "r", encoding="utf-8") as handle:
            lines = [line.strip() for line in handle.read().splitlines() if line.strip()]

        for line in lines[1:]:
            columns = re.split(r"\s+", line)
            if len(columns) < 4:
                continue

            destination = columns[1]
            gateway = columns[2]
            flags_hex = columns[3]

            if destination != "00000000":
                continue

            flags = int(flags_hex, 16)
            if (flags & 0x2) == 0:
                continue

            gateway_ip = parse_little_endian_ipv4(gateway)
            if gateway_ip:
                return gateway_ip
    except Exception:
        return ""

    return ""


def resolve_base_url(base_url: Optional[str]) -> str:
    explicit = str(base_url or "").strip()
    if explicit:
        return explicit.rstrip("/")

    gateway_ip = detect_router_ip_from_proc_route()
    if not gateway_ip:
        raise ValueError("Missing ROUTEROS_BASE_URL and auto-detect failed")

    return f"{DEFAULT_ROUTER_SCHEME}://{gateway_ip}"


class RouterOsRequestError(Exception):
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.details = details or {}


def normalize_path_segment(path: Optional[str]) -> str:
    if not path:
        return ""
    return path if str(path).startswith("/") else f"/{path}"


def parse_json_env(env_value: Optional[str], fallback_value: Any) -> Any:
    if not env_value:
        return fallback_value
    try:
        return json.loads(env_value)
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON in env value: {env_value}") from error


def bool_from_env(value: Optional[str], fallback_value: bool) -> bool:
    if value is None:
        return fallback_value
    raw = str(value).strip().lower()
    return raw not in ("false", "0", "no")


def normalize_digest(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    return raw[7:] if raw.startswith("sha256:") else raw


def strip_image_tag_and_digest(image_ref: str) -> str:
    input_ref = str(image_ref or "").strip()
    if not input_ref:
        return ""

    without_digest = input_ref.split("@")[0]
    slash_index = without_digest.rfind("/")
    colon_index = without_digest.rfind(":")
    return without_digest[:colon_index] if colon_index > slash_index else without_digest


def select_manifest_for_architecture(manifests: List[Dict[str, Any]], preferred_architecture: str) -> Optional[Dict[str, Any]]:
    entries = manifests or []
    if not entries:
        return None

    arch = str(preferred_architecture or "").lower()

    def find_by(arch_name: str, variant: Optional[str] = None) -> Optional[Dict[str, Any]]:
        for item in entries:
            platform = item.get("platform") or {}
            if platform.get("architecture") != arch_name:
                continue
            if variant is None:
                return item
            if str(platform.get("variant") or "").lower() == variant:
                return item
        return None

    if "arm64" in arch:
        return find_by("arm64") or find_by("arm") or entries[0]
    if arch.startswith("arm"):
        return find_by("arm", "v7") or find_by("arm") or find_by("arm64") or entries[0]
    if "amd64" in arch or "x86_64" in arch:
        return find_by("amd64") or entries[0]
    if "386" in arch or arch == "x86":
        return find_by("386") or entries[0]

    return find_by("arm", "v7") or find_by("arm64") or find_by("arm") or entries[0]


def parse_image_reference(image_ref: str) -> Dict[str, str]:
    input_ref = str(image_ref or "").strip()
    if not input_ref:
        raise ValueError("Missing container remote-image")

    without_digest = input_ref.split("@")[0]
    slash_index = without_digest.rfind("/")
    colon_index = without_digest.rfind(":")

    reference = "latest"
    repo_part = without_digest
    if colon_index > slash_index:
        reference = without_digest[colon_index + 1 :]
        repo_part = without_digest[:colon_index]

    first_part = repo_part.split("/")[0]
    has_registry_prefix = "." in first_part or ":" in first_part or first_part == "localhost"

    if has_registry_prefix:
        registry = first_part
        repository = repo_part[len(first_part) + 1 :]
    else:
        registry = "registry-1.docker.io"
        repository = repo_part if "/" in repo_part else f"library/{repo_part}"

    return {
        "registry": registry,
        "repository": repository,
        "reference": reference,
        "original": input_ref,
    }


def parse_bearer_challenge(header_value: Optional[str]) -> Optional[Dict[str, str]]:
    header = str(header_value or "")
    if not header.lower().startswith("bearer "):
        return None

    params: Dict[str, str] = {}
    for match in re.finditer(r'([a-zA-Z]+)="([^"]*)"', header):
        params[match.group(1).lower()] = match.group(2)

    if not params.get("realm"):
        return None

    return params


def parse_semver_tag(tag: str) -> Optional[tuple]:
    match = re.fullmatch(r"v(\d+)\.(\d+)(?:\.(\d+))?", str(tag or "").strip())
    if not match:
        return None
    major = int(match.group(1))
    minor = int(match.group(2))
    patch = int(match.group(3) or "0")
    has_patch = 1 if match.group(3) is not None else 0
    return (major, minor, patch, has_patch)


class RouterOsClient:
    def __init__(self, config: Dict[str, Any]):
        self.base_url = resolve_base_url(config.get("baseUrl"))
        self.rest_prefix = normalize_path_segment(config.get("restPrefix") or "/rest")
        self.username = config.get("username")
        self.password = config.get("password")
        self.timeout_ms = int(config.get("timeoutMs") or DEFAULT_TIMEOUT_MS)
        self.timeout_seconds = max(self.timeout_ms / 1000.0, 1)

        if not self.username:
            raise ValueError("Missing ROUTEROS_USERNAME")
        if not self.password:
            raise ValueError("Missing ROUTEROS_PASSWORD")

        self.verify_router_tls = not bool_from_env(config.get("allowInsecureTls"), False)

        explicit_target_field = str(config.get("actionTargetField") or "").strip()
        self.target_field = explicit_target_field or ".id"

        self.action_defs = {
            "check": {
                "method": str(config.get("checkMethod") or "POST").upper(),
                "pathTemplate": config.get("checkPath") or "/container/check-for-updates",
                "sendTarget": bool_from_env(config.get("checkSendTarget"), False),
                "bodyTemplate": parse_json_env(config.get("checkBodyJson"), {}),
            },
            "update": {
                "method": str(config.get("updateMethod") or "POST").upper(),
                "pathTemplate": config.get("updatePath") or "/container/update",
                "sendTarget": bool_from_env(config.get("updateSendTarget"), True),
                "bodyTemplate": parse_json_env(config.get("updateBodyJson"), {}),
            },
        }

    def build_auth_header(self) -> str:
        token = base64.b64encode(f"{self.username}:{self.password}".encode("utf-8")).decode("ascii")
        return f"Basic {token}"

    def build_url(self, path: str) -> str:
        return f"{self.base_url}{self.rest_prefix}{normalize_path_segment(path)}"

    def _http_request(
        self,
        method: str,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        payload: Optional[str] = None,
        verify_tls: bool = True,
    ) -> Dict[str, Any]:
        req = urllib_request.Request(
            url=url,
            data=payload.encode("utf-8") if payload is not None else None,
            headers=headers or {},
            method=method,
        )

        context = ssl.create_default_context()
        if not verify_tls:
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE

        status = 0
        response_headers: Dict[str, str] = {}
        raw_bytes = b""
        try:
            with urllib_request.urlopen(req, timeout=self.timeout_seconds, context=context) as response:
                status = int(response.status)
                response_headers = {k.lower(): v for k, v in response.headers.items()}
                raw_bytes = response.read()
        except urllib_error.HTTPError as http_error:
            status = int(http_error.code)
            response_headers = {k.lower(): v for k, v in http_error.headers.items()}
            raw_bytes = http_error.read() or b""
        except urllib_error.URLError as net_error:
            reason = net_error.reason
            reason_text = str(reason)
            if verify_tls and "CERTIFICATE_VERIFY_FAILED" in reason_text:
                return self._http_request(
                    method=method,
                    url=url,
                    headers=headers,
                    payload=payload,
                    verify_tls=False,
                )
            if isinstance(reason, socket.timeout):
                raise RouterOsRequestError(
                    "RouterOS request timed out",
                    {"path": url, "timeoutMs": self.timeout_ms},
                ) from net_error
            raise RouterOsRequestError(
                "RouterOS request failed",
                {"path": url, "cause": str(net_error.reason)},
            ) from net_error
        except TimeoutError as timeout_error:
            raise RouterOsRequestError(
                "RouterOS request timed out",
                {"path": url, "timeoutMs": self.timeout_ms},
            ) from timeout_error

        raw_text = raw_bytes.decode("utf-8", errors="replace")
        parsed_data: Any = raw_text
        if raw_text:
            try:
                parsed_data = json.loads(raw_text)
            except ValueError:
                parsed_data = raw_text

        return {
            "status": status,
            "ok": 200 <= status < 300,
            "headers": response_headers,
            "text": raw_text,
            "data": parsed_data,
        }

    def request(self, path: str, method: str = "GET", body: Optional[Dict[str, Any]] = None, headers: Optional[Dict[str, str]] = None) -> Any:
        req_headers = {
            "Accept": "application/json",
            "Authorization": self.build_auth_header(),
        }
        if headers:
            req_headers.update(headers)

        payload = None
        if body and isinstance(body, dict) and len(body) > 0:
            payload = json.dumps(body)
            req_headers["Content-Type"] = "application/json"

        response = self._http_request(
            method=method,
            url=self.build_url(path),
            headers=req_headers,
            payload=payload,
            verify_tls=self.verify_router_tls,
        )
        if not response["ok"]:
            raise RouterOsRequestError(
                "RouterOS returned an error",
                {"status": response["status"], "path": path, "data": response["data"]},
            )

        return response["data"]

    def list_containers(self) -> List[Dict[str, Any]]:
        data = self.request("/container", method="GET")
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return [data]
        return []

    def resolve_action_path(self, path_template: str, container: Dict[str, Any]) -> str:
        path = str(path_template or "")
        return path.replace("{id}", urllib_parse.quote(str(container.get("id") or ""), safe="")).replace(
            "{name}", urllib_parse.quote(str(container.get("name") or ""), safe="")
        )

    def build_action_body(self, action: str, container: Dict[str, Any], path_template: str) -> Dict[str, Any]:
        action_def = self.action_defs[action]
        payload = dict(action_def.get("bodyTemplate") or {})

        template_contains_id = "{id}" in path_template
        if action_def.get("sendTarget") and not template_contains_id and container.get("id"):
            payload[self.target_field] = container["id"]

        return payload

    def run_container_action(self, action: str, container: Dict[str, Any]) -> Any:
        action_def = self.action_defs.get(action)
        if not action_def:
            raise ValueError(f"Unsupported action: {action}")

        path = self.resolve_action_path(str(action_def.get("pathTemplate") or ""), container)
        body = self.build_action_body(action, container, str(action_def.get("pathTemplate") or ""))

        return self.request(path, method=str(action_def.get("method") or "POST"), body=body)

    def set_container_remote_image(self, container: Dict[str, Any], remote_image: str) -> Any:
        if not container.get("id"):
            raise ValueError("Missing container id for set remote-image")
        if not remote_image:
            raise ValueError("Missing remote-image value")

        return self.request(
            "/container/set",
            method="POST",
            body={self.target_field: container["id"], "remote-image": str(remote_image)},
        )

    def registry_fetch_json(self, url: str, method: str = "GET", headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self._http_request(
            method=method,
            url=url,
            headers=headers or {},
            payload=None,
            verify_tls=True,
        )

    def fetch_registry_json_with_auth(self, registry_url: str, accept_header: str = "application/json") -> Dict[str, Any]:
        first_try = self.registry_fetch_json(registry_url, headers={"Accept": accept_header})
        first_response = first_try

        if first_response["ok"]:
            return first_try

        if first_response["status"] != 401:
            raise ValueError(f"Registry request failed with HTTP {first_response['status']}")

        challenge = parse_bearer_challenge(first_response["headers"].get("www-authenticate"))
        if not challenge:
            raise ValueError("Registry authentication challenge is not supported")

        realm = challenge.get("realm")
        service = challenge.get("service")
        scope = challenge.get("scope")

        if not realm:
            raise ValueError("Registry authentication challenge is missing realm")

        token_url = realm
        query = []
        if service:
            query.append(f"service={urllib_parse.quote(service, safe='')}")
        if scope:
            query.append(f"scope={urllib_parse.quote(scope, safe='')}")
        if query:
            token_url = f"{realm}{'&' if '?' in realm else '?'}{'&'.join(query)}"

        token_try = self.registry_fetch_json(token_url)
        token_response = token_try

        if not token_response["ok"]:
            raise ValueError(f"Registry token request failed with HTTP {token_response['status']}")

        token_data = token_try.get("data") if isinstance(token_try.get("data"), dict) else {}
        bearer_token = token_data.get("token") or token_data.get("access_token")
        if not bearer_token:
            raise ValueError("Registry token response did not include a bearer token")

        return self.registry_fetch_json(
            registry_url,
            headers={"Accept": accept_header, "Authorization": f"Bearer {bearer_token}"},
        )

    def fetch_registry_manifest_with_auth(self, registry_url: str) -> Dict[str, Any]:
        accept_header = ", ".join(
            [
                "application/vnd.oci.image.manifest.v1+json",
                "application/vnd.docker.distribution.manifest.v2+json",
                "application/vnd.oci.image.index.v1+json",
                "application/vnd.docker.distribution.manifest.list.v2+json",
            ]
        )

        manifest_try = self.fetch_registry_json_with_auth(registry_url, accept_header=accept_header)
        if not manifest_try["ok"]:
            raise ValueError(f"Registry request failed with HTTP {manifest_try['status']}")
        return manifest_try

    def list_rollback_versions(
        self,
        image_ref: str,
        max_semver: int = 3,
        preferred_architecture: str = "",
    ) -> List[Dict[str, str]]:
        parsed = parse_image_reference(image_ref)
        base_image = strip_image_tag_and_digest(parsed["original"])
        if not base_image:
            raise ValueError("Could not resolve repository for rollback versions")

        candidate_tags: List[str] = []
        seen_candidates = set()

        def add_candidate(tag: str) -> None:
            clean_tag = str(tag or "").strip()
            if not clean_tag:
                return
            if clean_tag.startswith("sha256:"):
                return
            if clean_tag in seen_candidates:
                return
            candidate_tags.append(clean_tag)
            seen_candidates.add(clean_tag)

        current_ref = str(parsed.get("reference") or "")
        anchor_tag = ""
        if current_ref and not current_ref.startswith("sha256:"):
            anchor_tag = current_ref

        tags: List[str] = []
        try:
            tags_url = f"https://{parsed['registry']}/v2/{parsed['repository']}/tags/list?n=200"
            tags_result = self.fetch_registry_json_with_auth(tags_url, accept_header="application/json")
            if tags_result["ok"]:
                tags_data = tags_result.get("data") if isinstance(tags_result.get("data"), dict) else {}
                tags_raw = tags_data.get("tags")
                tags = [str(tag) for tag in tags_raw] if isinstance(tags_raw, list) else []
        except Exception:
            tags = []

        # Docker Hub fallback:
        # - use Hub tags API when registry endpoint returns nothing
        # - or when registry endpoint returns only non-semver tags (common on high-tag repos)
        if parsed.get("registry") == "registry-1.docker.io":
            repository = str(parsed.get("repository") or "")
            needs_hub_fallback = (not tags) or not any(parse_semver_tag(tag) is not None for tag in tags)
            if repository and needs_hub_fallback:
                seen_tag_names = set(tags)
                for page in range(1, 6):
                    try:
                        hub_url = (
                            "https://hub.docker.com/v2/repositories/"
                            f"{repository}/tags?page_size=100&page={page}"
                        )
                        hub_result = self.registry_fetch_json(hub_url, headers={"Accept": "application/json"})
                        if not hub_result.get("ok"):
                            break
                        hub_data = hub_result.get("data") if isinstance(hub_result.get("data"), dict) else {}
                        results = hub_data.get("results")
                        if not isinstance(results, list) or not results:
                            break
                        for item in results:
                            if isinstance(item, dict) and item.get("name"):
                                tag_name = str(item.get("name"))
                                if tag_name not in seen_tag_names:
                                    tags.append(tag_name)
                                    seen_tag_names.add(tag_name)
                        next_url = hub_data.get("next")
                        if not next_url:
                            break
                    except Exception:
                        break

        semver_tags = []
        for tag in tags:
            parsed_semver = parse_semver_tag(tag)
            if parsed_semver is None:
                continue
            semver_tags.append((parsed_semver, tag))
        semver_tags.sort(key=lambda item: item[0], reverse=True)

        if anchor_tag:
            # Universal policy: always keep currently configured tag as anchor.
            add_candidate(anchor_tag)

        for _, tag in semver_tags[: max(0, int(max_semver))]:
            add_candidate(tag)

        if candidate_tags:
            return [
                {
                    "tag": tag,
                    "label": tag,
                    "imageRef": f"{base_image}:{tag}",
                }
                for tag in candidate_tags
            ]

        # Final fallback: show current tag even when verification fails due transient networking.
        if current_ref and not current_ref.startswith("sha256:"):
            return [
                {
                    "tag": current_ref,
                    "label": current_ref,
                    "imageRef": f"{base_image}:{current_ref}",
                }
            ]

        return []

    def resolve_remote_config_digest(self, image_ref: str, preferred_architecture: str = "") -> Dict[str, str]:
        parsed = parse_image_reference(image_ref)
        base_url = f"https://{parsed['registry']}/v2/{parsed['repository']}/manifests/{parsed['reference']}"

        manifest_result = self.fetch_registry_manifest_with_auth(base_url)
        manifest = manifest_result.get("data") if isinstance(manifest_result.get("data"), dict) else {}

        if isinstance(manifest.get("manifests"), list) and "config" not in manifest:
            preferred_manifest = select_manifest_for_architecture(manifest.get("manifests") or [], preferred_architecture)
            digest = str((preferred_manifest or {}).get("digest") or "")
            if not digest:
                raise ValueError("Could not resolve a child manifest digest")

            nested_url = f"https://{parsed['registry']}/v2/{parsed['repository']}/manifests/{digest}"
            nested_result = self.fetch_registry_manifest_with_auth(nested_url)
            nested_manifest = nested_result.get("data") if isinstance(nested_result.get("data"), dict) else {}
            manifest = nested_manifest

        remote_config_digest = str((manifest.get("config") or {}).get("digest") or "")
        if not remote_config_digest:
            raise ValueError("Registry manifest did not include config digest")

        return {
            "imageRef": parsed["original"],
            "remoteConfigDigest": remote_config_digest,
            "normalizedRemoteConfigDigest": normalize_digest(remote_config_digest),
        }

    def resolve_rollback_image_reference(self, image_ref: str, preferred_architecture: str = "") -> Dict[str, str]:
        parsed = parse_image_reference(image_ref)
        base_image = strip_image_tag_and_digest(parsed["original"])
        if not base_image:
            raise ValueError("Could not resolve repository for rollback backup")

        base_url = f"https://{parsed['registry']}/v2/{parsed['repository']}/manifests/{parsed['reference']}"
        manifest_result = self.fetch_registry_manifest_with_auth(base_url)
        manifest = manifest_result.get("data") if isinstance(manifest_result.get("data"), dict) else {}

        manifest_digest = ""

        if isinstance(manifest.get("manifests"), list) and "config" not in manifest:
            preferred_manifest = select_manifest_for_architecture(manifest.get("manifests") or [], preferred_architecture)
            manifest_digest = str((preferred_manifest or {}).get("digest") or "")
            if not manifest_digest:
                raise ValueError("Could not resolve rollback manifest digest")
        else:
            header_digest = str(manifest_result.get("headers", {}).get("docker-content-digest") or "")
            if header_digest:
                manifest_digest = header_digest
            elif str(parsed["reference"]).startswith("sha256:"):
                manifest_digest = str(parsed["reference"])

        if not normalize_digest(manifest_digest):
            raise ValueError("Rollback manifest digest is unavailable")

        return {
            "imageRef": parsed["original"],
            "manifestDigest": manifest_digest,
            "pinnedImage": f"{base_image}@{manifest_digest}",
        }

    def check_container_image(self, container: Dict[str, Any]) -> Dict[str, Any]:
        raw = container.get("raw") if isinstance(container.get("raw"), dict) else {}
        local_image_id = str(raw.get("image-id") or "")
        normalized_local_image_id = normalize_digest(local_image_id)
        remote_image_ref = raw.get("remote-image") or container.get("image")
        rollback_options: List[Dict[str, str]] = []
        rollback_warning = ""

        try:
            rollback_options = self.list_rollback_versions(
                str(remote_image_ref or ""),
                max_semver=3,
                preferred_architecture=str(raw.get("arch") or ""),
            )
        except Exception as error:
            rollback_warning = f"Rollback versions unavailable: {error}"

        try:
            remote = self.resolve_remote_config_digest(str(remote_image_ref or ""), str(raw.get("arch") or ""))
            remote_normalized = remote.get("normalizedRemoteConfigDigest") or ""
            up_to_date = bool(
                normalized_local_image_id and remote_normalized and normalized_local_image_id == remote_normalized
            )
            result = {
                "mode": "digest-compare",
                "upToDate": up_to_date,
                "localImageId": local_image_id,
                "remoteConfigDigest": remote.get("remoteConfigDigest"),
                "imageRef": remote.get("imageRef"),
                "rollbackOptions": rollback_options,
            }
            if rollback_warning:
                result["rollbackWarning"] = rollback_warning
            return result
        except Exception as error:
            result = {
                "mode": "digest-compare",
                "upToDate": None,
                "localImageId": local_image_id,
                "imageRef": str(remote_image_ref or ""),
                "warning": f"Digest check unavailable: {error}",
                "rollbackOptions": rollback_options,
            }
            if rollback_warning:
                result["rollbackWarning"] = rollback_warning
            return result
PY_ROUTEROS

cat >/tmp/server.py <<'PY_SERVER'
import json
import os
import re
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import unquote

from routeros_client import RouterOsClient, RouterOsRequestError


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class ApiUserError(Exception):
    def __init__(self, message: str, status: int = 400, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.status = int(status)
        self.details = details or None


HTTP_PORT = int(os.getenv("HTTP_PORT") or os.getenv("PORT") or "3030")
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR") or (BASE_DIR / "app"))
WWW_DIR = BASE_DIR / "app" / "www"
SETTINGS_PATH = DATA_DIR / "settings.json"
ROLLBACK_STATE_PATH = DATA_DIR / "rollback-state.json"

DEFAULT_SETTINGS = {
    "theme": "auto",
    "theme_style": "modern",
}

SELF_CONTAINER_NAME = str(os.getenv("SELF_CONTAINER_NAME") or "container-update-gui").strip().lower()
SELF_IMAGE_HINT = str(os.getenv("SELF_IMAGE_HINT") or "mikrotik-container-update-gui").strip().lower()

CLIENT = RouterOsClient(
    {
        "baseUrl": os.getenv("ROUTEROS_BASE_URL"),
        "restPrefix": os.getenv("ROUTEROS_REST_PREFIX"),
        "username": os.getenv("ROUTEROS_USERNAME"),
        "password": os.getenv("ROUTEROS_PASSWORD"),
        "timeoutMs": os.getenv("ROUTEROS_TIMEOUT_MS"),
        "allowInsecureTls": os.getenv("ROUTEROS_ALLOW_INSECURE_TLS"),
        "actionTargetField": os.getenv("ROUTEROS_ACTION_TARGET_FIELD"),
        "checkPath": os.getenv("ROUTEROS_CHECK_PATH"),
        "checkMethod": os.getenv("ROUTEROS_CHECK_METHOD"),
        "checkSendTarget": os.getenv("ROUTEROS_CHECK_SEND_TARGET"),
        "checkBodyJson": os.getenv("ROUTEROS_CHECK_BODY_JSON"),
        "updatePath": os.getenv("ROUTEROS_UPDATE_PATH"),
        "updateMethod": os.getenv("ROUTEROS_UPDATE_METHOD"),
        "updateSendTarget": os.getenv("ROUTEROS_UPDATE_SEND_TARGET"),
        "updateBodyJson": os.getenv("ROUTEROS_UPDATE_BODY_JSON"),
    }
)


def normalize_settings(input_data: Any) -> Dict[str, str]:
    raw = input_data if isinstance(input_data, dict) else {}

    theme_raw = str(raw.get("theme", "")).lower()
    theme = theme_raw if theme_raw in ("auto", "light", "dark") else DEFAULT_SETTINGS["theme"]

    theme_style_raw = raw.get("theme_style", raw.get("themeStyle", ""))
    theme_style = str(theme_style_raw).lower()
    if theme_style not in ("modern", "classic"):
        theme_style = DEFAULT_SETTINGS["theme_style"]

    return {"theme": theme, "theme_style": theme_style}


def read_json_file(path: Path, fallback: Any) -> Any:
    try:
        if not path.exists():
            return fallback
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def write_json_file(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def read_settings() -> Dict[str, str]:
    return normalize_settings(read_json_file(SETTINGS_PATH, DEFAULT_SETTINGS))


def write_settings(patch: Dict[str, Any]) -> Dict[str, str]:
    current = read_settings()
    merged = dict(current)
    merged.update(patch or {})
    next_settings = normalize_settings(merged)
    write_json_file(SETTINGS_PATH, next_settings)
    return next_settings


def read_rollback_state() -> Dict[str, Any]:
    data = read_json_file(ROLLBACK_STATE_PATH, {})
    return data if isinstance(data, dict) else {}


def write_rollback_state(next_state: Dict[str, Any]) -> None:
    write_json_file(ROLLBACK_STATE_PATH, next_state)


def build_rollback_snapshot(container: Dict[str, Any], remote_image: str, rollback_ref: Dict[str, str]) -> Dict[str, str]:
    return {
        "containerId": str(container.get("id") or ""),
        "containerName": str(container.get("name") or ""),
        "remoteImage": str(remote_image),
        "rollbackType": "manifest-digest",
        "rollbackManifestDigest": str(rollback_ref.get("manifestDigest") or ""),
        "pinnedImage": str(rollback_ref.get("pinnedImage") or ""),
        "savedAt": now_iso(),
    }


def get_rollback_candidate_from_entry(entry: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(entry, dict):
        return None

    last_known_good = entry.get("lastKnownGood")
    if isinstance(last_known_good, dict) and last_known_good.get("pinnedImage"):
        candidate = dict(last_known_good)
        candidate["strategy"] = "last-known-good"
        return candidate

    manual_backup = entry.get("manualBackup")
    if isinstance(manual_backup, dict) and manual_backup.get("pinnedImage"):
        candidate = dict(manual_backup)
        candidate["strategy"] = "manual-backup"
        return candidate

    if entry.get("pinnedImage"):
        return {
            "containerId": entry.get("containerId", ""),
            "containerName": entry.get("containerName", ""),
            "remoteImage": entry.get("remoteImage", ""),
            "rollbackType": entry.get("rollbackType", "legacy"),
            "rollbackManifestDigest": entry.get("rollbackManifestDigest", ""),
            "pinnedImage": entry.get("pinnedImage", ""),
            "savedAt": entry.get("savedAt", ""),
            "strategy": "legacy",
        }

    return None


def save_rollback_point(container: Dict[str, Any], strict: bool = False, reason: str = "manual") -> Optional[Dict[str, Any]]:
    raw = container.get("raw") if isinstance(container.get("raw"), dict) else {}
    remote_image = str(raw.get("remote-image") or container.get("image") or "")

    try:
        rollback_ref = CLIENT.resolve_rollback_image_reference(remote_image, str(raw.get("arch") or ""))
    except Exception as error:
        if strict:
            raise ValueError(f"Cannot create backup: {error}") from error
        return None

    pinned_image = str(rollback_ref.get("pinnedImage") or "")
    if not pinned_image:
        if strict:
            raise ValueError("Cannot create backup: rollback manifest digest is unavailable")
        return None

    state = read_rollback_state()
    current = state.get(container["name"]) if isinstance(state.get(container["name"]), dict) else {}
    snapshot = build_rollback_snapshot(container, remote_image, rollback_ref)

    if reason == "update":
        state[container["name"]] = {
            **current,
            "containerId": snapshot["containerId"],
            "containerName": snapshot["containerName"],
            "remoteImage": snapshot["remoteImage"],
            "rollbackType": snapshot["rollbackType"],
            "rollbackManifestDigest": snapshot["rollbackManifestDigest"],
            "pinnedImage": snapshot["pinnedImage"],
            "savedAt": snapshot["savedAt"],
            "backupSource": "update",
            "lastKnownGood": snapshot,
        }
    else:
        has_last_known_good = bool(
            isinstance(current.get("lastKnownGood"), dict) and current.get("lastKnownGood", {}).get("pinnedImage")
        )
        state[container["name"]] = {
            **current,
            "containerId": snapshot["containerId"],
            "containerName": snapshot["containerName"],
            "remoteImage": snapshot["remoteImage"],
            "manualBackup": snapshot,
        }
        if not has_last_known_good:
            state[container["name"]]["rollbackType"] = snapshot["rollbackType"]
            state[container["name"]]["rollbackManifestDigest"] = snapshot["rollbackManifestDigest"]
            state[container["name"]]["pinnedImage"] = snapshot["pinnedImage"]
            state[container["name"]]["savedAt"] = snapshot["savedAt"]
            state[container["name"]]["backupSource"] = "manual"

    write_rollback_state(state)
    effective = get_rollback_candidate_from_entry(state.get(container["name"]))
    return {
        **snapshot,
        "reason": reason,
        "activeForRollback": bool(effective and effective.get("pinnedImage") == snapshot["pinnedImage"]),
    }


def normalize_container(raw: Dict[str, Any]) -> Dict[str, Any]:
    container_id = str(raw.get(".id") or raw.get("id") or raw.get("number") or raw.get("numbers") or "")
    name = str(raw.get("name") or raw.get("comment") or raw.get("remote-image") or container_id)
    image = str(raw.get("remote-image") or raw.get("image") or raw.get("file") or "")

    status = "unknown"
    running_raw = str(raw.get("running") or "").lower()
    if raw.get("status"):
        status = str(raw.get("status"))
    elif running_raw in ("true", "1", "yes"):
        status = "running"
    elif running_raw in ("false", "0", "no"):
        status = "stopped"

    return {
        "id": container_id,
        "name": name,
        "status": status,
        "image": image,
        "created": str(raw.get("created") or ""),
        "raw": raw,
    }


def is_self_container(container: Dict[str, Any]) -> bool:
    name = str(container.get("name") or "").strip().lower()
    image = str(container.get("image") or "").strip().lower()
    if SELF_CONTAINER_NAME and name == SELF_CONTAINER_NAME:
        return True
    if SELF_IMAGE_HINT and SELF_IMAGE_HINT in image:
        return True
    return False


def action_from_param(value: str) -> Optional[str]:
    action = str(value or "").lower()
    if action in ("check", "backup", "update", "rollback"):
        return action
    return None


def fetch_normalized_containers() -> List[Dict[str, Any]]:
    containers = [normalize_container(item) for item in CLIENT.list_containers()]
    for container in containers:
        container["isSelf"] = is_self_container(container)
    return sorted(containers, key=lambda item: item["name"])


def run_version_rollback(container: Dict[str, Any], target_image_ref: str) -> Dict[str, Any]:
    target = str(target_image_ref or "").strip()
    if not target:
        raise ValueError("Missing rollback target image. Run check and pick a version from dropdown.")

    raw = container.get("raw") if isinstance(container.get("raw"), dict) else {}
    previous_image = str(raw.get("remote-image") or container.get("image") or "").strip()
    preferred_architecture = str(raw.get("arch") or "")
    tracking_image = previous_image

    rollback_ref = CLIENT.resolve_rollback_image_reference(target, preferred_architecture)
    pinned_target = str(rollback_ref.get("pinnedImage") or "").strip() or target

    if previous_image == pinned_target or previous_image == target:
        return {
            "mode": "version-rollback",
            "noop": True,
            "message": "Container already uses selected rollback image.",
            "rollbackImage": target,
            "rollbackPinnedImage": pinned_target,
            "previousImage": previous_image,
        }

    CLIENT.set_container_remote_image(container, pinned_target)
    try:
        update_result = CLIENT.run_container_action("update", container)
        tracking_restore_error = ""
        tracking_restored = False
        if tracking_image and tracking_image != pinned_target:
            try:
                CLIENT.set_container_remote_image(container, tracking_image)
                tracking_restored = True
            except Exception as restore_tag_error:
                tracking_restore_error = str(restore_tag_error)

        return {
            "mode": "version-rollback",
            "rollbackImage": target,
            "rollbackPinnedImage": pinned_target,
            "previousImage": previous_image,
            "trackingImage": tracking_image,
            "trackingImageRestored": tracking_restored,
            "trackingImageRestoreError": tracking_restore_error or None,
            "updateResult": update_result,
        }
    except Exception as rollback_error:
        restore_result = None
        restore_error = ""
        try:
            if previous_image:
                CLIENT.set_container_remote_image(container, previous_image)
                restore_result = CLIENT.run_container_action("update", container)
        except Exception as recovery_error:
            restore_error = str(recovery_error)

        friendly = ValueError(
            "Rollback target failed to apply. Previous image was restored automatically."
            if restore_result
            else "Rollback target failed and automatic restore also failed."
        )
        friendly.details = {
            "rollbackImage": target,
            "rollbackPinnedImage": pinned_target,
            "previousImage": previous_image,
            "rollbackError": str(rollback_error),
            "restored": bool(restore_result),
            "restoreError": restore_error or None,
        }
        raise friendly


def parse_json_body(handler: BaseHTTPRequestHandler) -> Dict[str, Any]:
    content_length = int(handler.headers.get("Content-Length") or "0")
    if content_length <= 0:
        return {}
    raw = handler.rfile.read(content_length).decode("utf-8")
    if not raw.strip():
        return {}
    data = json.loads(raw)
    if isinstance(data, dict):
        return data
    raise ValueError("Invalid JSON payload")


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: Dict[str, Any]) -> None:
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def detect_content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".html":
        return "text/html; charset=utf-8"
    if suffix == ".js":
        return "application/javascript; charset=utf-8"
    if suffix == ".css":
        return "text/css; charset=utf-8"
    if suffix == ".json":
        return "application/json; charset=utf-8"
    if suffix == ".svg":
        return "image/svg+xml"
    if suffix == ".png":
        return "image/png"
    if suffix in (".jpg", ".jpeg"):
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".ico":
        return "image/x-icon"
    return "application/octet-stream"


def resolve_static_path(raw_path: str) -> Optional[Path]:
    path_only = raw_path.split("?", 1)[0]
    if path_only == "/":
        return WWW_DIR / "index.html"

    candidate = (WWW_DIR / path_only.lstrip("/")).resolve()
    try:
        candidate.relative_to(WWW_DIR.resolve())
    except Exception:
        return None
    if candidate.is_dir():
        candidate = candidate / "index.html"
    return candidate


def run_single_action(action: str, container: Dict[str, Any], payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    request_payload = payload if isinstance(payload, dict) else {}

    if action == "check":
        return {
            "ok": True,
            "container": {"id": container["id"], "name": container["name"]},
            "result": CLIENT.check_container_image(container),
        }

    if action == "backup":
        backup = save_rollback_point(container, strict=True, reason="manual")
        return {
            "ok": True,
            "container": {"id": container["id"], "name": container["name"]},
            "result": {"mode": "custom-backup", **(backup or {})},
        }

    if action == "rollback":
        target_image_ref = str(request_payload.get("targetImageRef") or "")
        return {
            "ok": True,
            "container": {"id": container["id"], "name": container["name"]},
            "result": run_version_rollback(container, target_image_ref),
        }

    result = CLIENT.run_container_action(action, container)
    response_payload: Dict[str, Any] = {
        "ok": True,
        "container": {"id": container["id"], "name": container["name"]},
        "result": result,
    }
    return response_payload


class Handler(BaseHTTPRequestHandler):
    def _dispatch_api_get(self) -> bool:
        if self.path == "/api/health":
            containers = fetch_normalized_containers()
            json_response(
                self,
                200,
                {
                    "ok": True,
                    "connected": True,
                    "containerCount": len(containers),
                    "timestamp": now_iso(),
                },
            )
            return True

        if self.path == "/api/containers":
            containers = fetch_normalized_containers()
            json_response(self, 200, {"ok": True, "containers": containers})
            return True

        if self.path == "/api/settings.json":
            json_response(self, 200, {"ok": True, "settings": read_settings()})
            return True

        return False

    def _dispatch_api_post(self) -> bool:
        if self.path == "/api/settings":
            payload = parse_json_body(self)
            if not isinstance(payload, dict):
                json_response(self, 400, {"ok": False, "error": "Invalid settings payload"})
                return True
            patch: Dict[str, Any] = {}
            if "theme" in payload:
                patch["theme"] = payload.get("theme")
            if "theme_style" in payload:
                patch["theme_style"] = payload.get("theme_style")
            if "themeStyle" in payload:
                patch["theme_style"] = payload.get("themeStyle")

            settings = write_settings(patch)
            json_response(self, 200, {"ok": True, "settings": settings})
            return True

        match_single = re.match(r"^/api/containers/([^/]+)/actions/([^/]+)$", self.path)
        if match_single:
            body = parse_json_body(self)
            container_id = unquote(match_single.group(1))
            action = action_from_param(unquote(match_single.group(2)))
            if not action:
                json_response(self, 400, {"ok": False, "error": "Invalid action"})
                return True

            containers = fetch_normalized_containers()
            container = next((item for item in containers if item["id"] == container_id), None)
            if not container:
                json_response(self, 404, {"ok": False, "error": "Container not found"})
                return True

            try:
                result = run_single_action(action, container, payload=body)
                json_response(
                    self,
                    200,
                    {"ok": True, "action": action, "container": result["container"], "result": result["result"], **({"warning": result["warning"]} if "warning" in result else {})},
                )
                return True
            except Exception:
                raise

        match_bulk = re.match(r"^/api/containers/actions/([^/]+)$", self.path)
        if match_bulk:
            action = action_from_param(unquote(match_bulk.group(1)))
            if not action:
                json_response(self, 400, {"ok": False, "error": "Invalid action"})
                return True

            body = parse_json_body(self)
            container_ids = body.get("containerIds") if isinstance(body, dict) else None
            ids = [str(item) for item in container_ids] if isinstance(container_ids, list) else None
            rollback_targets = body.get("rollbackTargets") if isinstance(body, dict) else None
            rollback_targets = rollback_targets if isinstance(rollback_targets, dict) else {}

            containers = fetch_normalized_containers()
            targets = [c for c in containers if not ids or c["id"] in ids]

            results: List[Dict[str, Any]] = []
            for container in targets:
                try:
                    single_payload: Dict[str, Any] = {}
                    if action == "rollback":
                        single_payload["targetImageRef"] = str(rollback_targets.get(container["id"]) or "")
                    single = run_single_action(action, container, payload=single_payload)
                    row = {
                        "ok": True,
                        "container": single["container"],
                        "result": single["result"],
                    }
                    if "warning" in single:
                        row["warning"] = single["warning"]
                    results.append(row)
                except Exception as error:
                    results.append(
                        {
                            "ok": False,
                            "container": {"id": container["id"], "name": container["name"]},
                            "error": str(error),
                            "details": getattr(error, "details", None),
                        }
                    )

            success_count = len([entry for entry in results if entry.get("ok")])
            failed_count = len(results) - success_count
            json_response(
                self,
                200,
                {
                    "ok": failed_count == 0,
                    "action": action,
                    "total": len(results),
                    "successCount": success_count,
                    "failedCount": failed_count,
                    "results": results,
                },
            )
            return True

        return False

    def _serve_static(self) -> bool:
        path = resolve_static_path(self.path)
        if not path or not path.exists() or not path.is_file():
            return False
        content = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", detect_content_type(path))
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)
        return True

    def do_GET(self) -> None:
        try:
            if self._dispatch_api_get():
                return
            if self._serve_static():
                return
            self.send_error(404, "Not Found")
        except RouterOsRequestError as error:
            json_response(self, 502, {"ok": False, "error": str(error), "details": error.details or None})
        except Exception as error:
            json_response(self, 500, {"ok": False, "error": str(error) or "Unknown error"})

    def do_POST(self) -> None:
        try:
            if self._dispatch_api_post():
                return
            self.send_error(404, "Not Found")
        except json.JSONDecodeError:
            json_response(self, 400, {"ok": False, "error": "Invalid JSON payload"})
        except ApiUserError as error:
            json_response(self, error.status, {"ok": False, "error": str(error), "details": error.details})
        except RouterOsRequestError as error:
            json_response(self, 502, {"ok": False, "error": str(error), "details": error.details or None})
        except Exception as error:
            json_response(self, 500, {"ok": False, "error": str(error) or "Unknown error"})

    def log_message(self, format: str, *args: Any) -> None:
        # Keep logs concise and aligned with container logging.
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), Handler)
    print(f"Server started on http://0.0.0.0:{HTTP_PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
PY_SERVER

exec python3 /tmp/server.py
