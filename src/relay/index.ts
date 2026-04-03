// relay/index.ts
// Relay 서버 실행 진입점

import { RelayServer } from './RelayServer.js';
import { ConsoleLogger } from '../debug/ConsoleLogger.js';
import { UdpReceiver } from '../agent/UdpReceiver.js';
import { StateReducer } from '../agent/StateReducer.js';
import { RelayClient } from './RelayClient.js';
import { RelayAgentAdapter } from '../agent/RelayAgentAdapter.js';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { createViewerApiRouter } from './viewerApi.js';

const logger = new ConsoleLogger('info');
const WS_PORT = readPortFromEnv('RELAY_WS_PORT', 4000);
const DEBUG_HTTP_PORT = readPortFromEnv('RELAY_DEBUG_HTTP_PORT', 4001);
const HTTP_PORT = readPortFromEnv('VIEWER_HTTP_PORT', 4100);
let embeddedUdp: UdpReceiver | null = null;
let embeddedRelayClient: RelayClient | null = null;
let embeddedAgentStarted = false;
let shuttingDown = false;

function readPortFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }

  logger.warn(`[Config] Invalid ${name}=${raw}; using default ${fallback}`);
  return fallback;
}

function resolveCrashLogPath(): string {
  const exeDir = path.dirname(process.execPath);
  const cwdDir = process.cwd();
  const preferExeDir = !!(process as NodeJS.Process & { pkg?: unknown }).pkg;
  const targetDir = preferExeDir ? exeDir : cwdDir;
  return path.join(targetDir, 'mpp-crash.log');
}

function persistFatalError(prefix: string, err: unknown): void {
  const text = err instanceof Error ? `${err.stack || err.message}` : String(err);
  const line = `[${new Date().toISOString()}] ${prefix}: ${text}\n`;
  try {
    fs.appendFileSync(resolveCrashLogPath(), line, 'utf8');
  } catch {
    // Last-resort path: fatal logging must not crash the process further.
  }
}

