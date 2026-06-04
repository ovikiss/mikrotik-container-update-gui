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
ARG APP_VERSION=dev
ARG TARGETOS
ARG TARGETARCH
ARG TARGETVARIANT
RUN UI_SHARED_REPO="$UI_SHARED_REPO" UI_SHARED_REF="$UI_SHARED_REF" UI_SHARED_REV="$UI_SHARED_REV" sh scripts/sync-ui-shared.sh

# Build the Go application statically
RUN set -eu; \
    export GOOS="${TARGETOS:-linux}"; \
    export GOARCH="${TARGETARCH:-amd64}"; \
    if [ "${TARGETARCH:-}" = "arm" ] && [ "${TARGETVARIANT:-}" = "v7" ]; then export GOARM=7; fi; \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.Version=${APP_VERSION}" -o mcug main.go

FROM alpine:3.20 AS certs

RUN apk add --no-cache ca-certificates

# Stage 2: Create a minimal runtime image
FROM scratch

LABEL org.opencontainers.image.source="https://github.com/ovikiss/mikrotik-container-update-gui"

WORKDIR /app

COPY --from=builder /build/mcug /app/mcug
COPY --from=builder /build/app/branding.json /app/branding.json
COPY --from=builder /build/app/www /app/www
COPY --from=builder /build/app/i18n /app/i18n
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

ENV HTTP_PORT=8090
ENV DATA_DIR=/data
ENV STATIC_DIR=/app

EXPOSE 8090

ENTRYPOINT ["/app/mcug"]
