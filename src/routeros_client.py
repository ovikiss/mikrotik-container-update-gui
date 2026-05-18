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
            "rollback": {
                "method": str(config.get("rollbackMethod") or "POST").upper(),
                "pathTemplate": config.get("rollbackPath") or "/container/rollback",
                "sendTarget": bool_from_env(config.get("rollbackSendTarget"), True),
                "bodyTemplate": parse_json_env(config.get("rollbackBodyJson"), {}),
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

    def fetch_registry_manifest_with_auth(self, registry_url: str) -> Dict[str, Any]:
        accept_header = ", ".join(
            [
                "application/vnd.oci.image.manifest.v1+json",
                "application/vnd.docker.distribution.manifest.v2+json",
                "application/vnd.oci.image.index.v1+json",
                "application/vnd.docker.distribution.manifest.list.v2+json",
            ]
        )

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

        second_try = self.registry_fetch_json(
            registry_url,
            headers={"Accept": accept_header, "Authorization": f"Bearer {bearer_token}"},
        )
        second_response = second_try

        if not second_response["ok"]:
            raise ValueError(f"Registry request failed with HTTP {second_response['status']}")

        return second_try

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

        try:
            remote = self.resolve_remote_config_digest(str(remote_image_ref or ""), str(raw.get("arch") or ""))
            remote_normalized = remote.get("normalizedRemoteConfigDigest") or ""
            up_to_date = bool(
                normalized_local_image_id and remote_normalized and normalized_local_image_id == remote_normalized
            )
            return {
                "mode": "digest-compare",
                "upToDate": up_to_date,
                "localImageId": local_image_id,
                "remoteConfigDigest": remote.get("remoteConfigDigest"),
                "imageRef": remote.get("imageRef"),
            }
        except Exception as error:
            return {
                "mode": "digest-compare",
                "upToDate": None,
                "localImageId": local_image_id,
                "imageRef": str(remote_image_ref or ""),
                "warning": f"Digest check unavailable: {error}",
            }
