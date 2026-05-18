# MikroTik Container Update GUI

Minimal web UI (Dockhand-style) for MikroTik RouterOS containers.

Current release: `v0.2` (see `CHANGELOG.md`).

What it does:
- Lists all containers dynamically from RouterOS REST API.
- Works automatically with new containers added later.
- Per-container actions: `check`, `backup`, `update`, `rollback`.
- Bulk actions for all or selected containers.
- Activity log in UI.
- `check` uses digest/hash compare (`image-id` local vs registry digest), and never crashes UI if registry lookup is unavailable.
- `backup` pins the current running manifest digest (`repo@sha256:...`) for exact rollback when RouterOS native rollback endpoint is missing.

## Run mode

This project is now designed to run as a **container on RouterOS**.
All RouterOS API config is injected via `/container envs` in `mikrotik/install.rsc`.

## Requirements

- RouterOS v7 with `container` package enabled
- External storage (recommended `usb1`) for image/root-dir/tmpdir
- SSH/SCP access to router (`admin@192.168.88.1` by default)
- Docker with buildx on your local machine

## Install on MikroTik

One command (build image, push to GHCR, import install script):

```bash
./scripts/install-to-router.sh admin@192.168.88.1
```

This script will:
1. Build `linux/arm/v7` image locally.
2. Push image to `ghcr.io/ovikiss/mikrotik-container-update-gui:latest`.
3. Upload/import `mikrotik/install.rsc`.
4. Create/update RouterOS container + persistent `/data` mount on `usb1` (settings + rollback state) + one firewall rule for LAN access (`mcug-gui`) and remove legacy `mcug-egress`/`mcug-forward` rules.

After install, open:
- `http://192.168.88.1:8090/`

## Configure before install

Edit variables at top of `mikrotik/install.rsc` if needed:
- network/veth/bridge values (`mcugVeth`, `mcugBridge`, `mcugSubnet`)
- storage paths (`mcugDataPath`, `mcugRootDir`, `mcugPullDir`)
- UI port/NAT (`mcugHttpPort`, `mcugLanCidr`)
- RouterOS API user/password (`mcugApiUser`, `mcugApiPassword`)

## Local dev mode (optional)

You can still run locally with `.env`:

```bash
npm install
cp .env.example .env
npm start
```

Open:
- [http://localhost:3030](http://localhost:3030)

## Notes

- RouterOS service `www` is enabled for internal REST calls from the container network.
- `ROUTEROS_BASE_URL` is optional; when missing, app auto-detects router gateway from `/proc/net/route` (defaulting to `http://<gateway>`).
- Persistent app state (`settings.json`, `rollback-state.json`) is stored under `/data` and mapped to `usb1` via `mountlists="mcug"`.
- On RouterOS v7.22, REST update works with container `".id"` payload (selected automatically); `check-for-updates` is not exposed, so digest compare is used instead.
