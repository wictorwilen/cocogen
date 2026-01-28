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

if [[ -n "${INPUT_FORMATS:-}" ]]; then
  read -r -a input_formats <<< "${INPUT_FORMATS}"
else
  input_formats=("csv" "json" "yaml" "rest")
fi

for tsp in "$EXAMPLES_DIR"/*.tsp; do
  base="$(basename "$tsp" .tsp)"
  preview=(--use-preview-features)

  if [[ "$base" == "gcgen.decorators" ]]; then
    printf "Skipping %s (decorators sample only).\n" "$base"
    continue
  fi

  for input_format in "${input_formats[@]}"; do
    out_ts="$TMP_DIR/${base}-ts-${input_format}"
    out_dotnet="$TMP_DIR/${base}-dotnet-${input_format}"

    printf "Generating TS project for %s (%s)...\n" "$base" "$input_format"
    node "$CLI" generate --tsp "$tsp" --out "$out_ts" --lang ts --force --data-format "$input_format" "${preview[@]}"

    printf "Generating .NET project for %s (%s)...\n" "$base" "$input_format"
    node "$CLI" generate --tsp "$tsp" --out "$out_dotnet" --lang dotnet --force --data-format "$input_format" "${preview[@]}"
  done

done

printf "Done.\n"
