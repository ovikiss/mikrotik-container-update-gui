# MikroTik Container Update GUI

Containerized Dockhand-style web UI for RouterOS container update and rollback management.

Current release: `v0.3` (see `CHANGELOG.md`).

## Features
- Auto-discovers all containers from RouterOS REST API.
- Per-container actions: `check`, `backup`, `update`, `rollback`.
- Bulk actions: `Check selected/all`, `Update selected/all`.
- `check` uses digest comparison (local vs registry).
- `update` stores an automatic pre-update backup (`lastKnownGood`).
- `rollback` uses persistent backup logic (without relying on RouterOS `/container/rollback`).
- Universal rollback version policy for all images:
- always shows the current configured tag first (`latest`, `stable`, or pinned tag)
- then appends the newest 3 semantic `v*` tags
- Theme selector: `Modern` / `Classic`.
- Style selector: `Auto` / `Light` / `Dark`.
- UI settings and rollback state persist in `/data`.

## Repository Structure
- `app/mcug.sh` - runtime entrypoint (single-script runtime, embedded Python).
- `app/www/index.html` - UI shell.
- `app/www/app.js` - frontend actions, dropdowns, and settings persistence.
- `app/www/styles-modern.css` - Modern theme.
- `app/www/styles-classic.css` - Classic theme.
- `app/www/images/ui/*.svg` - UI icons.
- `app/settings.json` - default app settings.
- `mikrotik/install.rsc` - RouterOS install/deploy script.
- `scripts/install-to-router.sh` - helper for build/push and router import.
- `.github/workflows/ci.yml` - syntax and Docker build checks.
- `.github/workflows/docker-publish.yml` - multi-arch GHCR publish workflow.
- `.github/workflows/housekeeping.yml` - cleanup workflow for old runs/images.

## Build Locally
```bash
docker build -t ghcr.io/ovikiss/mikrotik-container-update-gui:local .
```

## Run Locally
```bash
docker run --rm -p 8090:8090 \
  -e HTTP_PORT=8090 \
  -e ROUTEROS_USERNAME=container-updater \
  -e ROUTEROS_PASSWORD=ChangeMe \
  -e DATA_DIR=/data \
  -v "$PWD/data:/data" \
  ghcr.io/ovikiss/mikrotik-container-update-gui:local
```

## Install on MikroTik
1. Edit top variables in `mikrotik/install.rsc`:
- `mcugImage` (default `ghcr.io/ovikiss/mikrotik-container-update-gui:latest`)
- `mcugDataPath` (default `/usb1/mcug-data`)
- `mcugRootDir` (default `/usb1/containers/container-update-gui`)
- `mcugHttpPort` (default `8090`)
- `mcugApiUser` / `mcugApiPassword`

2. Run helper:
```bash
./scripts/install-to-router.sh admin@192.168.88.1
```

Manual alternative:
```bash
scp mikrotik/install.rsc admin@192.168.88.1:install-container-update-gui.rsc
ssh admin@192.168.88.1 '/import file-name=install-container-update-gui.rsc'
```

UI endpoint:
- `http://<router-lan-ip>:8090/`

## Notes
- Runtime is delivered as a single script: `/app/mcug.sh` (no Node.js runtime files required in repo).
- `ROUTEROS_BASE_URL` is optional; if empty, the app auto-detects the container default gateway.
- Docker Hub tag listing has a dedicated fallback to reliably include `v*` tags when `/v2/.../tags/list` is incomplete.
- Persistent state (`settings.json`, `rollback-state.json`) lives in `/data` (recommended on USB storage).

## Trademark Notice
- MikroTik name and logo are official trademarks of MikroTik.
