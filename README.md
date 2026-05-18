# MikroTik Container Update GUI

Minimal web UI (Dockhand-style) pentru containere RouterOS.

Current release: `v0.3` (vezi `CHANGELOG.md`).

## Features

- Descoperă automat toate containerele din RouterOS REST.
- Acțiuni per container: `check`, `backup`, `update`, `rollback`.
- Bulk actions pentru containere selectate sau toate.
- `check` compară digest local vs registry.
- `backup` salvează manifest digest pullable (`repo@sha256:...`).
- `rollback` folosește backup-ul salvat (fallback custom când endpoint-ul native lipsește).
- Config și rollback state persistente pe USB (`/data` mount).

## Quick Install (RouterOS)

```bash
./scripts/install-to-router.sh admin@192.168.88.1
```

Scriptul:
1. Build + push `ghcr.io/ovikiss/mikrotik-container-update-gui:latest`
2. Upload + import `mikrotik/install.rsc`
3. Creează/actualizează containerul cu:
- env list minim (`mcug`)
- mount persistent `/usb1/mcug-data -> /data`
- o singură regulă NAT (`mcug-gui`)

UI:
- `http://192.168.88.1:8090/`

## Config (install.rsc)

Variabile uzuale în `mikrotik/install.rsc`:
- `mcugDataPath`, `mcugRootDir`, `mcugPullDir`
- `mcugHttpPort`, `mcugLanCidr`
- `mcugApiUser`, `mcugApiPassword`
- `mcugVeth`, `mcugBridge`, `mcugSubnet`

## Local Dev

```bash
cp .env.example .env
python3 src/server.py
```

If gateway auto-detect is not available on your host OS, set `ROUTEROS_BASE_URL` in `.env`.

Default local:
- [http://localhost:3030](http://localhost:3030)

## Notes

- Portul intern al imaginii este același cu `HTTP_PORT` din env (deploy default: `8090`).
- `ROUTEROS_BASE_URL` este opțional; dacă lipsește, se auto-detectează gateway-ul.
- Starea persistentă (`settings.json`, `rollback-state.json`) este în `/data`.
- Runtime-ul rulează dintr-un singur script: `/app/mcug.sh` (fără fișiere `.py` în repo).
