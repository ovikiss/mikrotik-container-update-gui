# MikroTik Container Update GUI

Minimal web UI (Dockhand-style) for MikroTik RouterOS containers.

What it does:
- Lists all containers dynamically from RouterOS REST API.
- Works automatically with new containers added later.
- Per-container actions: `check`, `update`, `rollback`.
- Bulk actions for all or selected containers.
- Activity log in UI.

## Requirements

- Node.js 18+
- RouterOS v7 with REST API enabled (`www` or `www-ssl` service)
- User account with enough rights to read `/container` and execute container actions

## Quick start

```bash
npm install
cp .env.example .env
npm start
```

Open:
- [http://localhost:3030](http://localhost:3030)

## Configuration

Edit `.env`:

- `ROUTEROS_BASE_URL`: Router address, ex `https://192.168.88.1`
- `ROUTEROS_USERNAME` / `ROUTEROS_PASSWORD`
- `ROUTEROS_ALLOW_INSECURE_TLS=true` if router uses self-signed cert

Action endpoints are configurable because RouterOS versions can differ:
- `ROUTEROS_CHECK_PATH`
- `ROUTEROS_UPDATE_PATH`
- `ROUTEROS_ROLLBACK_PATH`

By default, app sends the container ID in POST body using:
- `ROUTEROS_ACTION_TARGET_FIELD=number`

If your RouterOS expects different payload or path, adjust:
- `ROUTEROS_*_SEND_TARGET`
- `ROUTEROS_*_BODY_JSON`
- `ROUTEROS_*_METHOD`

## GitHub publish

If local repo is already initialized:

```bash
git remote add origin https://github.com/ovikiss/mikrotik-container-update-gui.git
git add .
git commit -m "Initial MikroTik container update GUI"
git branch -M main
git push -u origin main
```

## Notes

- UI discovers all containers every refresh, so future containers are included automatically.
- Some RouterOS builds expose container commands differently in REST. If an action fails, check RouterOS logs/API path and update the corresponding env variable.
