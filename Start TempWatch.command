#!/bin/bash
# Double-click in Finder to start TempWatch on macOS. Close the Terminal window to stop it.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it from https://nodejs.org and try again."
  read -r -p "Press Return to close." _
  exit 1
fi
node server.js --open
