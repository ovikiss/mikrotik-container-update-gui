# Changelog

## v0.2 - 2026-05-18

- UI update aligned with `mikrotik-traffic-monitor` look and controls.
- Added two UI dropdowns:
  - `Theme`: `Modern` / `Classic`
  - `Style`: `Light` / `Dark`
- Added split stylesheets:
  - `app/www/styles-modern.css`
  - `app/www/styles-classic.css`
- Frontend structure migrated from `public/` to `app/www/` (traffic-monitor layout style).
- Backend container status normalization improved:
  - uses `status` when available
  - falls back to `running=true/false` -> `running/stopped`
- RouterOS deploy/install flow hardened (safe stop/wait/remove before redeploy).
- RouterOS target payload field is automatic (`.id`) without manual env var.
- Added explicit `Backup` action (single + bulk) to create rollback points manually.
- `Update` now attempts automatic backup before update and reports warning if `image-id` is unavailable.
- Rollback buttons are disabled until a backup exists for that container.
- Custom rollback fallback via pinned digest is used when RouterOS native `/container/rollback` is unavailable.
- Backup/rollback now use pullable manifest digests (`repo@sha256:<manifest>`), not config digests.
- Legacy rollback backups are rejected with a clear message and require a fresh `Backup`.
- Rollback auto-recovers the previous `remote-image` if the backup digest is unavailable.
- Persistent app state moved to `/data` mount (`usb1`) so settings and rollback backups survive redeploy.

## v0.1 - 2026-05-17

- Initial container update GUI release.
- RouterOS container install script and GHCR-based deploy workflow.
- Digest-based update check fallback for RouterOS builds without `check-for-updates`.
