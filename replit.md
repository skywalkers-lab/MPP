# F1-25 Local Agent / Mission Pitwall Platform (MPP)

## Project Overview

Real-time telemetry and strategy tool for the F1 25 racing game. Captures UDP telemetry from the game, processes it, and serves a web dashboard with race state, strategy analysis, live monitoring, and broadcast overlays.

## Architecture

- **Language:** TypeScript (Node.js, ESM)
- **Package Manager:** npm
- **Runtime:** tsx (TypeScript execute without pre-compilation)

### Key Components

| Component | Description |
|-----------|-------------|
| Local Agent (`src/index.ts`) | UDP listener only, no web server |
| Relay Server (`src/relay/index.ts`) | Main entry point - WebSocket relay + HTTP web server |
| Embedded Agent | Auto-starts inside relay - handles UDP ingestion |
| Web Frontend | Vanilla JS/CSS in `public/` directory |

### Ports

- **5000** - HTTP viewer/frontend (Express, serves `public/`)
- **4000** - WebSocket relay (ws://)
- **20777** - UDP receiver (F1 game telemetry input)

### Web Routes

- `/` → redirects to `/rooms`
- `/rooms` - Room Lobby (main dashboard)
- `/ops` - Ops Control Plane
- `/viewer/:sessionId` - Viewer surface
- `/host/:sessionId` - Host/Engineer surface
- `/overlay/:sessionId` - Broadcast overlay (for OBS)
- `/archives` - Post-race archive replay
- `/dashboard.html` - Dashboard
- `/healthz` - Health check endpoint
- `/diagnostics` - Runtime diagnostics JSON

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VIEWER_HTTP_PORT` | 4100 | HTTP frontend port (set to 5000 for Replit) |
| `RELAY_WS_PORT` | 4000 | WebSocket relay port |
| `RELAY_PUBLIC_URL` | localhost | Public base URL for generating join/overlay links |
| `F1_UDP_PORT` | 20777 | UDP port for F1 game telemetry |
| `MPP_OPS_TOKEN` | (none) | Token for Ops Control Plane access |
| `MPP_EMBEDDED_AGENT` | true | Whether to auto-start UDP listener in relay mode |
| `RELAY_ENABLE_CORS` | true | Enable CORS headers |

## Workflow

**Start application** runs:
```
VIEWER_HTTP_PORT=5000 RELAY_WS_PORT=4000 RELAY_PUBLIC_URL=https://${REPLIT_DEV_DOMAIN} npm run relay
```

This starts:
1. WebSocket relay server on port 4000
2. Embedded UDP agent listening on port 20777
3. HTTP Express server on port 5000 serving the web UI

## Deployment

Configured as a **VM** deployment (always-running) since it uses in-memory WebSocket state and a persistent UDP listener.

Run command: `bash -c "VIEWER_HTTP_PORT=5000 RELAY_WS_PORT=4000 npm run relay"`

## Project Structure

```
src/
  relay/           # Relay server, HTTP API, WebSocket
  agent/           # UDP receiver, state reducer, relay adapter
  parsers/         # F1 25 UDP packet parsers
  model/           # Race state data models
  debug/           # Console logger, debug HTTP server
  index.ts         # Local agent entry point (no web)
public/            # Frontend HTML/JS/CSS files
electron/          # Native HUD (Electron, desktop only)
tests/             # Jest test suite
docs/              # Documentation / GitHub Pages
scripts/           # Packaging scripts (Windows exe)
```
