# MikroTik Container Update GUI

MikroTik Container Update GUI is a lightweight Go web application for RouterOS container lifecycle management. It auto-discovers your RouterOS containers, checks registry digests, offers safe update flows, and keeps rollback targets persistent on disk.

Current release: `v0.5.1`

## Highlights
- Auto-discovers all RouterOS containers through the REST API.
- Per-container actions: `Check`, `Update`, `Rollback`.
- Bulk actions: `Check selected/all`, `Update selected/all`.
- Digest-based update detection between the running local image and the remote registry tag.
- Persistent rollback targets stored in `/data`, without depending on RouterOS native `/container/rollback`.
- Universal version dropdown policy:
  - includes the active channel tag such as `latest` or `stable`
  - adds the other channel when available
  - appends the newest `3 x v*` semantic tags
  - shows resolved labels like `latest (v0.5.0)` or `stable (v1.98.4)`
- Channel-aware updates and rollbacks:
  - switching from `stable` to `latest` or back is handled through the same `Update` action
  - rolling back to a fixed `v*` keeps the original channel when the container tracks `latest` or `stable`
  - rolling back to `latest` or `stable` explicitly changes the tracked channel
- Dockhand-style bulk update UX:
  - rows with available updates are auto-selected after `Check`
  - manual selection updates the bulk action label live
  - one-click action locking prevents accidental double update or double rollback
- Shared UI system via `mikrotik-ui-shared`:
  - shared header, menus, logos, theme assets, translations, and CSS
  - dynamic theme catalog support for future shared themes
  - consistent `Modern`, `Classic`, and `Glass` styling
- Activity table with readable summaries instead of raw JSON walls.
- Settings and rollback state persist in `/data`.

## Architecture
- `main.go`
  Go backend serving the RouterOS API bridge and the embedded web app.
- `app/www/index.html`
  UI shell for the shared dashboard layout.
- `app/www/app.js`
  Project-specific frontend logic for container actions, activity rendering, and settings persistence.
- `scripts/sync-ui-shared.sh`
  Pulls shared UI assets from `mikrotik-ui-shared` during local prep or Docker builds.
- `mikrotik/install.rsc`
  RouterOS install script for first deploy or clean reinstall.
- `scripts/install-to-router.sh`
  Helper that builds, pushes, uploads, imports, and cleans old install scripts on the router.

## Local Build
```bash
docker build -t ghcr.io/ovikiss/mikrotik-container-update-gui:local .
```

The Docker build automatically syncs the current shared UI assets. For local non-Docker development, run:

```bash
./scripts/sync-ui-shared.sh
```

## Local Run
```bash
docker run --rm -p 8090:8090 \
  -e HTTP_PORT=8090 \
  -e ROUTEROS_USERNAME=container-updater \
  -e ROUTEROS_PASSWORD=ChangeMe \
  -e DATA_DIR=/data \
  -v "$PWD/data:/data" \
  ghcr.io/ovikiss/mikrotik-container-update-gui:local
```

## MikroTik Install
1. Edit the variables at the top of `mikrotik/install.rsc`:
   - `mcugImage`
   - `mcugDataPath`
   - `mcugRootDir`
   - `mcugHttpPort`
   - `mcugVeth`
   - `mcugApiUser`
   - `mcugApiPassword`
2. Run the helper:

```bash
./scripts/install-to-router.sh admin@192.168.88.1
```

Manual alternative:

```bash
scp mikrotik/install.rsc admin@192.168.88.1:install-container-update-gui.rsc
ssh admin@192.168.88.1 '/import file-name=install-container-update-gui.rsc'
```

Default UI endpoint:
- `http://<router-lan-ip>:8090/`

## Runtime Notes
- Runtime is a single compiled Go binary with embedded static assets.
- `ROUTEROS_BASE_URL` is optional; when omitted, the app auto-detects the container default gateway.
- Registry tag discovery supports pagination and Docker Hub fallback logic so `stable`, `latest`, and `v*` tags stay visible.
- Transient `Failed to fetch` during update is treated as a reconnect event and followed by an automatic refresh instead of a hard UI failure.
- The install script manages a single NAT rule with comment `mcug-gui` and removes older legacy rules automatically.
- Persistent state such as `settings.json` and rollback metadata lives in `/data`, ideally on USB storage.

## Trademark Notice
MikroTik name and logo are official trademarks of MikroTik.
