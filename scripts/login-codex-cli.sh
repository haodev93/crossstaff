#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(dirname -- "$script_dir")
cli_home=${1:-"$repo_dir/data/codex-cli-home"}

case "$cli_home" in
  /*) ;;
  *) cli_home="$PWD/$cli_home" ;;
esac

mkdir -p "$cli_home"
cli_home=$(CDPATH= cd -- "$cli_home" && pwd)

if ! command -v codex >/dev/null 2>&1; then
  printf '%s\n' "Codex CLI was not found on PATH." >&2
  printf '%s\n' "Install Codex CLI, open a new shell, and run this script again." >&2
  exit 127
fi

export CODEX_HOME="$cli_home"

printf '%s\n' "Isolated Codex CLI home: $CODEX_HOME"
printf '%s\n' "The Codex desktop app keeps its own profile and is not modified."

codex login
codex login status
