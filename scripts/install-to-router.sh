#!/usr/bin/env bash
set -euo pipefail

ROUTER="${1:-admin@192.168.88.1}"
RSC_LOCAL="mikrotik/install.rsc"
RSC_REMOTE="install-container-update-gui.rsc"

if [[ ! -f "$RSC_LOCAL" ]]; then
  echo "Missing $RSC_LOCAL"
  exit 1
fi

echo "Uploading $RSC_LOCAL to $ROUTER:$RSC_REMOTE"
scp "$RSC_LOCAL" "$ROUTER:$RSC_REMOTE"

echo "Importing script on router"
ssh "$ROUTER" "/import file-name=$RSC_REMOTE"

echo "Done. Next: configure .env and run npm start"
