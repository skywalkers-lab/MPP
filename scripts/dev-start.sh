#!/usr/bin/env bash
# Kill any lingering processes on relay/vite ports before starting
fuser -k 4000/tcp 4001/tcp 5000/tcp 2>/dev/null || true
sleep 0.5

exec npx concurrently --kill-others-on-fail \
  "VIEWER_HTTP_PORT=4001 RELAY_WS_PORT=4000 RELAY_PUBLIC_URL=https://${REPLIT_DEV_DOMAIN} npm run relay" \
  "cd client && npx vite --port 5000 --host 0.0.0.0"
