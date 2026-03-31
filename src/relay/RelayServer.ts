// relay/RelayServer.ts
// F1 25 Realtime Relay Core - WebSocket 기반 세션별 상태 중계 서버

import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { CurrentRaceState } from '../model/CurrentRaceState';
import { ConsoleLogger } from '../debug/ConsoleLogger';
import express from 'express';

export interface RelaySession {
  sessionId: string;
  hostConnectionId: string;
  createdAt: number;
  updatedAt: number;
  lastHeartbeatAt: number;
  latestSequence: number;
  latestState: CurrentRaceState | null;
  status: 'active' | 'stale' | 'closed';
}

export interface RelayServerOptions {
  wsPort: number;
  debugHttpPort?: number;
  logger?: ConsoleLogger;
  heartbeatTimeoutMs?: number;
}

export class RelayServer {
  private wss: WebSocketServer;
  private sessions: Map<string, RelaySession> = new Map();
  private connToSession: Map<string, string> = new Map();
  private logger: ConsoleLogger;
  private heartbeatTimeoutMs: number;

  constructor(private options: RelayServerOptions) {
    this.logger = options.logger || new ConsoleLogger('info');
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs || 10000;
    this.wss = new WebSocketServer({ port: options.wsPort });
    this.wss.on('connection', this.handleConnection.bind(this));
    this.logger.info(`[Relay] WebSocket server started on :${options.wsPort}`);
    if (options.debugHttpPort) {
      this.startDebugHttp(options.debugHttpPort);
    }
    setInterval(this.checkHeartbeats.bind(this), 2000);
  }

  /**
   * 세션ID로 세션을 조회합니다. (향후 joinCode/visibility validation 확장 가능)
   */
  public getSession(sessionId: string): RelaySession | undefined {
    // access policy, joinCode 등은 5단계에서 추가 예정
    return this.sessions.get(sessionId);
  }

  private handleConnection(ws: WebSocket) {
    const connId = uuidv4();
    this.logger.info(`[Relay] New connection: ${connId}`);
    ws.on('message', (data) => this.handleMessage(ws, connId, data));
    ws.on('close', () => this.handleClose(connId));
    ws.on('error', (err) => this.logger.warn(`[Relay] WS error: ${err}`));
  }

  private handleMessage(ws: WebSocket, connId: string, data: any) {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      this.logger.warn(`[Relay] Invalid JSON from ${connId}`);
      ws.send(JSON.stringify({ type: 'error', error: 'invalid_json' }));
      return;
    }
    if (!msg.type) {
      ws.send(JSON.stringify({ type: 'error', error: 'missing_type' }));
      return;
    }
    // protocolVersion 검사 (host_hello)
    if (msg.type === 'host_hello') {
      if (typeof msg.protocolVersion !== 'number' || msg.protocolVersion !== 1) {
        ws.send(JSON.stringify({ type: 'error', error: 'unsupported_protocol_version' }));
        return;
      }
    }
    // state_snapshot payload shape 검사
    if (msg.type === 'state_snapshot') {
      if (typeof msg.sessionId !== 'string' || typeof msg.sequence !== 'number' || typeof msg.timestamp !== 'number' || typeof msg.state !== 'object') {
        ws.send(JSON.stringify({ type: 'error', error: 'invalid_state_snapshot_shape' }));
        return;
      }
    }
    switch (msg.type) {
      case 'host_hello':
        this.handleHostHello(ws, connId, msg);
        break;
      case 'state_snapshot':
        this.handleStateSnapshot(connId, msg);
        break;
      case 'heartbeat':
        this.handleHeartbeat(connId, msg);
        break;
      default:
        ws.send(JSON.stringify({ type: 'error', error: 'unknown_type' }));
    }
  }

  private handleHostHello(ws: WebSocket, connId: string, msg: any) {
    const sessionId = msg.requestedSessionId || this.generateSessionId();
    const now = Date.now();
    const session: RelaySession = {
      sessionId,
      hostConnectionId: connId,
      createdAt: now,
      updatedAt: now,
      lastHeartbeatAt: now,
      latestSequence: 0,
      latestState: null,
      status: 'active',
    };
    this.sessions.set(sessionId, session);
    this.connToSession.set(connId, sessionId);
    this.logger.info(`[Relay] session_started: ${sessionId} (host=${connId})`);
    ws.send(JSON.stringify({ type: 'session_started', sessionId, role: 'host' }));
  }

  private handleStateSnapshot(connId: string, msg: any) {
    const sessionId = this.connToSession.get(connId);
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (typeof msg.sequence !== 'number' || !msg.state) return;
    if (msg.sequence <= session.latestSequence) {
      this.logger.warn(`[Relay] Out-of-order snapshot (seq=${msg.sequence}) for session ${sessionId}`);
      return;
    }
    session.latestSequence = msg.sequence;
    session.latestState = msg.state;
    session.updatedAt = Date.now();
    this.logger.debug(`[Relay] state_snapshot seq=${msg.sequence} for session ${sessionId}`);
  }

  private handleHeartbeat(connId: string, msg: any) {
    const sessionId = this.connToSession.get(connId);
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.lastHeartbeatAt = Date.now();
    session.status = 'active';
    this.logger.debug(`[Relay] heartbeat for session ${sessionId}`);
  }

  private handleClose(connId: string) {
    const sessionId = this.connToSession.get(connId);
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = 'stale';
    this.logger.info(`[Relay] Connection closed: ${connId}, session ${sessionId} marked stale`);
    this.connToSession.delete(connId);
  }

  private checkHeartbeats() {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.status === 'active' && now - session.lastHeartbeatAt > this.heartbeatTimeoutMs) {
        session.status = 'stale';
        this.logger.warn(`[Relay] Heartbeat timeout: session ${session.sessionId} marked stale`);
      }
    }
  }

  private generateSessionId(): string {
    return 'S-' + Math.random().toString(36).substr(2, 6).toUpperCase();
  }

  private startDebugHttp(port: number) {
    const app = express();
    app.get('/relay/sessions', (req, res) => {
      res.json(Array.from(this.sessions.values()).map(s => ({
        sessionId: s.sessionId,
        status: s.status,
        updatedAt: s.updatedAt,
        lastHeartbeatAt: s.lastHeartbeatAt,
        latestSequence: s.latestSequence,
        hasState: !!s.latestState,
      })));
    });
    app.get('/relay/sessions/:id', (req, res) => {
      const s = this.sessions.get(req.params.id);
      if (!s) return res.status(404).json({ error: 'not_found' });
      res.json({
        sessionId: s.sessionId,
        status: s.status,
        updatedAt: s.updatedAt,
        lastHeartbeatAt: s.lastHeartbeatAt,
        latestSequence: s.latestSequence,
        latestState: s.latestState,
      });
    });
    app.listen(port, () => {
      this.logger.info(`[Relay] Debug HTTP server running at http://localhost:${port}/relay/sessions`);
    });
  }
}
