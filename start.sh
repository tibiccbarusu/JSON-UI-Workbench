#!/usr/bin/env bash
# Compatibility entry for the optional, unfinished experimental GUI.
# CLI/SDK/API consumers do not run this launcher.
set -euo pipefail
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  if [[ "${JSONUI_LANGUAGE:-ja}" == en ]]; then
    printf '%s\n' 'Node.js 22.14.0 or newer is required. See local-node/START-ja.md.' >&2
  else
    printf '%s\n' 'Node.js 22.14.0 以降が必要です。local-node/START-ja.md を確認してください。' >&2
  fi
  exit 42
fi
if ! node local-node/version-check.cjs; then
  if [[ "${JSONUI_LANGUAGE:-ja}" == en ]]; then
    printf '%s\n' 'Node.js could not confirm version 22.14.0 or newer. See local-node/START-ja.md.' >&2
  else
    printf '%s\n' 'Node.js 22.14.0 以降を確認できません。local-node/START-ja.md を確認してください。' >&2
  fi
  exit 42
fi
exec node local-node/launcher.mjs
