#!/usr/bin/env sh
# Bring a clean Linux or macOS machine to a working workspace.
#   ./bootstrap.sh [scope]        scope defaults to "core"; try "showcase" or "all"
set -eu
SCOPE="${1:-core}"
NEED=22

have_node() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$NEED" ]; }

if ! have_node; then
  echo "Node $NEED or newer is required; trying to install it."
  if command -v brew >/dev/null 2>&1; then brew install node
  elif command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y nodejs npm
  else echo "Install Node $NEED+ from https://nodejs.org and re-run." >&2; exit 1; fi
fi
have_node || { echo "Node $NEED+ still not available (your package manager may ship an older one; use https://nodejs.org)." >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git is required." >&2; exit 1; }

cd "$(dirname "$0")"
node src/cli.mjs pull --scope="$SCOPE"
node src/cli.mjs doctor || true
echo "Done. Next: node src/cli.mjs status --scope=$SCOPE"
