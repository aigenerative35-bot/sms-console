#!/usr/bin/env bash
# SMS Console launcher
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js nahi mila. https://nodejs.org se LTS install karo."
  exit 1
fi

echo "SMS Console start ho raha hai... browser khud khul jayega."
echo "Band karne ke liye Ctrl+C dabao."
echo
exec node server.js
