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

required_examples=("people-all-labels" "content-all-validations")
for example_name in "${required_examples[@]}"; do
  if [[ ! -f "$EXAMPLES_DIR/${example_name}.tsp" ]]; then
    printf "Error: missing required example %s\n" "$example_name" >&2
    exit 1
  fi
done

printf "| Example | Format | Lang | Generate | Build | Dry-run |\n" > "$REPORT_PATH"
printf "| --- | --- | --- | --- | --- | --- |\n" >> "$REPORT_PATH"

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

if [[ -n "${INPUT_FORMATS:-}" ]]; then
  read -r -a input_formats <<< "${INPUT_FORMATS}"
else
  input_formats=("csv" "json" "yaml")
fi

for tsp in "$EXAMPLES_DIR"/*.tsp; do
  base="$(basename "$tsp" .tsp)"

  if [[ "$base" == "gcgen.decorators" ]]; then
    printf "Skipping %s (decorators sample only).\n" "$base"
    continue
  fi

  preview=(--use-preview-features)
  printf "Running %s...\n" "$base"

  for input_format in "${input_formats[@]}"; do
    out_ts="$TMP_DIR/${base}-ts-${input_format}"
    out_dotnet="$TMP_DIR/${base}-dotnet-${input_format}"

    gen_ts_status="$(run_step "${base}-ts-${input_format}-generate" "$ROOT_DIR" node "$CLI" generate --tsp "$tsp" --out "$out_ts" --lang ts --force --data-format "$input_format" "${preview[@]}")"
    build_ts_status="$(run_step "${base}-ts-${input_format}-install" "$out_ts" npm install --no-audit --no-fund)"
    if [[ "$build_ts_status" == "ok" ]]; then
      build_ts_status="$(run_step "${base}-ts-${input_format}-build" "$out_ts" npm run build)"
    fi
    dry_ts_status="$(run_step "${base}-ts-${input_format}-dry" "$out_ts" node "dist/cli.js" ingest --dry-run)"

    printf "| %s | %s | ts | %s | %s | %s |\n" "$base" "$input_format" "$gen_ts_status" "$build_ts_status" "$dry_ts_status" >> "$REPORT_PATH"

    gen_dotnet_status="$(run_step "${base}-dotnet-${input_format}-generate" "$ROOT_DIR" node "$CLI" generate --tsp "$tsp" --out "$out_dotnet" --lang dotnet --force --data-format "$input_format" "${preview[@]}")"
    build_dotnet_status="$(run_step "${base}-dotnet-${input_format}-build" "$out_dotnet" dotnet build)"
    dry_dotnet_status="$(run_step "${base}-dotnet-${input_format}-dry" "$out_dotnet" dotnet run -- ingest --dry-run)"

    printf "| %s | %s | dotnet | %s | %s | %s |\n" "$base" "$input_format" "$gen_dotnet_status" "$build_dotnet_status" "$dry_dotnet_status" >> "$REPORT_PATH"

    printf "Report updated: %s\n" "$REPORT_PATH"
  done

done

printf "Done. Report: %s\n" "$REPORT_PATH"
