// relay/RelayClient.ts
// F1 25 Realtime Relay Client - agent에서 relay 서버로 CurrentRaceState를 전송

import WebSocket from 'ws';
import { CurrentRaceState } from '../model/CurrentRaceState';
import { ConsoleLogger } from '../debug/ConsoleLogger';

export interface RelayClientOptions {
  url: string;
  protocolVersion: number;
  agentVersion: string;
  requestedSessionId?: string;
  logger?: ConsoleLogger;
  snapshotIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private sequence: number = 0;
  private logger: ConsoleLogger;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastState: CurrentRaceState | null = null;
  private connected: boolean = false;
  private stopped: boolean = false;

  constructor(private options: RelayClientOptions) {
    this.logger = options.logger || new ConsoleLogger('info');
  }

  connect() {
    if (this.stopped) {
      this.stopped = false;
    }

    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      return;
    }

    this.ws = new WebSocket(this.options.url);
    this.ws.on('open', () => {
      this.logger.info('[RelayClient] Connected to relay server');
      this.sendHostHello();
      this.connected = true;
    });
    this.ws.on('message', (data) => this.handleMessage(data));
    this.ws.on('close', () => {
      this.logger.warn('[RelayClient] Disconnected from relay server');
      this.connected = false;
      this.sessionId = null;
      this.stopTimers();
      this.ws = null;
      if (!this.stopped) {
        setTimeout(() => this.connect(), 2000); // 재연결 시도
      }
    });
    this.ws.on('error', (err) => {
      this.logger.warn('[RelayClient] WebSocket error: ' + err);
    });
  }

  private sendHostHello() {
    if (!this.ws) return;
    this.ws.send(JSON.stringify({
      type: 'host_hello',
      protocolVersion: this.options.protocolVersion,
      agentVersion: this.options.agentVersion,
      requestedSessionId: this.options.requestedSessionId || null,
    }));
  }

  private handleMessage(data: any) {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      this.logger.warn('[RelayClient] Invalid JSON from server');
      return;
    }
    if (msg.type === 'session_started') {
      this.sessionId = msg.sessionId;
      this.logger.info(`[RelayClient] session_started: ${msg.sessionId}`);
      this.startTimers();
    } else if (msg.type === 'session_rebound') {
      const previous = this.sessionId;
      this.sessionId = msg.sessionId;
      this.logger.info(
        `[RelayClient] session_rebound: ${previous || '-'} -> ${msg.sessionId}`
      );
      this.startTimers();
    } else if (msg.type === 'ack') {
      // future use
    } else if (msg.type === 'error') {
      this.logger.warn(`[RelayClient] error: ${msg.error}`);
    }
  }

  sendStateSnapshot(state: CurrentRaceState) {
    if (!this.connected || !this.ws || !this.sessionId) return;
    this.sequence++;
    this.lastState = state;
    this.ws.send(JSON.stringify({
      type: 'state_snapshot',
      sessionId: this.sessionId,
      sequence: this.sequence,
      timestamp: Date.now(),
      state,
    }));
  }

  private startTimers() {
    this.stopTimers();
    this.snapshotTimer = setInterval(() => {
      if (this.lastState) this.sendStateSnapshot(this.lastState);
    }, this.options.snapshotIntervalMs || 1000);
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.sessionId) {
        this.ws.send(JSON.stringify({
          type: 'heartbeat',
          sessionId: this.sessionId,
          sequence: this.sequence,
          timestamp: Date.now(),
        }));
      }
    }, this.options.heartbeatIntervalMs || 2000);
  }

  private stopTimers() {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.snapshotTimer = null;
    this.heartbeatTimer = null;
  }

  getStatus(): { connected: boolean; sessionId: string | null } {
    return { connected: this.connected, sessionId: this.sessionId };
  }

  close() {
    this.stopped = true;
    this.connected = false;
    this.sessionId = null;
    this.stopTimers();

    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close();
    }

    this.ws = null;
  }
}
