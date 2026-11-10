#!/bin/bash
# Double-click in Finder to start TempWatch on macOS (also works on Linux).
# Close the Terminal window to stop it.
cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found."
  echo "Install it from https://nodejs.org and then open this file again."
  read -r -p "Press Return to close." _
  exit 1
fi

# macOS shows battery temperature out of the box; CPU temperature needs a small helper.
# Offer to install it once, if Homebrew is available.
mkdir -p data
if [ "$(uname)" = "Darwin" ] && [ ! -f data/.asked-temp-helper ] \
   && ! command -v smctemp >/dev/null 2>&1 && ! command -v osx-cpu-temp >/dev/null 2>&1 \
   && command -v brew >/dev/null 2>&1; then
  touch data/.asked-temp-helper
  echo "TempWatch can show CPU temperature if the free smctemp helper is installed."
  read -r -p "Install it now with Homebrew? [y/N] " answer
  case "$answer" in
    [yY]*) brew install narugit/tap/smctemp || echo "Install failed; continuing without it." ;;
  esac
fi

node server.js
