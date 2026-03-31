// relay/index.ts
// Relay 서버 실행 진입점

import { RelayServer } from './RelayServer.js';
import { ConsoleLogger } from '../debug/ConsoleLogger.js';

const WS_PORT = process.env.RELAY_WS_PORT ? parseInt(process.env.RELAY_WS_PORT) : 4000;
const DEBUG_HTTP_PORT = process.env.RELAY_DEBUG_HTTP_PORT ? parseInt(process.env.RELAY_DEBUG_HTTP_PORT) : 4001;
const logger = new ConsoleLogger('info');

new RelayServer({
  wsPort: WS_PORT,
  debugHttpPort: DEBUG_HTTP_PORT,
  logger,
  heartbeatTimeoutMs: 10000,
});
