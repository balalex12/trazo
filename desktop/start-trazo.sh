#!/bin/sh
# Starts Trazo from this folder. Needs Node.js (https://nodejs.org); stop it with Ctrl+C.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install it from https://nodejs.org and run this again."
  exit 1
fi
node serve.cjs
