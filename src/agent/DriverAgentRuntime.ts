import { ConsoleLogger } from '../debug/ConsoleLogger';
import { RelayClient } from '../relay/RelayClient';
import { RelayAgentAdapter } from './RelayAgentAdapter';
import { StateReducer } from './StateReducer';
import { UdpReceiver, UdpReceiverDiagnostics } from './UdpReceiver';

export interface DriverAgentRuntimeConfig {
  relayUrl: string;
  udpPort?: number;
  udpAddr?: string;
  sessionId?: string;
  agentVersion?: string;
  loggerLevel?: 'info' | 'warn' | 'debug';
}

export interface DriverAgentRuntimeSnapshot {
  started: boolean;
  relayUrl: string;
  udpPort: number;
  udpAddr: string;
  relayConnected: boolean;
  sessionId: string | null;
  udpPackets10s: number;
  lastPacketAt: number | null;
  sessionType: string | null;
  trackId: number | null;
  playerCarIndex: number | null;
  uptime: number;
  bindSucceeded: boolean;
  bindError: string | null;
  lastValidPacketId: number | null;
  lastSessionUID: string | null;
  lastParseSuccessAt: number | null;
  parseFailureCount: number;
}

function createIdleDiagnostics(port: number, address: string): UdpReceiverDiagnostics {
  return {
    started: false,
    bindAttempted: false,
    bindSucceeded: false,
    bindError: null,
    udpPort: port,
    udpAddress: address,
    recentPackets10s: 0,
    lastPacketAt: null,
    lastValidPacketId: null,
    lastSessionUID: null,
    lastParseSuccessAt: null,
    parseFailureCount: 0,
    parseFailureByPacketId: {},
  };
}

export class DriverAgentRuntime {
  private readonly relayUrl: string;
  private readonly udpPort: number;
  private readonly udpAddr: string;
  private readonly sessionId?: string;
  private readonly agentVersion: string;
  private readonly logger: ConsoleLogger;

  private reducer: StateReducer | null = null;
  private udp: UdpReceiver | null = null;
  private relay: RelayClient | null = null;
  private adapter: RelayAgentAdapter | null = null;
  private startTime: number | null = null;

  constructor(config: DriverAgentRuntimeConfig) {
    this.relayUrl = config.relayUrl;
    this.udpPort = config.udpPort ?? 20777;
    this.udpAddr = config.udpAddr ?? '0.0.0.0';
    this.sessionId = config.sessionId;
    this.agentVersion = config.agentVersion ?? '0.1.16';
    this.logger = new ConsoleLogger(config.loggerLevel ?? 'warn');
  }

  start(): void {
    if (this.reducer && this.udp && this.relay) {
      return;
    }

    const reducer = new StateReducer();
    const udp = new UdpReceiver(reducer, this.logger, {
      port: this.udpPort,
      address: this.udpAddr,
      logLevel: 'warn',
      verbose: false,
    });

    const relay = new RelayClient({
      url: this.relayUrl,
      protocolVersion: 1,
      agentVersion: this.agentVersion,
      requestedSessionId: this.sessionId,
      logger: this.logger,
      snapshotIntervalMs: 1000,
      heartbeatIntervalMs: 2000,
    });

    relay.connect();
    this.adapter = new RelayAgentAdapter(reducer, relay, this.logger);
    udp.start();

    this.reducer = reducer;
    this.udp = udp;
    this.relay = relay;
    this.startTime = Date.now();
  }

  stop(): void {
    if (this.relay) {
      this.relay.close();
      this.relay = null;
    }

    if (this.udp) {
      try {
        this.udp.stop();
      } catch {
        // Ignore shutdown noise during process exit.
      }
      this.udp = null;
    }

    this.adapter = null;
    this.reducer = null;
    this.startTime = null;
  }

  isStarted(): boolean {
    return this.reducer !== null && this.udp !== null && this.relay !== null;
  }

  getStatusSnapshot(): DriverAgentRuntimeSnapshot {
    const relayStatus = this.relay?.getStatus() ?? { connected: false, sessionId: null };
    const udpStatus = this.udp?.getDiagnosticsSnapshot() ?? createIdleDiagnostics(this.udpPort, this.udpAddr);
    const state = this.reducer?.getState() ?? null;
    const sessionMeta = state?.sessionMeta ?? null;

    return {
      started: this.isStarted(),
      relayUrl: this.relayUrl,
      udpPort: this.udpPort,
      udpAddr: this.udpAddr,
      relayConnected: relayStatus.connected,
      sessionId: relayStatus.sessionId,
      udpPackets10s: udpStatus.recentPackets10s,
      lastPacketAt: udpStatus.lastPacketAt,
      sessionType: sessionMeta?.sessionType != null ? String(sessionMeta.sessionType) : null,
      trackId: sessionMeta?.trackId ?? null,
      playerCarIndex: state?.playerCarIndex ?? null,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      bindSucceeded: udpStatus.bindSucceeded,
      bindError: udpStatus.bindError,
      lastValidPacketId: udpStatus.lastValidPacketId,
      lastSessionUID: udpStatus.lastSessionUID,
      lastParseSuccessAt: udpStatus.lastParseSuccessAt,
      parseFailureCount: udpStatus.parseFailureCount,
    };
  }
}