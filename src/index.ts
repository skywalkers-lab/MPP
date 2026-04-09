
import { UdpReceiver } from './agent/UdpReceiver.js';
import { StateReducer } from './agent/StateReducer.js';
import { ConsoleLogger } from './debug/ConsoleLogger.js';
import { startDebugHttpServer } from './debug/DebugHttpServer.js';
import { RelayClient } from './relay/RelayClient.js';
import { RelayAgentAdapter } from './agent/RelayAgentAdapter.js';

const UDP_PORT = process.env.F1_UDP_PORT ? parseInt(process.env.F1_UDP_PORT) : 20777;
const UDP_ADDR = process.env.F1_UDP_ADDR || '0.0.0.0';
const LOG_LEVEL = (process.env.F1_LOG_LEVEL as 'info' | 'warn' | 'debug') || 'info';
const DEBUG_HTTP_PORT = process.env.F1_DEBUG_HTTP_PORT ? parseInt(process.env.F1_DEBUG_HTTP_PORT) : 3000;
const VERBOSE = process.env.F1_VERBOSE === '1' || process.env.F1_VERBOSE === 'true';



const logger = new ConsoleLogger(LOG_LEVEL);
const reducer = new StateReducer();
const udp = new UdpReceiver(reducer, logger, { port: UDP_PORT, address: UDP_ADDR, logLevel: LOG_LEVEL, verbose: VERBOSE });

// RelayClient 연결 (환경변수로 활성화)
let relayClient: RelayClient | null = null;
if (process.env.RELAY_URL) {
	relayClient = new RelayClient({
		url: process.env.RELAY_URL,
		protocolVersion: 1,
		agentVersion: '0.1.0',
		logger,
		snapshotIntervalMs: 1000,
		heartbeatIntervalMs: 2000,
	});
	relayClient.connect();
	// StateReducer 상태 변경 시 relay로 전송
	new RelayAgentAdapter(reducer, relayClient, logger);
	logger.info(`[Relay] Enabled: ${process.env.RELAY_URL}`);
}


udp.start();
startDebugHttpServer(reducer, DEBUG_HTTP_PORT);

logger.info('F1 25 UDP Local Agent started.');
logger.info(`UDP: ${UDP_ADDR}:${UDP_PORT}, Debug HTTP: http://localhost:${DEBUG_HTTP_PORT}/state, Verbose: ${VERBOSE}`);
