# Changelog

## v0.5.2 - 2026-06-04

- **Shared header baseline alignment refined.**
  The universal header now aligns the project title text on the same lower baseline across `Modern`, `Classic`, and `Glass`, keeping `Container Update GUI` and `Traffic Monitor` visually consistent with the MikroTik wordmark.

## v0.5.1 - 2026-06-04

- **Dynamic header version badge.**
  The shared header now shows a small, subtle version label beside the branding text.
- **Build-driven version reporting.**
  MCUG injects its current app version into branding responses at runtime from the Go binary, so future upgrades automatically show the active release without editing JSON files.

## v0.5.0 - 2026-06-04

- **Shared UI system finalized for release alignment.**
  MCUG now consumes the shared header, menus, translations, logos, and theme assets from `mikrotik-ui-shared` in the same way as Traffic Monitor.
- **Glass theme layout refined.**
  Container table proportions, image wrapping, and row action spacing were tightened so Glass behaves much closer to Modern and Classic without the previous scroll-heavy layout.
- **Activity feed readability improved.**
  Large action payloads are now summarized into readable result blocks instead of dumping raw JSON walls directly into the table cell.
- **Release documentation refreshed.**
  README and release notes were rewritten to match the Go runtime, shared UI pipeline, current install flow, and version dropdown behavior.

## v0.4.17 - 2026-05-28

- **Shared theme sync extended for future themes.**
  Build pipeline now copies the full shared CSS folder from `ovikiss/mikrotik-ui-shared`, not only `modern` and `classic`.
- **Glass theme support enabled end-to-end.**
  `theme_style=glass` is now accepted by backend validation and persisted correctly.
- **Theme stylesheet path normalized.**
  Default UI theme stylesheet link now uses the shared naming convention (`/style-modern.css`) so runtime and shared assets stay aligned.

## v0.4.16 - 2026-05-28

- **CI fix for GHCR tag builds.**
  Fixed a workflow shell parsing issue in `docker-publish.yml` caused by a stray backtick/newline sequence in the shared UI sync step.
- **Build reliability restored.**
  Tag-triggered Docker publish to GHCR now runs correctly again for `v*` tags.

## v0.4.9 - 2026-05-27

- **Fix: incorrect container status detection during update/pull.**
  RouterOS REST API returns `"downloading/extracting": "true"` and `"stopped": "true"` properties instead of a `"status"` key. Because of this, the extraction wait loop was immediately breaking after 2 seconds (falling back to `"unknown"` status), triggering `/container/start` prematurely while extraction was still in progress.
- **Improved status mapping:**
  - Added detection of the `"downloading/extracting"` field to map status to `"extracting"`.
  - Added detection of the `"stopped"` field to map status to `"stopped"`.
- **Improved UI and extraction waiting:**
  - The UI now correctly shows the `"extracting"` status in real-time during image pull.
  - The graceful stop wait check is now extremely fast and doesn't timeout since the `"stopped"` status is parsed instantly.
  - The Go update process now reliably waits for extraction to finish before calling `/container/start`.

## v0.4.8 - 2026-05-27

- **Fix: container disappears after update (add fails silently with wrong payload).**
  RouterOS REST API returns many read-only and runtime fields that `/container/add`
  simply rejects — causing the re-add step to fail and leaving the container deleted:
  `os`, `arch`, `shm-size` (in bytes), `stop-signal` (as `"15-SIGTERM"`), `stop-time`,
  `auto-restart-interval`, `memory-high`, `running`, `memory-current`, `cpu-usage`,
  `tag`, `image-id`, `layers`, `layer-dir`, all `default-healthcheck-*` fields.
- Replaced the "copy everything minus skip-list" approach with a **strict whitelist**
  of only the fields `/container/add` actually accepts:
  - Required: `name`, `remote-image`, `interface`
  - Optional: `dns`, `root-dir`, `envlists`, `mountlists`, `workdir`, `hostname`,
    `entrypoint`, `cmd`, `tmpfs`, `devices`, `cpu-list`, `hosts`, `domain-name`,
    `start-on-boot`, `logging`, `check-certificate`
