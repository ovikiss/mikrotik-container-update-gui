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

## v0.1 - 2026-05-17

- Initial container update GUI release.
- RouterOS container install script and GHCR-based deploy workflow.
- Digest-based update check fallback for RouterOS builds without `check-for-updates`.
