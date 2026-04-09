// relay/index.ts
// Relay 서버 실행 진입점
import { RelayServer } from './RelayServer.js';
import { ConsoleLogger } from '../debug/ConsoleLogger.js';
import { UdpReceiver } from '../agent/UdpReceiver.js';
import { StateReducer } from '../agent/StateReducer.js';
import { RelayClient } from './RelayClient.js';
import { RelayAgentAdapter } from '../agent/RelayAgentAdapter.js';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { createViewerApiRouter } from './viewerApi.js';
const logger = new ConsoleLogger('info');
const WS_PORT = readPortFromEnv('RELAY_WS_PORT', 4000);
const DEBUG_HTTP_PORT = readPortFromEnv('RELAY_DEBUG_HTTP_PORT', 4001);
const HTTP_PORT = readPortFromEnv('VIEWER_HTTP_PORT', 4100);
const ENABLE_DEBUG_HTTP = readBooleanFromEnv('RELAY_ENABLE_DEBUG_HTTP', false);
const ENABLE_CORS = readBooleanFromEnv('RELAY_ENABLE_CORS', true);
const ALLOWED_ORIGINS = readListFromEnv('RELAY_ALLOWED_ORIGINS');
const PUBLIC_VIEWER_BASE_URL = readPublicUrlFromEnv('RELAY_PUBLIC_URL', `http://127.0.0.1:${HTTP_PORT}`);
const PUBLIC_RELAY_WS_URL = readPublicWsUrlFromEnv('RELAY_PUBLIC_WS_URL', PUBLIC_VIEWER_BASE_URL, WS_PORT);
const RELAY_LABEL = (process.env.RELAY_LABEL || '').trim() || inferRelayLabel(PUBLIC_VIEWER_BASE_URL);
if (PUBLIC_VIEWER_BASE_URL.includes('127.0.0.1') ||
    PUBLIC_VIEWER_BASE_URL.includes('localhost')) {
    logger.warn(`[Config] RELAY_PUBLIC_URL is still localhost (${PUBLIC_VIEWER_BASE_URL}). ` +
        'Remote viewers will receive broken join/overlay links. ' +
        'Set RELAY_PUBLIC_URL=http://<your-public-ip-or-domain>:<port> to fix this.');
}
let embeddedUdp = null;
let embeddedRelayClient = null;
let embeddedAgentStarted = false;
let shuttingDown = false;
function readPortFromEnv(name, fallback) {
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
function readBooleanFromEnv(name, fallback) {
    const raw = process.env[name];
    if (!raw || raw.trim().length === 0) {
        return fallback;
    }
    const value = raw.trim().toLowerCase();
    if (['1', 'true', 'on', 'yes'].includes(value))
        return true;
    if (['0', 'false', 'off', 'no'].includes(value))
        return false;
    logger.warn(`[Config] Invalid ${name}=${raw}; using default ${String(fallback)}`);
    return fallback;
}
function readListFromEnv(name) {
    const raw = process.env[name];
    if (!raw)
        return [];
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}
function readPublicUrlFromEnv(name, fallback) {
    const raw = process.env[name];
    if (!raw || raw.trim().length === 0) {
        return fallback;
    }
    try {
        const url = new URL(raw);
        return `${url.protocol}//${url.host}`;
    }
    catch {
        logger.warn(`[Config] Invalid ${name}=${raw}; using default ${fallback}`);
        return fallback;
    }
}
function readPublicWsUrlFromEnv(name, viewerBaseUrl, wsPort) {
    const raw = process.env[name];
    if (raw && raw.trim().length > 0) {
        try {
            const wsUrl = new URL(raw);
            if (wsUrl.protocol !== 'ws:' && wsUrl.protocol !== 'wss:') {
                throw new Error('invalid_ws_protocol');
            }
            return `${wsUrl.protocol}//${wsUrl.host}${wsUrl.pathname}`;
        }
        catch {
            logger.warn(`[Config] Invalid ${name}=${raw}; deriving from RELAY_PUBLIC_URL`);
        }
    }
    try {
        const url = new URL(viewerBaseUrl);
        const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${wsProtocol}//${url.host}`;
    }
    catch {
        return `ws://127.0.0.1:${wsPort}`;
    }
}
function inferRelayLabel(viewerBaseUrl) {
    try {
        const host = new URL(viewerBaseUrl).hostname;
        if (host === '127.0.0.1' || host === 'localhost') {
            return 'local-relay';
        }
        return 'public-relay';
    }
    catch {
        return 'custom-relay';
    }
}
function resolveCrashLogPath() {
    const exeDir = path.dirname(process.execPath);
    const cwdDir = process.cwd();
    const preferExeDir = !!process.pkg;
    const targetDir = preferExeDir ? exeDir : cwdDir;
    return path.join(targetDir, 'mpp-crash.log');
}
function persistFatalError(prefix, err) {
    const text = err instanceof Error ? `${err.stack || err.message}` : String(err);
    const line = `[${new Date().toISOString()}] ${prefix}: ${text}\n`;
    try {
        fs.appendFileSync(resolveCrashLogPath(), line, 'utf8');
    }
    catch {
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
    debugHttpPort: ENABLE_DEBUG_HTTP ? DEBUG_HTTP_PORT : undefined,
    logger,
    heartbeatTimeoutMs: 10000,
    publicViewerBaseUrl: PUBLIC_VIEWER_BASE_URL,
    publicRelayWsUrl: PUBLIC_RELAY_WS_URL,
    relayLabel: RELAY_LABEL,
    relayNamespace: PUBLIC_VIEWER_BASE_URL,
    debugHttpEnabled: ENABLE_DEBUG_HTTP,
    corsEnabled: ENABLE_CORS,
});
registerProcessShutdown();
if (shouldStartEmbeddedAgent()) {
    startEmbeddedAgent();
}
function shouldAutoOpenDashboard() {
    const flag = String(process.env.MPP_AUTO_OPEN_DASHBOARD || '').toLowerCase();
    if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') {
        return false;
    }
    const isPackaged = !!process.pkg;
    const isExe = process.platform === 'win32' && process.execPath.toLowerCase().endsWith('.exe');
    return isPackaged || isExe;
}
function shouldStartEmbeddedAgent() {
    const flag = String(process.env.MPP_EMBEDDED_AGENT || '').toLowerCase();
    if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') {
        return false;
    }
    if (flag === '1' || flag === 'true' || flag === 'on' || flag === 'yes') {
        return true;
    }
    // Relay mode should ingest UDP out of the box for local/dev users.
    // Opt out explicitly with MPP_EMBEDDED_AGENT=0 when an external sender is used.
    return true;
}
function startEmbeddedAgent() {
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
    }
    catch (err) {
        embeddedUdp = null;
        embeddedRelayClient = null;
        embeddedAgentStarted = false;
        logger.error('[EmbeddedAgent] Failed to start embedded agent', err);
    }
}
function stopEmbeddedAgent() {
    if (embeddedUdp) {
        try {
            embeddedUdp.stop();
        }
        catch (err) {
            logger.warn(`[EmbeddedAgent] Failed to stop UDP receiver cleanly: ${err}`);
        }
        embeddedUdp = null;
    }
    if (embeddedRelayClient) {
        try {
            embeddedRelayClient.close();
        }
        catch (err) {
            logger.warn(`[EmbeddedAgent] Failed to stop relay client cleanly: ${err}`);
        }
        embeddedRelayClient = null;
    }
    embeddedAgentStarted = false;
}
function registerProcessShutdown() {
    const shutdown = (signal) => {
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
function openBrowser(url) {
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
    }
    catch (err) {
        logger.warn(`[Viewer] Failed to auto-open dashboard: ${err}`);
    }
}
function resolvePublicDir() {
    const modulePath = process.argv[1] || process.cwd();
    const moduleDir = path.dirname(modulePath);
    const runtimeDir = moduleDir;
    const snapshotDir = path.join(runtimeDir, '..');
    const pkgEntrypoint = process.pkg?.entrypoint;
    const pkgEntryDir = pkgEntrypoint ? path.dirname(pkgEntrypoint) : null;
    const isPackaged = !!process.pkg ||
        (process.platform === 'win32' && process.execPath.toLowerCase().endsWith('.exe'));
    const fsRoot = path.parse(process.execPath).root;
    const winSnapshotRoot = path.join(fsRoot, 'snapshot');
    const requiredFiles = ['ops.html', 'viewer.html', 'host.html'];
    function hasRequiredAssets(dir) {
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
    ].filter((v) => typeof v === 'string' && v.length > 0);
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) &&
            fs.statSync(candidate).isDirectory() &&
            hasRequiredAssets(candidate)) {
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
if (ENABLE_CORS) {
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        const allowAny = ALLOWED_ORIGINS.length === 0;
        const allowed = allowAny || (origin ? ALLOWED_ORIGINS.includes(origin) : false);
        if (allowAny) {
            res.setHeader('Access-Control-Allow-Origin', '*');
        }
        else if (allowed && origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
            res.status(204).end();
            return;
        }
        next();
    });
}
app.use(express.json()); // PATCH body parsing
const publicDir = resolvePublicDir();
app.use(express.static(publicDir)); // 루트 static 서빙
const coreAssetFiles = [
    'overlay.html',
    'viewer.html',
    'host.html',
    'ops.html',
    'rooms.html',
    'archives.html',
    'dashboard.html',
];
function readAssetDiagnostics() {
    const assets = coreAssetFiles.map((name) => {
        const fullPath = path.join(publicDir, name);
        const exists = fs.existsSync(fullPath);
        return {
            name,
            exists,
            path: fullPath,
        };
    });
    const missingFiles = assets.filter((a) => !a.exists).map((a) => a.name);
    return {
        publicDir,
        assets,
        missingFiles,
    };
}
function readRuntimeDiagnostics() {
    const asset = readAssetDiagnostics();
    const udp = embeddedUdp?.getDiagnosticsSnapshot() || null;
    const healthy = asset.missingFiles.length === 0;
    return {
        ok: healthy,
        checkedAt: Date.now(),
        publicDir: asset.publicDir,
        assets: asset.assets,
        missingFiles: asset.missingFiles,
        relay: {
            wsPort: WS_PORT,
            viewerPort: HTTP_PORT,
            label: RELAY_LABEL,
            viewerBaseUrl: PUBLIC_VIEWER_BASE_URL,
            relayWsUrl: PUBLIC_RELAY_WS_URL,
            debugHttpEnabled: ENABLE_DEBUG_HTTP,
            corsEnabled: ENABLE_CORS,
            corsAllowedOrigins: ALLOWED_ORIGINS,
        },
        embeddedAgent: {
            enabled: shouldStartEmbeddedAgent(),
            started: embeddedAgentStarted,
            udpPort: readPortFromEnv('F1_UDP_PORT', 20777),
            udpAddress: process.env.F1_UDP_ADDR || '0.0.0.0',
            udpBindSucceeded: udp?.bindSucceeded ?? false,
            udpBindAttempted: udp?.bindAttempted ?? false,
            udpBindError: udp?.bindError ?? null,
            recentPackets10s: udp?.recentPackets10s ?? 0,
            lastPacketAt: udp?.lastPacketAt ?? null,
            lastValidPacketId: udp?.lastValidPacketId ?? null,
            lastSessionUID: udp?.lastSessionUID ?? null,
            lastParseSuccessAt: udp?.lastParseSuccessAt ?? null,
            parseFailureCount: udp?.parseFailureCount ?? 0,
            parseFailureByPacketId: udp?.parseFailureByPacketId ?? {},
        },
    };
}
app.get('/healthz', (_req, res) => {
    const diagnostics = readRuntimeDiagnostics();
    res.status(diagnostics.ok ? 200 : 500).json(diagnostics);
});
app.get('/diagnostics', (_req, res) => {
    res.json(readRuntimeDiagnostics());
});
app.get('/api/viewer/diagnostics', (_req, res) => {
    res.json(readRuntimeDiagnostics());
});
app.use('/api/viewer', createViewerApiRouter(relayServer));
// SPA catch-all: serve index.html (React app) for all non-API routes.
// Falls back to legacy HTML files if index.html is not present.
function serveAppShell(_req, res) {
    const indexFile = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
        return;
    }
    // Fallback: legacy build not present
    res.status(503).type('text/plain').send('Frontend not built. Run: cd client && npm run build\n' +
        `publicDir=${publicDir}`);
}
app.get('/', (_req, res) => res.redirect('/rooms'));
app.get('/rooms', serveAppShell);
app.get('/room/:sessionId', serveAppShell);
app.get('/join/:joinCode', serveAppShell);
app.get('/ops', serveAppShell);
app.get('/archives', serveAppShell);
app.get('/viewer/:sessionId', serveAppShell);
app.get('/host/:sessionId', serveAppShell);
app.get('/overlay/:sessionId', serveAppShell);
app.get('/overlay/join/:joinCode', serveAppShell);
app.get('/hud/:sessionId', serveAppShell);
app.get('/hud/join/:joinCode', serveAppShell);
app.get('/console/live', serveAppShell);
app.get('/console/replay', serveAppShell);
const httpServer = http.createServer(app);
const attachViewerHttpServer = relayServer.attachViewerHttpServer;
if (typeof attachViewerHttpServer === 'function') {
    attachViewerHttpServer.call(relayServer, httpServer);
}
httpServer.listen(HTTP_PORT, () => {
    logger.info(`[Viewer] HTTP server running at http://localhost:${HTTP_PORT}/viewer/:sessionId`);
    logger.info(`[Viewer] Static assets from: ${publicDir}`);
    if (shouldAutoOpenDashboard()) {
        const dashboardUrl = `http://localhost:${HTTP_PORT}/rooms`;
        logger.info(`[Viewer] Auto-opening dashboard: ${dashboardUrl}`);
        setTimeout(() => openBrowser(dashboardUrl), 600);
    }
});