- Added payload logging (`[Repull] Add payload`) to aid future debugging.

## v0.4.7 - 2026-05-27

- **Fix: update hangs indefinitely (timeout) when reading container config.**
  `GetContainerConfig` used `GET /container/*B1` which RouterOS REST API does
  not support — the request hangs until timeout, blocking the entire update.
- Replaced with an inline lookup via `ListContainers` (GET `/container`) which
  works correctly, filtering the result by container ID.
- Removed the broken `GetContainerConfig` method from the RouterOS client.

## v0.4.6 - 2026-05-27

- **Fix: update/rollback installs old image when tag stays the same (e.g. `latest`).**
  RouterOS caches container images locally and does NOT re-pull from the registry
  when `remote-image` keeps the same tag. The previous `set remote-image + start`
  approach just restarted the container with the cached (old) filesystem.
- Replaced the update/rollback mechanism with **force-repull via remove + add**:
  1. Read the full container config from RouterOS before touching anything.
  2. Stop the container gracefully (max 15s + 2s flush for SQLite safety).
  3. Remove the container (with retries, up to 10 attempts).
  4. Re-add the container with the same config + new `remote-image` → RouterOS
     is forced to do a fresh pull from the registry.
  5. Poll until the `extracting` state finishes (up to 5 min for large images).
  6. Start the container only after the new image is fully written to disk.
- Added `RemoveContainer`, `GetContainerConfig`, and `AddContainer` methods
  to the RouterOS REST client.
- Applied to both `update` and `rollback` code paths.

## v0.4.5 - 2026-05-26

- Enabled `Update` action for `container-update-gui` (self container) in UI.
- Removed backend block for self `update`; self `backup` and `rollback` remain blocked for safety.
- Kept existing one-click lock behavior, so `Update` button hides after click until next `Check`.

## v0.4.4 - 2026-05-26

- Fixed bulk `Update selected/all` to honor each row's selected dropdown target (`stable`/`latest`/`v*`) in the same way as single-row update.
- Fixed backend bulk action result handling to avoid malformed append behavior and return proper per-container error rows.
- Hardened update image reference parsing to avoid panic when RouterOS container fields are missing/unexpected.

## v0.4.3 - 2026-05-26

- **Fix: container exits with status 127 after update/rollback.**
  The previous implementation issued a `/container/start` command 2 seconds after changing
  `remote-image`, racing against RouterOS's image pull. If the pull had not finished, RouterOS
  started the container with an incomplete filesystem, causing the entrypoint binary to be
  missing and the container to immediately exit with code 127.
- Replaced the naive 2-second delay with a proper `waitForPullThenStart` helper that:
  1. Triggers `start` to begin the RouterOS pull pipeline.
  2. Polls container status for up to 10 seconds waiting for the `extracting`/`pulling` state.
  3. Once extracting, polls every 2 seconds until the container leaves the extracting state
     (up to 5 minutes for large images).
  4. Issues a final `start` only after the image is fully extracted.
- Applied to both `update` and `rollback` code paths.

## v0.4.2 - 2026-05-26

- Fix CI/CD and Docker build failure by setting Go version compatibility in `go.mod` to Go 1.22 (aligning with build environment).

## v0.4.1 - 2026-05-26

- Hardened the container update and rollback lifecycle with graceful stop-and-start orchestration.
- Prevent SQLite database locking on slow/embedded storage systems by enforcing explicit container stop, wait, and file sync delays before setting new images and starting up.

## v0.4.0 - 2026-05-26

- Migrated backend completely from Python to Go for ultra-low container footprint.
- Zero external Go dependencies (standard library only) and no external Python runtime required.
- Native asset embedding using `go:embed` to package static assets (`app/www/`) inside a single Go binary.
- RAM usage reduced by ~6x (from ~25MB to **~3-5MB**), freeing valuable resources on MikroTik devices.
- Image size reduced by ~5x (from ~75MB to **~15MB**), saving storage space.
- Fully compatible REST API endpoints and settings schema, ensuring 100% transparent frontend integration.

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
  - `app/www/style-modern.css`
  - `app/www/style-classic.css`
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
