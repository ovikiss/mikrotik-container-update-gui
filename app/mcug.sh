#!/bin/sh
set -eu

: "${HTTP_PORT:=8090}"
: "${DATA_DIR:=/data}"
: "${TZ:=Europe/Bucharest}"

export HTTP_PORT
export DATA_DIR
export TZ

mkdir -p "$DATA_DIR"

exec python3 /app/src/server.py
