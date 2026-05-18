FROM alpine:3.20
LABEL org.opencontainers.image.source="https://github.com/ovikiss/mikrotik-container-update-gui"

WORKDIR /app

RUN apk add --no-cache \
  python3 \
  tzdata

COPY app/ /app/

ENV HTTP_PORT=8090
ENV DATA_DIR=/data

RUN chmod +x /app/mcug.sh \
  && printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'exec /app/mcug.sh "$@"' \
    > /usr/local/bin/node \
  && chmod +x /usr/local/bin/node

EXPOSE 8090

ENTRYPOINT ["/app/mcug.sh"]