process.on('uncaughtException', (err) => {
  persistFatalError('uncaughtException', err);
  logger.error(`[Fatal] uncaughtException: ${err}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  persistFatalError('unhandledRejection', reason);
  logger.error(`[Fatal] unhandledRejection: ${reason}`);
  process.exit(1);
});

const relayServer = new RelayServer({
  wsPort: WS_PORT,
  debugHttpPort: DEBUG_HTTP_PORT,
  logger,
  heartbeatTimeoutMs: 10000,
});
registerProcessShutdown();

if (shouldStartEmbeddedAgent()) {
  startEmbeddedAgent();
}

function shouldAutoOpenDashboard(): boolean {
  const flag = String(process.env.MPP_AUTO_OPEN_DASHBOARD || '').toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') {
    return false;
  }

  const isPackaged = !!(process as NodeJS.Process & { pkg?: unknown }).pkg;
  const isExe = process.platform === 'win32' && process.execPath.toLowerCase().endsWith('.exe');
  return isPackaged || isExe;
}

function shouldStartEmbeddedAgent(): boolean {
  const flag = String(process.env.MPP_EMBEDDED_AGENT || '').toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') {
    return false;
  }

  if (flag === '1' || flag === 'true' || flag === 'on' || flag === 'yes') {
    return true;
  }

  const isPackaged = !!(process as NodeJS.Process & { pkg?: unknown }).pkg;
  const isExe = process.platform === 'win32' && process.execPath.toLowerCase().endsWith('.exe');
  return isPackaged || isExe;
}

function startEmbeddedAgent(): void {
  if (embeddedAgentStarted) {
    return;
  }

  const udpPort = readPortFromEnv('F1_UDP_PORT', 20777);
  const udpAddr = process.env.F1_UDP_ADDR || '0.0.0.0';
  const relayUrl = process.env.RELAY_URL || `ws://127.0.0.1:${WS_PORT}`;

  try {
    const reducer = new StateReducer();
    const udp = new UdpReceiver(reducer, logger, {
      port: udpPort,
      address: udpAddr,
      logLevel: 'info',
      verbose: false,
    });

    const relayClient = new RelayClient({
      url: relayUrl,
      protocolVersion: 1,
      agentVersion: '0.1.0',
      logger,
      snapshotIntervalMs: 1000,
      heartbeatIntervalMs: 2000,
    });

    relayClient.connect();
    new RelayAgentAdapter(reducer, relayClient, logger);
    udp.start();

    embeddedUdp = udp;
    embeddedRelayClient = relayClient;
    embeddedAgentStarted = true;

    logger.info(`[EmbeddedAgent] UDP receiver started at ${udpAddr}:${udpPort}`);
    logger.info(`[EmbeddedAgent] Relay uplink target: ${relayUrl}`);
  } catch (err) {
    embeddedUdp = null;
    embeddedRelayClient = null;
    embeddedAgentStarted = false;
    logger.error('[EmbeddedAgent] Failed to start embedded agent', err);
  }
}

function stopEmbeddedAgent(): void {
  if (embeddedUdp) {
    try {
      embeddedUdp.stop();
    } catch (err) {
      logger.warn(`[EmbeddedAgent] Failed to stop UDP receiver cleanly: ${err}`);
    }
    embeddedUdp = null;
  }

  if (embeddedRelayClient) {
    try {
      embeddedRelayClient.close();
    } catch (err) {
      logger.warn(`[EmbeddedAgent] Failed to stop relay client cleanly: ${err}`);
    }
    embeddedRelayClient = null;
  }

  embeddedAgentStarted = false;
}

function registerProcessShutdown(): void {
  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info(`[Shutdown] Received ${signal}, closing services...`);
    stopEmbeddedAgent();
    relayServer.close();

    setTimeout(() => process.exit(0), 120);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
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
  const runtimeDir = __dirname;
  const snapshotDir = path.join(runtimeDir, '..');
  const pkgEntrypoint = (process as NodeJS.Process & { pkg?: { entrypoint?: string } }).pkg?.entrypoint;
  const pkgEntryDir = pkgEntrypoint ? path.dirname(pkgEntrypoint) : null;
  const isPackaged =
    !!(process as NodeJS.Process & { pkg?: unknown }).pkg ||
    (process.platform === 'win32' && process.execPath.toLowerCase().endsWith('.exe'));
  const fsRoot = path.parse(process.execPath).root;
  const winSnapshotRoot = path.join(fsRoot, 'snapshot');

  const requiredFiles = ['ops.html', 'viewer.html', 'host.html'];
  function hasRequiredAssets(dir: string): boolean {
    return requiredFiles.every((name) => fs.existsSync(path.join(dir, name)));
  }

  const candidates = [
    process.env.MPP_PUBLIC_DIR,
    path.join(runtimeDir, 'public'),
    path.join(runtimeDir, '.pkgbuild', 'public'),
    path.join(snapshotDir, '.pkgbuild', 'public'),
    path.join(winSnapshotRoot, 'MPP', 'public'),
    path.join(winSnapshotRoot, '.pkgbuild', 'public'),
    path.join(winSnapshotRoot, 'public'),
    path.join(path.sep, 'snapshot', 'MPP', 'public'),
    path.join(path.sep, 'snapshot', '.pkgbuild', 'public'),
    path.join(path.sep, 'snapshot', 'public'),
    path.join(snapshotDir, 'public'),
    path.join(snapshotDir, '../public'),
    pkgEntryDir ? path.join(pkgEntryDir, '../public') : null,
    pkgEntryDir ? path.join(pkgEntryDir, '../../public') : null,
    path.join(path.dirname(process.execPath), 'public'),
    // Keep cwd/public as last resort for non-packaged local development only.
    !isPackaged ? path.join(process.cwd(), 'public') : null,
    path.join(moduleDir, '../../public'),
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);

  for (const candidate of candidates) {
    if (
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isDirectory() &&
      hasRequiredAssets(candidate)
    ) {
      return candidate;
    }
  }

  if (isPackaged) {
    // In packaged mode, avoid silently selecting cwd/public (often user Downloads/public).
    const packagedFallbacks = [
      path.join(runtimeDir, 'public'),
      path.join(snapshotDir, '.pkgbuild', 'public'),
      path.join(winSnapshotRoot, '.pkgbuild', 'public'),
      path.join(winSnapshotRoot, 'MPP', 'public'),
      path.join(path.sep, 'snapshot', 'MPP', 'public'),
      path.join(snapshotDir, 'public'),
      path.join(snapshotDir, '../public'),
      path.join(path.dirname(process.execPath), 'public'),
    ];

    for (const fallback of packagedFallbacks) {
      if (fs.existsSync(fallback) && fs.statSync(fallback).isDirectory()) {
        logger.warn(`[Viewer] Using packaged fallback publicDir without full asset check: ${fallback}`);
        return fallback;
      }
    }
  }

  // Final fallback keeps previous behavior but logs will show missing files explicitly.
  return path.join(process.cwd(), 'public');
}

// Viewer API 및 정적 파일 서버

const app = express();
app.use(express.json()); // PATCH body parsing
const publicDir = resolvePublicDir();
app.use(express.static(publicDir)); // 루트 static 서빙

app.get('/healthz', (_req, res) => {
  const requiredFiles = ['ops.html', 'viewer.html', 'host.html', 'archives.html'];
  const missingFiles = requiredFiles.filter(
    (name) => !fs.existsSync(path.join(publicDir, name))
  );
  const healthy = missingFiles.length === 0;
  res.status(healthy ? 200 : 500).json({
    ok: healthy,
    publicDir,
    missingFiles,
    relay: {
      wsPort: WS_PORT,
      viewerPort: HTTP_PORT,
    },
    embeddedAgent: {
      enabled: shouldStartEmbeddedAgent(),
      started: embeddedAgentStarted,
      udpPort: readPortFromEnv('F1_UDP_PORT', 20777),
      udpAddress: process.env.F1_UDP_ADDR || '0.0.0.0',
    },
  });
});

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
  const opsFile = path.join(publicDir, 'ops.html');
  if (!fs.existsSync(opsFile)) {
    logger.error(`[Viewer] ops.html not found at: ${opsFile}`);
    return res
      .status(500)
      .type('text/plain')
      .send(`ops.html not found. publicDir=${publicDir}`);
  }
  res.sendFile(opsFile);
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

app.listen(HTTP_PORT, () => {
  logger.info(`[Viewer] HTTP server running at http://localhost:${HTTP_PORT}/viewer/:sessionId`);
  logger.info(`[Viewer] Static assets from: ${publicDir}`);

  if (shouldAutoOpenDashboard()) {
    const dashboardUrl = `http://localhost:${HTTP_PORT}/ops?preset=ops`;
    logger.info(`[Viewer] Auto-opening dashboard: ${dashboardUrl}`);
    setTimeout(() => openBrowser(dashboardUrl), 600);
  }
});
