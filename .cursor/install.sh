#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f README.md ]]; then
  echo "README.md is missing from the repository root." >&2
  exit 1
fi

echo "Robomap-Payments checkout is present. No dependency manifests to install."
