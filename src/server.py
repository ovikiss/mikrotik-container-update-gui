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
        "rollbackPath": os.getenv("ROUTEROS_ROLLBACK_PATH"),
        "rollbackMethod": os.getenv("ROUTEROS_ROLLBACK_METHOD"),
        "rollbackSendTarget": os.getenv("ROUTEROS_ROLLBACK_SEND_TARGET"),
        "rollbackBodyJson": os.getenv("ROUTEROS_ROLLBACK_BODY_JSON"),
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


def action_from_param(value: str) -> Optional[str]:
    action = str(value or "").lower()
    if action in ("check", "backup", "update", "rollback"):
        return action
    return None


def is_unsupported_action_error(action: str, error: Exception) -> bool:
    if not isinstance(error, RouterOsRequestError):
        return False
    if action != "rollback":
        return False
    detail = str((error.details or {}).get("data", {}).get("detail", "")).lower()
    return "no such command" in detail


def fetch_normalized_containers() -> List[Dict[str, Any]]:
    containers = [normalize_container(item) for item in CLIENT.list_containers()]
    rollback_state = read_rollback_state()
    merged: List[Dict[str, Any]] = []
    for container in containers:
        has_backup = bool(get_rollback_candidate_from_entry(rollback_state.get(container["name"])))
        merged.append({**container, "hasRollbackBackup": has_backup})
    return sorted(merged, key=lambda item: item["name"])


def run_custom_rollback(container: Dict[str, Any]) -> Dict[str, Any]:
    state = read_rollback_state()
    entry = state.get(container["name"])
    candidate = get_rollback_candidate_from_entry(entry)
    if not candidate or not candidate.get("pinnedImage"):
        raise ValueError("No rollback backup found for this container. Run update first.")

    if candidate.get("rollbackType") != "manifest-digest":
        raise ValueError("Rollback backup format is legacy and not pullable. Run Backup again before rollback.")

    raw = container.get("raw") if isinstance(container.get("raw"), dict) else {}
    previous_image = str(raw.get("remote-image") or container.get("image") or "")

    try:
        current_ref = CLIENT.resolve_rollback_image_reference(previous_image, str(raw.get("arch") or ""))
        if str(current_ref.get("pinnedImage") or "") == str(candidate.get("pinnedImage") or ""):
            return {
                "mode": "custom-digest-rollback",
                "noop": True,
                "message": "Container is already on the backup digest; rollback was skipped.",
                "rollbackImage": candidate.get("pinnedImage"),
                "backupSavedAt": candidate.get("savedAt") or "",
                "rollbackStrategy": candidate.get("strategy") or "unknown",
            }
    except Exception:
        pass

    CLIENT.set_container_remote_image(container, str(candidate.get("pinnedImage")))

    try:
        update_result = CLIENT.run_container_action("update", container)
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
            "Rollback image is unavailable in registry. Current image was restored automatically."
            if restore_result
            else "Rollback image is unavailable in registry, and automatic restore failed."
        )
        friendly.details = {
            "rollbackImage": candidate.get("pinnedImage"),
            "previousImage": previous_image,
            "rollbackError": str(rollback_error),
            "restored": bool(restore_result),
            "restoreError": restore_error or None,
            "rollbackStrategy": candidate.get("strategy") or "unknown",
        }
        raise friendly

    return {
        "mode": "custom-digest-rollback",
        "rollbackImage": candidate.get("pinnedImage"),
        "backupSavedAt": candidate.get("savedAt") or "",
        "rollbackStrategy": candidate.get("strategy") or "unknown",
        "updateResult": update_result,
    }


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


def run_single_action(action: str, container: Dict[str, Any]) -> Dict[str, Any]:
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

    warning = ""
    if action == "update":
        backup = save_rollback_point(container, reason="update")
        if not backup:
            warning = "Auto-backup skipped: rollback manifest digest is unavailable"

    result = CLIENT.run_container_action(action, container)
    payload: Dict[str, Any] = {
        "ok": True,
        "container": {"id": container["id"], "name": container["name"]},
        "result": result,
    }
    if warning:
        payload["warning"] = warning
    return payload


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
                result = run_single_action(action, container)
                json_response(
                    self,
                    200,
                    {"ok": True, "action": action, "container": result["container"], "result": result["result"], **({"warning": result["warning"]} if "warning" in result else {})},
                )
                return True
            except Exception as error:
                if is_unsupported_action_error(action, error):
                    if action == "rollback":
                        try:
                            custom_result = run_custom_rollback(container)
                            json_response(
                                self,
                                200,
                                {
                                    "ok": True,
                                    "action": action,
                                    "fallback": True,
                                    "message": "RouterOS rollback unsupported, used custom digest rollback",
                                    "container": {"id": container["id"], "name": container["name"]},
                                    "result": custom_result,
                                },
                            )
                            return True
                        except Exception as fallback_error:
                            json_response(
                                self,
                                400,
                                {
                                    "ok": False,
                                    "action": action,
                                    "error": str(fallback_error),
                                    "container": {"id": container["id"], "name": container["name"]},
                                    "details": getattr(fallback_error, "details", None)
                                    or getattr(error, "details", None),
                                },
                            )
                            return True

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

            containers = fetch_normalized_containers()
            targets = [c for c in containers if not ids or c["id"] in ids]

            results: List[Dict[str, Any]] = []
            for container in targets:
                try:
                    single = run_single_action(action, container)
                    row = {
                        "ok": True,
                        "container": single["container"],
                        "result": single["result"],
                    }
                    if "warning" in single:
                        row["warning"] = single["warning"]
                    results.append(row)
                except Exception as error:
                    if is_unsupported_action_error(action, error):
                        if action == "rollback":
                            try:
                                custom_result = run_custom_rollback(container)
                                results.append(
                                    {
                                        "ok": True,
                                        "fallback": True,
                                        "container": {"id": container["id"], "name": container["name"]},
                                        "message": "RouterOS rollback unsupported, used custom digest rollback",
                                        "result": custom_result,
                                    }
                                )
                                continue
                            except Exception as fallback_error:
                                results.append(
                                    {
                                        "ok": False,
                                        "container": {"id": container["id"], "name": container["name"]},
                                        "error": str(fallback_error),
                                        "details": getattr(fallback_error, "details", None)
                                        or getattr(error, "details", None),
                                    }
                                )
                                continue

                        results.append(
                            {
                                "ok": True,
                                "unsupported": True,
                                "container": {"id": container["id"], "name": container["name"]},
                                "message": f"Action '{action}' is not supported by this RouterOS REST build",
                                "details": getattr(error, "details", None),
                            }
                        )
                        continue

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
