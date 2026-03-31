// relay/RelayClient.ts
// F1 25 Realtime Relay Client - agent에서 relay 서버로 CurrentRaceState를 전송
import WebSocket from 'ws';
import { ConsoleLogger } from '../debug/ConsoleLogger';
export class RelayClient {
    constructor(options) {
        this.options = options;
        this.ws = null;
        this.sessionId = null;
        this.sequence = 0;
        this.snapshotTimer = null;
        this.heartbeatTimer = null;
        this.lastState = null;
        this.connected = false;
        this.logger = options.logger || new ConsoleLogger('info');
    }
    connect() {
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
            setTimeout(() => this.connect(), 2000); // 재연결 시도
        });
        this.ws.on('error', (err) => {
            this.logger.warn('[RelayClient] WebSocket error: ' + err);
        });
    }
    sendHostHello() {
        if (!this.ws)
            return;
        this.ws.send(JSON.stringify({
            type: 'host_hello',
            protocolVersion: this.options.protocolVersion,
            agentVersion: this.options.agentVersion,
            requestedSessionId: this.options.requestedSessionId || null,
        }));
    }
    handleMessage(data) {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        }
        catch (e) {
            this.logger.warn('[RelayClient] Invalid JSON from server');
            return;
        }
        if (msg.type === 'session_started') {
            this.sessionId = msg.sessionId;
            this.logger.info(`[RelayClient] session_started: ${msg.sessionId}`);
            this.startTimers();
        }
        else if (msg.type === 'ack') {
            // future use
        }
        else if (msg.type === 'error') {
            this.logger.warn(`[RelayClient] error: ${msg.error}`);
        }
    }
    sendStateSnapshot(state) {
        if (!this.connected || !this.ws || !this.sessionId)
            return;
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
    startTimers() {
        this.stopTimers();
        this.snapshotTimer = setInterval(() => {
            if (this.lastState)
                this.sendStateSnapshot(this.lastState);
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
    stopTimers() {
        if (this.snapshotTimer)
            clearInterval(this.snapshotTimer);
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        this.snapshotTimer = null;
        this.heartbeatTimer = null;
    }
}
