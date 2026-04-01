// relay/index.ts
// Relay 서버 실행 진입점

import { RelayServer } from './RelayServer.js';
import { ConsoleLogger } from '../debug/ConsoleLogger.js';
import express from 'express';
import path from 'path';
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

// Viewer API 및 정적 파일 서버

const app = express();
app.use(express.json()); // PATCH body parsing
app.use(express.static(path.join(process.cwd(), 'public'))); // 루트 static 서빙

app.use('/api/viewer', createViewerApiRouter(relayServer));

app.use('/viewer', express.static(path.join(process.cwd(), 'public')));
app.get('/viewer/:sessionId', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'viewer.html'));
});
app.get('/join/:joinCode', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'viewer.html'));
});
app.get('/host/:sessionId', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'host.html'));
});

const HTTP_PORT = process.env.VIEWER_HTTP_PORT ? parseInt(process.env.VIEWER_HTTP_PORT) : 4100;
app.listen(HTTP_PORT, () => {
  logger.info(`[Viewer] HTTP server running at http://localhost:${HTTP_PORT}/viewer/:sessionId`);
});
