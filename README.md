# MikroTik Container Update GUI

Containerized Dockhand-style web UI for RouterOS container update and rollback management.

Current release: see `CHANGELOG.md`.

## Features
- Auto-discovers all containers from RouterOS REST API.
- Per-container actions: `check`, `backup`, `update`, `rollback`.
- Bulk actions: `Check selected/all`, `Update selected/all`.
- `check` uses digest comparison (local vs registry).
- `update` stores an automatic pre-update backup (`lastKnownGood`).
- `rollback` uses persistent backup logic (without relying on RouterOS `/container/rollback`).
- MCUG self-protection:
- `container-update-gui` cannot `update`/`rollback`/`backup` itself from the same UI session
- use `mikrotik/install.rsc` (or helper script) for MCUG upgrades
- Universal rollback/version dropdown policy:
- always includes `latest` and `stable` when available in registry
- always appends newest `3 x v*` semantic tags
- for `latest`/`stable` entries, UI label includes resolved version (example: `stable (v1.96.5)`)
- Channel switch support:
- selecting `stable`/`latest` and pressing `Update` switches container tracking channel
- Rollback channel tracking behavior:
- when container is on `stable` or `latest` and rollback target is a fixed `v*`, rollback applies that version but keeps original channel tag
- when rollback target is explicitly `stable` or `latest`, container tracking changes to that selected channel
- Bulk update UX:
- Dockhand-style `Update all` button states (`pending`, `ready`, `empty`, `selected`)
- manual row selection updates the button label/count live (`Update selected (N)`)
- after `Check`, rows with `update available` are auto-selected
- Transient update reconnect handling:
- if UI sees `Failed to fetch` during update, it treats it as a reconnect event, waits briefly, and refreshes container status instead of showing hard failure
- Theme selector: `Modern` / `Classic`.
- Style selector: `Auto` / `Light` / `Dark`.
- UI settings and rollback state persist in `/data`.

## Repository Structure
- `main.go` - Entrypoint for Go backend (serves API and embeds `app/www/*` assets).
- `app/www/index.html` - UI shell.
- `app/www/app.js` - frontend actions, dropdowns, and settings persistence.
- `app/www/style-modern.css` - Modern theme.
- `app/www/style-classic.css` - Classic theme.
- `app/www/images/ui/*.svg` - UI icons.
- `mikrotik/install.rsc` - RouterOS install/deploy script.
- `scripts/install-to-router.sh` - helper for build/push and router import.
- `.github/workflows/ci.yml` - syntax and Docker build checks.
- `.github/workflows/docker-publish.yml` - multi-arch GHCR publish workflow.
- `.github/workflows/docker-publish.yml` - syncs latest shared UI from `ovikiss/mikrotik-ui-shared` before Docker build (automatic, no local sync script).
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
- `mcugVeth` (default `veth-mcug`)
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
- Runtime is delivered as a single compiled Go binary (no external runtime files required, static files embedded).
- `ROUTEROS_BASE_URL` is optional; if empty, the app auto-detects the container default gateway.
- Docker Hub tag listing has a dedicated fallback to reliably include `v*` tags when `/v2/.../tags/list` is incomplete.
- Registry tag listing also uses pagination (`Link rel=next`) for high-tag repositories.
- RouterOS install script ensures NAT rule `mcug-gui` exists and is updated (create-or-update behavior).
- `mcug-gui` NAT `to-addresses` is derived from the runtime `veth` container IP.
- Persistent state (`settings.json`, `rollback-state.json`) lives in `/data` (recommended on USB storage).

## Trademark Notice
- MikroTik name and logo are official trademarks of MikroTik.

