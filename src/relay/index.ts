// relay/index.ts
// Relay 서버 실행 진입점

import { RelayServer } from './RelayServer.js';
import { ConsoleLogger } from '../debug/ConsoleLogger.js';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { createViewerApiRouter } from './viewerApi.js';

const WS_PORT = process.env.RELAY_WS_PORT ? parseInt(process.env.RELAY_WS_PORT) : 4000;
const DEBUG_HTTP_PORT = process.env.RELAY_DEBUG_HTTP_PORT ? parseInt(process.env.RELAY_DEBUG_HTTP_PORT) : 4001;
const logger = new ConsoleLogger('info');

const relayServer = new RelayServer({
  wsPort: WS_PORT,
  debugHttpPort: DEBUG_HTTP_PORT,
  logger,
  heartbeatTimeoutMs: 10000,
});

function shouldAutoOpenDashboard(): boolean {
  const flag = String(process.env.MPP_AUTO_OPEN_DASHBOARD || '').toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') {
    return false;
  }

  const isPackaged = !!(process as NodeJS.Process & { pkg?: unknown }).pkg;
  const isExe = process.platform === 'win32' && process.execPath.toLowerCase().endsWith('.exe');
  return isPackaged || isExe;
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return;
    }

    if (process.platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }

    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (err) {
    logger.warn(`[Viewer] Failed to auto-open dashboard: ${err}`);
  }
}

function resolvePublicDir(): string {
  const modulePath = process.argv[1] || process.cwd();
  const moduleDir = path.dirname(modulePath);
  const candidates = [
    process.env.MPP_PUBLIC_DIR,
    path.join(process.cwd(), 'public'),
    path.join(moduleDir, '../../public'),
    path.join(path.dirname(process.execPath), 'public'),
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return path.join(process.cwd(), 'public');
}

// Viewer API 및 정적 파일 서버

const app = express();
app.use(express.json()); // PATCH body parsing
const publicDir = resolvePublicDir();
app.use(express.static(publicDir)); // 루트 static 서빙

app.use('/api/viewer', createViewerApiRouter(relayServer));

app.use('/viewer', express.static(publicDir));
app.get('/viewer/:sessionId', (req, res) => {
  res.sendFile(path.join(publicDir, 'viewer.html'));
});
app.get('/join/:joinCode', (req, res) => {
  res.sendFile(path.join(publicDir, 'viewer.html'));
});
app.get('/host/:sessionId', (req, res) => {
  res.sendFile(path.join(publicDir, 'host.html'));
});
app.get('/ops', (req, res) => {
  res.sendFile(path.join(publicDir, 'ops.html'));
});
app.get('/archives', (req, res) => {
  res.sendFile(path.join(publicDir, 'archives.html'));
});
app.get('/overlay/:sessionId', (req, res) => {
  res.sendFile(path.join(publicDir, 'overlay.html'));
});
app.get('/overlay/join/:joinCode', (req, res) => {
  res.sendFile(path.join(publicDir, 'overlay.html'));
});

const HTTP_PORT = process.env.VIEWER_HTTP_PORT ? parseInt(process.env.VIEWER_HTTP_PORT) : 4100;
app.listen(HTTP_PORT, () => {
  logger.info(`[Viewer] HTTP server running at http://localhost:${HTTP_PORT}/viewer/:sessionId`);
  logger.info(`[Viewer] Static assets from: ${publicDir}`);

  if (shouldAutoOpenDashboard()) {
    const dashboardUrl = `http://localhost:${HTTP_PORT}/ops?preset=ops`;
    logger.info(`[Viewer] Auto-opening dashboard: ${dashboardUrl}`);
    setTimeout(() => openBrowser(dashboardUrl), 600);
  }
});
