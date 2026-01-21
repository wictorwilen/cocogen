#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLES_DIR="$ROOT_DIR/examples"
TMP_DIR="$ROOT_DIR/tmp"
CLI="$ROOT_DIR/dist/cli.js"
REPORT_PATH="$TMP_DIR/examples-report.md"
LOG_DIR="$TMP_DIR/examples-report-logs"

mkdir -p "$TMP_DIR"
mkdir -p "$LOG_DIR"

printf "Building generator...\n"
npm --prefix "$ROOT_DIR" run build

if [[ ! -f "$CLI" ]]; then
  printf "Error: CLI not found at %s\n" "$CLI" >&2
  exit 1
fi

shopt -s nullglob

printf "| Example | Lang | Generate | Build | Dry-run |\n" > "$REPORT_PATH"
printf "| --- | --- | --- | --- | --- |\n" >> "$REPORT_PATH"

run_step() {
  local label="$1"
  local cwd="$2"
  local log_path="$LOG_DIR/${label}.log"
  shift 2
  set +e
  (
    cd "$cwd"
    "$@"
  ) >"$log_path" 2>&1
  local status=$?
  set -e
  if [[ $status -eq 0 ]]; then
    if grep -Eiq "err+or:" "$log_path"; then
      printf "fail"
    else
      printf "ok"
    fi
  else
    printf "fail"
  fi
}

for tsp in "$EXAMPLES_DIR"/*.tsp; do
  base="$(basename "$tsp" .tsp)"

  if [[ "$base" == "gcgen.decorators" ]]; then
    printf "Skipping %s (decorators sample only).\n" "$base"
    continue
  fi

  preview=(--use-preview-features)
  out_ts="$TMP_DIR/${base}-ts"
  out_dotnet="$TMP_DIR/${base}-dotnet"

  printf "Running %s...\n" "$base"

  gen_ts_status="$(run_step "${base}-ts-generate" "$ROOT_DIR" node "$CLI" generate --tsp "$tsp" --out "$out_ts" --lang ts --force "${preview[@]}")"
  build_ts_status="$(run_step "${base}-ts-install" "$out_ts" npm install --no-audit --no-fund)"
  if [[ "$build_ts_status" == "ok" ]]; then
    build_ts_status="$(run_step "${base}-ts-build" "$out_ts" npm run build)"
  fi
  dry_ts_status="$(run_step "${base}-ts-dry" "$out_ts" node "dist/cli.js" ingest --dry-run)"

  printf "| %s | ts | %s | %s | %s |\n" "$base" "$gen_ts_status" "$build_ts_status" "$dry_ts_status" >> "$REPORT_PATH"

  gen_dotnet_status="$(run_step "${base}-dotnet-generate" "$ROOT_DIR" node "$CLI" generate --tsp "$tsp" --out "$out_dotnet" --lang dotnet --force "${preview[@]}")"
  build_dotnet_status="$(run_step "${base}-dotnet-build" "$out_dotnet" dotnet build)"
  dry_dotnet_status="$(run_step "${base}-dotnet-dry" "$out_dotnet" dotnet run -- ingest --dry-run)"

  printf "| %s | dotnet | %s | %s | %s |\n" "$base" "$gen_dotnet_status" "$build_dotnet_status" "$dry_dotnet_status" >> "$REPORT_PATH"

  printf "Report updated: %s\n" "$REPORT_PATH"

done

printf "Done. Report: %s\n" "$REPORT_PATH"
