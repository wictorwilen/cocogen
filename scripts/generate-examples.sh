#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLES_DIR="$ROOT_DIR/examples"
TMP_DIR="$ROOT_DIR/tmp"
CLI="$ROOT_DIR/dist/cli.js"

printf "Cleaning tmp directory...\n"
mkdir -p "$TMP_DIR"
find "$TMP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

printf "Building generator...\n"
npm --prefix "$ROOT_DIR" run build

if [[ ! -f "$CLI" ]]; then
  printf "Error: CLI not found at %s\n" "$CLI" >&2
  exit 1
fi

shopt -s nullglob

for tsp in "$EXAMPLES_DIR"/*.tsp; do
  base="$(basename "$tsp" .tsp)"
  preview=(--use-preview-features)

  if [[ "$base" == "gcgen.decorators" ]]; then
    printf "Skipping %s (decorators sample only).\n" "$base"
    continue
  fi

  out_ts="$TMP_DIR/${base}-ts"
  out_dotnet="$TMP_DIR/${base}-dotnet"

  printf "Generating TS project for %s...\n" "$base"
  node "$CLI" init --tsp "$tsp" --out "$out_ts" --lang ts --force "${preview[@]}"

  printf "Generating .NET project for %s...\n" "$base"
  node "$CLI" init --tsp "$tsp" --out "$out_dotnet" --lang dotnet --force "${preview[@]}"

done

printf "Done.\n"
