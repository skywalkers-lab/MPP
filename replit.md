# F1-25 Local Agent / Mission Pitwall Platform (MPP)

## Project Overview

Real-time telemetry and strategy tool for the F1 25 racing game. Captures UDP telemetry from the game, processes it, and serves a web dashboard with race state, strategy analysis, live monitoring, and broadcast overlays.

## Architecture

- **Language:** TypeScript (Node.js, ESM)
- **Package Manager:** npm
- **Runtime:** tsx (TypeScript execute without pre-compilation)
- **Frontend:** React 19 + Vite + Tailwind CSS v4 (in `client/`)

### Key Components

| Component | Description |
|-----------|-------------|
| Relay Server (`src/relay/index.ts`) | Main backend — WebSocket relay + HTTP API + static file serving |
| Embedded Agent | Auto-starts inside relay — handles UDP ingestion |
| React Frontend (`client/`) | SPA with React Router, Tailwind v4, served via Vite dev server in dev |

### Ports (Development)

- **5000** - Vite dev server (React frontend + proxy to relay)
- **4001** - HTTP relay/API (Express, internal only in dev)
- **4000** - WebSocket relay (ws://)
- **20777** - UDP receiver (F1 game telemetry input)

### Ports (Production)

- **5000** - Express serves built React app from `public/` + API
- **4000** - WebSocket relay (ws://)
- **20777** - UDP receiver

### Web Routes (React Router SPA)

- `/` → redirects to `/rooms`
- `/rooms` - Room Lobby (main dashboard)
- `/ops` - Ops Control Plane
- `/viewer/:sessionId` - Viewer surface
- `/host/:sessionId` - Host/Engineer surface
- `/overlay/:sessionId` - Broadcast overlay (for OBS)
- `/archives` - Post-race archive replay
- `/healthz` - Health check endpoint
- `/diagnostics` - Runtime diagnostics JSON
- `/api/...` - REST API (proxied to relay in dev)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VIEWER_HTTP_PORT` | 4100 | HTTP relay/API port (set to 4001 in dev, 5000 in prod) |
| `RELAY_WS_PORT` | 4000 | WebSocket relay port |
| `RELAY_PUBLIC_URL` | localhost | Public base URL for generating join/overlay links |
| `F1_UDP_PORT` | 20777 | UDP port for F1 game telemetry |
| `MPP_OPS_TOKEN` | (none) | Token for Ops Control Plane access |
| `MPP_EMBEDDED_AGENT` | true | Whether to auto-start UDP listener in relay mode |
| `RELAY_ENABLE_CORS` | true | Enable CORS headers |

## Workflow (Development)

**Start application** runs:
```
VIEWER_HTTP_PORT=4001 RELAY_WS_PORT=4000 RELAY_PUBLIC_URL=https://${REPLIT_DEV_DOMAIN} npm run relay & cd client && npx vite --port 5000 --host 0.0.0.0
```

This starts:
1. Relay server (WebSocket on :4000, HTTP API on :4001, UDP on :20777)
2. Vite dev server on :5000 (serves React app, proxies `/api`, `/diagnostics`, `/healthz` → :4001)

## Deployment (Production)

Build: `cd client && npm install && npm run build` (outputs to `public/`)
Run: `VIEWER_HTTP_PORT=5000 RELAY_WS_PORT=4000 npm run relay`

Configured as a **VM** deployment (always-running) — requires persistent in-memory state and a UDP listener.

## Project Structure

```
src/
  relay/           # Relay server, HTTP API, WebSocket
  agent/           # UDP receiver, state reducer, relay adapter
  parsers/         # F1 25 UDP packet parsers
  model/           # Race state data models
  debug/           # Console logger, debug HTTP server
  index.ts         # Local agent entry point (no web)
client/            # React + Vite + Tailwind v4 frontend (SPA)
  src/
    pages/         # RoomsPage, HostPage, OpsPage, ViewerPage, OverlayPage, ArchivesPage
    components/    # Shared UI components (HealthBadge, MetricCard, Layout)
    lib/           # api.ts (fetch helpers), formatters.ts
    types/         # TypeScript interfaces (index.ts)
  vite.config.ts   # Proxy /api → :4001, outDir → ../public
public/            # Built React app (output from `npm run build` in client/)
electron/          # Native HUD (Electron, desktop only)
tests/             # Jest test suite
docs/              # Documentation / GitHub Pages
scripts/           # Packaging scripts (Windows exe)
```
