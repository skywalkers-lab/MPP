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
  return resolvePublicCandidates()[0] || path.join(process.cwd(), 'public');
}

function resolvePublicCandidates(): string[] {
  const modulePath = process.argv[1] || process.cwd();
  const moduleDir = path.dirname(modulePath);
  const snapshotDir = path.join(__dirname, '..');
  const pkgEntrypoint = (process as NodeJS.Process & { pkg?: { entrypoint?: string } }).pkg?.entrypoint;
  const pkgEntryDir = pkgEntrypoint ? path.dirname(pkgEntrypoint) : null;
  const isPackaged = !!(process as NodeJS.Process & { pkg?: unknown }).pkg;

  const requiredFiles = ['ops.html', 'viewer.html', 'host.html'];
  function hasRequiredAssets(dir: string): boolean {
    return requiredFiles.every((name) => {
      const p = path.join(dir, name);
      return fs.existsSync(p) && fs.statSync(p).isFile();
    });
  }

  const candidates = [
    process.env.MPP_PUBLIC_DIR,
    path.join(path.sep, 'snapshot', 'MPP', 'public'),
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

  const existing = candidates.filter((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });

  const withRequired = existing.filter((candidate) => hasRequiredAssets(candidate));
  const withOps = existing.filter((candidate) => {
    try {
      return fs.existsSync(path.join(candidate, 'ops.html'));
    } catch {
      return false;
    }
  });

  const merged = [...withRequired, ...withOps, ...existing];
  return Array.from(new Set(merged));
}

function findFirstStaticFile(publicDirs: string[], fileName: string): string | null {
  for (const dir of publicDirs) {
    const filePath = path.join(dir, fileName);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return filePath;
    }
  }
  return null;
}

// Viewer API 및 정적 파일 서버

const app = express();
app.use(express.json()); // PATCH body parsing
const publicDir = resolvePublicDir();
const publicDirs = resolvePublicCandidates();
if (publicDirs.length === 0) {
  publicDirs.push(publicDir);
}

for (const dir of publicDirs) {
  app.use(express.static(dir));
}

app.use('/api/viewer', createViewerApiRouter(relayServer));

for (const dir of publicDirs) {
  app.use('/viewer', express.static(dir));
}
app.get('/viewer/:sessionId', (req, res) => {
  const filePath = findFirstStaticFile(publicDirs, 'viewer.html');
  if (!filePath) {
    logger.error(`[Viewer] viewer.html not found in candidates: ${publicDirs.join(', ')}`);
    return res.status(500).type('text/plain').send('viewer.html not found');
  }
  res.sendFile(filePath);
});
app.get('/join/:joinCode', (req, res) => {
  const filePath = findFirstStaticFile(publicDirs, 'viewer.html');
  if (!filePath) {
    logger.error(`[Viewer] viewer.html not found in candidates: ${publicDirs.join(', ')}`);
    return res.status(500).type('text/plain').send('viewer.html not found');
  }
  res.sendFile(filePath);
});
app.get('/host/:sessionId', (req, res) => {
  const filePath = findFirstStaticFile(publicDirs, 'host.html');
  if (!filePath) {
    logger.error(`[Viewer] host.html not found in candidates: ${publicDirs.join(', ')}`);
    return res.status(500).type('text/plain').send('host.html not found');
  }
  res.sendFile(filePath);
});
app.get('/ops', (req, res) => {
  const opsFile = findFirstStaticFile(publicDirs, 'ops.html');
  if (!opsFile) {
    logger.error(`[Viewer] ops.html not found in candidates: ${publicDirs.join(', ')}`);
    return res
      .status(500)
      .type('text/plain')
      .send(`ops.html not found. candidates=${publicDirs.join('|')}`);
  }
  res.sendFile(opsFile);
});
app.get('/archives', (req, res) => {
  const filePath = findFirstStaticFile(publicDirs, 'archives.html');
  if (!filePath) {
    logger.error(`[Viewer] archives.html not found in candidates: ${publicDirs.join(', ')}`);
    return res.status(500).type('text/plain').send('archives.html not found');
  }
  res.sendFile(filePath);
});
app.get('/overlay/:sessionId', (req, res) => {
  const filePath = findFirstStaticFile(publicDirs, 'overlay.html');
  if (!filePath) {
    logger.error(`[Viewer] overlay.html not found in candidates: ${publicDirs.join(', ')}`);
    return res.status(500).type('text/plain').send('overlay.html not found');
  }
  res.sendFile(filePath);
});
app.get('/overlay/join/:joinCode', (req, res) => {
  const filePath = findFirstStaticFile(publicDirs, 'overlay.html');
  if (!filePath) {
    logger.error(`[Viewer] overlay.html not found in candidates: ${publicDirs.join(', ')}`);
    return res.status(500).type('text/plain').send('overlay.html not found');
  }
  res.sendFile(filePath);
});

const HTTP_PORT = process.env.VIEWER_HTTP_PORT ? parseInt(process.env.VIEWER_HTTP_PORT) : 4100;
app.listen(HTTP_PORT, () => {
  logger.info(`[Viewer] HTTP server running at http://localhost:${HTTP_PORT}/viewer/:sessionId`);
  logger.info(`[Viewer] Static assets from: ${publicDir}`);
  logger.info(`[Viewer] Static candidate dirs: ${publicDirs.join(', ')}`);

  if (shouldAutoOpenDashboard()) {
    const dashboardUrl = `http://localhost:${HTTP_PORT}/ops?preset=ops`;
    logger.info(`[Viewer] Auto-opening dashboard: ${dashboardUrl}`);
    setTimeout(() => openBrowser(dashboardUrl), 600);
  }
});
