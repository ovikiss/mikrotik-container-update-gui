FROM alpine:3.20
LABEL org.opencontainers.image.source="https://github.com/ovikiss/mikrotik-container-update-gui"

WORKDIR /app

RUN apk add --no-cache \
  python3 \
  tzdata

COPY src ./src
COPY app ./app

ENV HTTP_PORT=8090
ENV DATA_DIR=/data

RUN chmod +x /app/mcug.sh \
  && printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'if [ "${1:-}" = "src/server.js" ] || [ "${1:-}" = "/app/src/server.js" ] || [ $# -eq 0 ]; then' \
    '  [ $# -gt 0 ] && shift || true' \
    '  exec python3 /app/src/server.py "$@"' \
    'fi' \
    'echo "node compatibility shim: forwarding to python server" >&2' \
    'exec python3 /app/src/server.py "$@"' \
    > /usr/local/bin/node \
  && chmod +x /usr/local/bin/node

EXPOSE 8090

ENTRYPOINT ["/app/mcug.sh"]
