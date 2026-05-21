# Changelog

## v0.3.1 - 2026-05-22

- Safety guard for MCUG self-management:
  - `update`/`rollback`/`backup` are blocked for `container-update-gui` from inside MCUG UI/API.
  - prevents self-restart corruption scenarios during in-place container repull.
- Update no-op protection:
  - `update` is skipped when digest check reports already up-to-date and no channel switch is requested.
  - avoids RouterOS same-version import edge cases on repeated update clicks.
- UI behavior:
  - MCUG row no longer exposes `Update`/`Rollback` actions.
  - MCUG container is excluded from auto-selection and bulk update eligibility.

## v0.3 - 2026-05-18

- Runtime migrated from Node.js to Python for lower container footprint.
- Runtime packaged traffic-monitor style in a single `/app/mcug.sh` script (Python embedded, no `.py` files in repo).
- Added compatibility shim for existing RouterOS configs that still start with `node src/server.js`.
- Cleaned up repository by removing legacy Node runtime sources and npm manifests no longer needed by the current image.
- README rewritten and aligned with current runtime/deploy behavior.
- Internal container port aligned with env-driven port (`HTTP_PORT`, image default `8090`).
- Added `DATA_DIR` to `.env.example`.
- Rollback/version dropdown policy upgraded:
  - includes `latest` + `stable` (when available) + newest `3 x v*` tags
  - `latest`/`stable` entries display resolved version labels (example: `stable (v1.96.5)`)
- Docker Hub tag discovery hardened:
  - fallback to Hub tags API when registry `/v2/.../tags/list` is empty or missing enough `v*` tags
  - registry pagination support (`Link rel=next`) for high-tag repositories (for example `tailscale`)
  - TLS certificate verify fallback retry for environments with incomplete CA bundle
- Rollback hardening:
  - If rollback target digest is already running, action is skipped (`no-op`) to avoid RouterOS `skip importing same version` breakage.
  - Prevents accidental container corruption on immediate `backup -> rollback` with no update in between.
- Backup model refined for updates:
  - `update` now stores a dedicated `lastKnownGood` snapshot (the version before update).
  - manual `backup` no longer overrides `lastKnownGood`.
  - `rollback` prefers `lastKnownGood` (exactly the previous functional version), then falls back to manual backup.
- Channel switch + rollback behavior refinements:
  - `Update` supports channel switch (`stable` <-> `latest`) when selected from dropdown
  - if container currently tracks `stable`/`latest` and rollback target is fixed `v*`, rollback applies fixed version but keeps original tracking channel
  - if rollback target is explicitly `stable`/`latest`, tracking channel changes to selected target
- UI/UX updates:
  - Dockhand-style bulk update button with dynamic states (`pending`, `ready`, `empty`, `selected`)
  - manual selection updates bulk button count live (`Update selected (N)`)
  - rows with `update available` are auto-selected after check
  - one-click lock behavior for row update/rollback (hidden after click, unlocked by next check)
  - transient `Failed to fetch` during update is treated as reconnect and auto-refresh, not hard failure
  - update operations now skip non-eligible manual selections to prevent RouterOS-side failures
  - consistent bulk update button state styling in both `Modern` and `Classic` themes
- RouterOS install script hardening:
  - `mcug-gui` NAT rule is now create-or-update (ensures rule exists if missing)
  - NAT `to-addresses` derives from runtime `veth` container host IP
  - fixed runtime IP parsing to avoid prefix-form `to-addresses`
  - removed redundant `VETH` env key (veth is managed directly by install script)

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
