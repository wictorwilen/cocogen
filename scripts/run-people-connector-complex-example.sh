#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE_TSP="$ROOT_DIR/examples/people-connector-complex.tsp"
EXAMPLE_JSON="$ROOT_DIR/examples/people-connector-complex.json"
OUT_DIR="$ROOT_DIR/tmp/people-connector-complex-json"
CLI="$ROOT_DIR/dist/cli.js"

printf "Building generator...\n"
npm --prefix "$ROOT_DIR" run build

if [[ ! -f "$CLI" ]]; then
  printf "Error: CLI not found at %s\n" "$CLI" >&2
  exit 1
fi

printf "Generating project...\n"
node "$CLI" generate --tsp "$EXAMPLE_TSP" --out "$OUT_DIR" --lang ts --data-format json --force --use-preview-features

printf "Copying sample JSON...\n"
cp "$EXAMPLE_JSON" "$OUT_DIR/data.json"

printf "Installing dependencies...\n"
(
  cd "$OUT_DIR"
  npm install --no-audit --no-fund
)

printf "Building project...\n"
(
  cd "$OUT_DIR"
  npm run build
)

printf "Running ingest dry-run...\n"
(
  cd "$OUT_DIR"
  node dist/cli.js ingest --dry-run
)

printf "Done. Output: %s\n" "$OUT_DIR"
