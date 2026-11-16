#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env. Set APP_PASSWORD before signing in."
fi
if ! grep -Eq '^APP_PASSWORD=.{16,}$' .env; then
  echo "Set APP_PASSWORD to a private password of at least 16 characters in .env, then run this script again."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installing SocialHub dependencies..."
  npm install --omit=dev
fi
npm start
