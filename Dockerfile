# Stage 1: Build the Go application
FROM golang:1.22-alpine AS builder

WORKDIR /build
RUN apk add --no-cache git

# Copy go.mod and download dependencies (if any)
COPY go.mod ./
# RUN go mod download

# Copy the rest of the source code and static assets
COPY . .

ARG UI_SHARED_REPO=https://github.com/ovikiss/mikrotik-ui-shared.git
ARG UI_SHARED_REF=main
ARG UI_SHARED_REV=unknown
RUN UI_SHARED_REPO="$UI_SHARED_REPO" UI_SHARED_REF="$UI_SHARED_REF" UI_SHARED_REV="$UI_SHARED_REV" sh scripts/sync-ui-shared.sh

# Build the Go application statically
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o mcug main.go

# Stage 2: Create a minimal runtime image
FROM alpine:3.20

LABEL org.opencontainers.image.source="https://github.com/ovikiss/mikrotik-container-update-gui"

# Install tzdata for timezone management and ca-certificates for secure registry communication
RUN apk add --no-cache tzdata ca-certificates

WORKDIR /app

# Copy the compiled binary from the builder stage
COPY --from=builder /build/mcug /app/mcug

ENV HTTP_PORT=8090
ENV DATA_DIR=/data

# Keep the legacy node wrapper script just in case RouterOS environments depend on it
RUN printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'exec /app/mcug "$@"' \
    > /usr/local/bin/node \
  && chmod +x /usr/local/bin/node

EXPOSE 8090

ENTRYPOINT ["/app/mcug"]
