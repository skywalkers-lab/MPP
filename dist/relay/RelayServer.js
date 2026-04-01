// relay/RelayServer.ts
// F1 25 Realtime Relay Core - WebSocket 기반 세션별 상태 중계 서버
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { ConsoleLogger } from '../debug/ConsoleLogger';
import express from 'express';
import { CompositeOpsNotifier, ConsoleOpsNotifier, InMemoryRecentOpsEvents, serializeSessionOpsSummary, } from './ops';
import { InMemorySessionNotesStore, } from './notes';
import { StrategyEngine } from './strategyEngine';
export function serializeSessionAccess(access) {
    if (!access)
        return null;
    return {
        sessionId: access.sessionId,
        joinCode: access.joinCode,
        visibility: access.visibility,
        shareEnabled: access.shareEnabled,
        createdAt: access.createdAt,
        updatedAt: access.updatedAt,
    };
}
export class RelayServer {
    constructor(options) {
        this.options = options;
        this.sessions = new Map();
        this.connToSession = new Map();
        // 5단계: joinCode → sessionId 매핑 및 access record 관리
        this.joinCodeToSessionId = new Map();
        this.sessionAccess = new Map();
        this.recentOpsEvents = new InMemoryRecentOpsEvents(300);
        this.notesStore = new InMemorySessionNotesStore();
        this.strategyEngine = new StrategyEngine();
        this.opsNotifier = new CompositeOpsNotifier([
            this.recentOpsEvents,
            new ConsoleOpsNotifier(),
        ]);
        this.logger = options.logger || new ConsoleLogger('info');
        this.heartbeatTimeoutMs = options.heartbeatTimeoutMs || 10000;
        this.wss = new WebSocketServer({ port: options.wsPort });
        this.wss.on('connection', this.handleConnection.bind(this));
        this.logger.info(`[Relay] WebSocket server started on :${options.wsPort}`);
        if (options.debugHttpPort) {
            this.startDebugHttp(options.debugHttpPort);
        }
        this.heartbeatTimer = setInterval(this.checkHeartbeats.bind(this), 2000);
        if (typeof this.heartbeatTimer.unref === 'function') {
            this.heartbeatTimer.unref();
        }
    }
    close() {
        const closedAt = Date.now();
        for (const session of this.sessions.values()) {
            if (session.status !== 'closed') {
                const previousStatus = session.status;
                session.status = 'closed';
                this.emitOpsEvent('session_closed', session.sessionId, {
                    previousStatus,
                    closedAt,
                });
            }
        }
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
        this.wss.close();
        if (this.debugHttpServer) {
            this.debugHttpServer.close();
            this.debugHttpServer = undefined;
        }
    }
    /**
     * joinCode로 sessionId를 resolve (정책/공유 상태도 함께 반환)
     */
    resolveJoinCode(joinCode) {
        const sessionId = this.joinCodeToSessionId.get(joinCode);
        if (!sessionId)
            return {};
        const access = this.sessionAccess.get(sessionId);
        return { sessionId, access };
    }
    /**
     * 세션의 접근/공유 메타데이터 반환
     */
    getSessionAccess(sessionId) {
        return this.sessionAccess.get(sessionId);
    }
    listSessionOpsSummaries() {
        return Array.from(this.sessions.values())
            .map((session) => {
            const access = this.sessionAccess.get(session.sessionId);
            const base = serializeSessionOpsSummary(session, access);
            const latestNote = this.notesStore.getLatestNote(session.sessionId);
            const strategy = this.computeSessionStrategy(session);
            return {
                ...base,
                noteCount: this.notesStore.getNoteCount(session.sessionId),
                latestNoteAt: latestNote?.timestamp ?? null,
                latestNotePreview: latestNote?.text?.slice(0, 80) ?? null,
                strategyLabel: strategy.strategyUnavailable
                    ? null
                    : strategy.recommendation,
                strategySeverity: strategy.strategyUnavailable
                    ? null
                    : strategy.severity,
                strategyGeneratedAt: strategy.generatedAt,
                strategyUnavailable: strategy.strategyUnavailable,
            };
        })
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }
    getSessionStrategy(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return {
                strategyUnavailable: true,
                reason: 'session_not_found',
                reasons: ['session does not exist'],
                signals: {},
                generatedAt: Date.now(),
            };
        }
        return this.computeSessionStrategy(session);
    }
    getRecentOpsEvents(limit = 50) {
        return this.recentOpsEvents.getRecent(limit);
    }
    listSessionNotes(sessionId) {
        return this.notesStore.listNotes(sessionId);
    }
    addSessionNote(sessionId, payload) {
        return this.notesStore.addNote(sessionId, payload);
    }
    deleteSessionNote(sessionId, noteId) {
        return this.notesStore.deleteNote(sessionId, noteId);
    }
    getSessionTimeline(sessionId, limit = 100) {
        const notes = this.notesStore
            .listNotes(sessionId)
            .map((note) => ({
            kind: 'note',
            timestamp: note.timestamp,
            note,
        }));
        const opsEvents = this.recentOpsEvents
            .getRecent(300)
            .filter((event) => event.sessionId === sessionId)
            .map((event) => ({
            kind: 'ops_event',
            timestamp: event.timestamp,
            event,
        }));
        return [...notes, ...opsEvents]
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-Math.max(1, Math.min(500, limit)));
    }
    /**
     * 세션 접근 정책을 업데이트한다 (shareEnabled, visibility)
     * PATCH /api/viewer/session-access/:sessionId에서 호출
     */
    updateSessionAccess(sessionId, patch) {
        const access = this.sessionAccess.get(sessionId);
        if (!access)
            return undefined;
        let changed = false;
        if (patch.shareEnabled !== undefined &&
            patch.shareEnabled !== access.shareEnabled) {
            const previousShareEnabled = access.shareEnabled;
            access.shareEnabled = patch.shareEnabled;
            changed = true;
            this.emitOpsEvent('share_enabled_changed', sessionId, {
                previousShareEnabled,
                nextShareEnabled: access.shareEnabled,
            });
        }
        if (patch.visibility !== undefined &&
            patch.visibility !== access.visibility) {
            const previousVisibility = access.visibility;
            access.visibility = patch.visibility;
            changed = true;
            this.emitOpsEvent('visibility_changed', sessionId, {
                previousVisibility,
                nextVisibility: access.visibility,
            });
        }
        if (changed) {
            access.updatedAt = Date.now();
        }
        return access;
    }
    /**
     * 세션ID로 세션을 조회합니다. (향후 joinCode/visibility validation 확장 가능)
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    computeSessionStrategy(session) {
        const input = this.buildStrategyInput(session);
        if (!input) {
            const unavailable = {
                strategyUnavailable: true,
                reason: 'player_state_missing',
                reasons: ['player car state is missing in current snapshot'],
                signals: {
                    latestSequence: session.latestSequence,
                },
                generatedAt: Date.now(),
            };
            return unavailable;
        }
        return this.strategyEngine.evaluate(input);
    }
    buildStrategyInput(session) {
        const now = Date.now();
        const hasSnapshot = !!session.latestState;
        const state = session.latestState;
        if (!hasSnapshot || !state) {
            return {
                sessionId: session.sessionId,
                relayStatus: session.status,
                isStale: session.status === 'stale',
                hasSnapshot: false,
                latestSequence: session.latestSequence ?? null,
                currentLap: null,
                totalLaps: null,
                position: null,
                tyreAgeLaps: null,
                fuelRemaining: null,
                fuelLapsRemaining: null,
                pitStatus: null,
                generatedAt: now,
            };
        }
        const playerCarIndex = state.playerCarIndex;
        const playerCar = playerCarIndex != null ? state.cars[playerCarIndex] : undefined;
        if (!playerCar) {
            return null;
        }
        return {
            sessionId: session.sessionId,
            relayStatus: session.status,
            isStale: session.status === 'stale',
            hasSnapshot,
            latestSequence: session.latestSequence ?? null,
            currentLap: playerCar.currentLapNum ?? state.sessionMeta?.currentLap ?? null,
            totalLaps: state.sessionMeta?.totalLaps ?? null,
            position: playerCar.position ?? null,
            tyreAgeLaps: playerCar.tyreAgeLaps ?? null,
            fuelRemaining: playerCar.fuelRemaining ?? null,
            fuelLapsRemaining: playerCar.fuelLapsRemaining ?? null,
            pitStatus: playerCar.pitStatus ?? null,
            generatedAt: now,
        };
    }
    /**
     * joinCode 생성기 (6자리 영문+숫자, 중복 방지)
     */
    generateJoinCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; ++i) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        if (this.joinCodeToSessionId.has(code)) {
            return this.generateJoinCode();
        }
        return code;
    }
    handleConnection(ws) {
        const connId = uuidv4();
        this.logger.info(`[Relay] New connection: ${connId}`);
        ws.on('message', (data) => this.handleMessage(ws, connId, data));
        ws.on('close', () => this.handleClose(connId));
        ws.on('error', (err) => this.logger.warn(`[Relay] WS error: ${err}`));
    }
    handleMessage(ws, connId, data) {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        }
        catch {
            this.logger.warn(`[Relay] Invalid JSON from ${connId}`);
            ws.send(JSON.stringify({ type: 'error', error: 'invalid_json' }));
            return;
        }
        if (!msg.type) {
            ws.send(JSON.stringify({ type: 'error', error: 'missing_type' }));
            return;
        }
        if (msg.type === 'host_hello') {
            if (typeof msg.protocolVersion !== 'number' ||
                msg.protocolVersion !== 1) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: 'unsupported_protocol_version',
                }));
                return;
            }
        }
        if (msg.type === 'state_snapshot') {
            if (typeof msg.sessionId !== 'string' ||
                typeof msg.sequence !== 'number' ||
                typeof msg.timestamp !== 'number' ||
                typeof msg.state !== 'object') {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: 'invalid_state_snapshot_shape',
                }));
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
                this.handleHeartbeat(connId);
                break;
            default:
                ws.send(JSON.stringify({ type: 'error', error: 'unknown_type' }));
        }
    }
    handleHostHello(ws, connId, msg) {
        const sessionId = msg.requestedSessionId || this.generateSessionId();
        const now = Date.now();
        const session = {
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
        // 5단계: 세션 생성 시 joinCode 및 access record 생성
        const joinCode = this.generateJoinCode();
        const access = {
            sessionId,
            joinCode,
            visibility: 'private',
            shareEnabled: false,
            createdAt: now,
            updatedAt: now,
        };
        this.joinCodeToSessionId.set(joinCode, sessionId);
        this.sessionAccess.set(sessionId, access);
        this.emitOpsEvent('session_started', sessionId, {
            joinCode,
            shareEnabled: access.shareEnabled,
            visibility: access.visibility,
        });
    }
    handleStateSnapshot(connId, msg) {
        const sessionId = this.connToSession.get(connId);
        if (!sessionId)
            return;
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        if (typeof msg.sequence !== 'number' || !msg.state)
            return;
        if (msg.sequence <= session.latestSequence) {
            this.logger.warn(`[Relay] Out-of-order snapshot (seq=${msg.sequence}) for session ${sessionId}`);
            return;
        }
        session.latestSequence = msg.sequence;
        session.latestState = msg.state;
        session.updatedAt = Date.now();
        this.logger.debug(`[Relay] state_snapshot seq=${msg.sequence} for session ${sessionId}`);
    }
    handleHeartbeat(connId) {
        const sessionId = this.connToSession.get(connId);
        if (!sessionId)
            return;
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        const previousStatus = session.status;
        session.lastHeartbeatAt = Date.now();
        session.status = 'active';
        if (previousStatus === 'stale') {
            this.emitOpsEvent('session_recovered', sessionId, {
                previousStatus,
                nextStatus: session.status,
            });
        }
        this.logger.debug(`[Relay] heartbeat for session ${sessionId}`);
    }
    handleClose(connId) {
        const sessionId = this.connToSession.get(connId);
        if (!sessionId)
            return;
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        const previousStatus = session.status;
        session.status = 'stale';
        this.logger.info(`[Relay] Connection closed: ${connId}, session ${sessionId} marked stale`);
        if (previousStatus !== 'stale') {
            this.emitOpsEvent('session_stale', sessionId, {
                reason: 'connection_closed',
                previousStatus,
            });
        }
        this.connToSession.delete(connId);
    }
    checkHeartbeats() {
        const now = Date.now();
        for (const session of this.sessions.values()) {
            if (session.status === 'active' &&
                now - session.lastHeartbeatAt > this.heartbeatTimeoutMs) {
                const previousStatus = session.status;
                session.status = 'stale';
                this.logger.warn(`[Relay] Heartbeat timeout: session ${session.sessionId} marked stale`);
                this.emitOpsEvent('session_stale', session.sessionId, {
                    reason: 'heartbeat_timeout',
                    previousStatus,
                    heartbeatAgeMs: now - session.lastHeartbeatAt,
                });
            }
        }
    }
    emitOpsEvent(type, sessionId, payload) {
        const event = {
            eventId: `${type}-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type,
            sessionId,
            timestamp: Date.now(),
            payload,
        };
        this.opsNotifier.notify(event);
    }
    generateSessionId() {
        return 'S-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    }
    startDebugHttp(port) {
        const app = express();
        app.get('/relay/sessions', (req, res) => {
            res.json(Array.from(this.sessions.values()).map((s) => {
                const access = serializeSessionAccess(this.sessionAccess.get(s.sessionId));
                const opsSummary = serializeSessionOpsSummary(s, this.sessionAccess.get(s.sessionId));
                return {
                    sessionId: s.sessionId,
                    status: s.status,
                    relayStatus: opsSummary.relayStatus,
                    viewerStatus: opsSummary.viewerStatus,
                    updatedAt: s.updatedAt,
                    lastHeartbeatAt: s.lastHeartbeatAt,
                    latestSequence: s.latestSequence,
                    hasState: !!s.latestState,
                    hasSnapshot: opsSummary.hasSnapshot,
                    hasViewerAccess: opsSummary.hasViewerAccess,
                    viewerAccessLabel: opsSummary.viewerAccessLabel,
                    access,
                    joinCode: access?.joinCode,
                    shareEnabled: access?.shareEnabled,
                    visibility: access?.visibility,
                    noteCount: this.notesStore.getNoteCount(s.sessionId),
                    latestNote: this.notesStore.getLatestNote(s.sessionId),
                    strategy: this.computeSessionStrategy(s),
                    ops: opsSummary,
                };
            }));
        });
        app.get('/relay/sessions/:id', (req, res) => {
            const s = this.sessions.get(req.params.id);
            if (!s) {
                return res.status(404).json({ error: 'not_found' });
            }
            const access = serializeSessionAccess(this.sessionAccess.get(s.sessionId));
            const opsSummary = serializeSessionOpsSummary(s, this.sessionAccess.get(s.sessionId));
            res.json({
                sessionId: s.sessionId,
                status: s.status,
                relayStatus: opsSummary.relayStatus,
                viewerStatus: opsSummary.viewerStatus,
                updatedAt: s.updatedAt,
                lastHeartbeatAt: s.lastHeartbeatAt,
                latestSequence: s.latestSequence,
                latestState: s.latestState,
                hasSnapshot: opsSummary.hasSnapshot,
                hasViewerAccess: opsSummary.hasViewerAccess,
                viewerAccessLabel: opsSummary.viewerAccessLabel,
                access,
                joinCode: access?.joinCode,
                shareEnabled: access?.shareEnabled,
                visibility: access?.visibility,
                noteCount: this.notesStore.getNoteCount(s.sessionId),
                latestNote: this.notesStore.getLatestNote(s.sessionId),
                strategy: this.computeSessionStrategy(s),
                ops: opsSummary,
            });
        });
        this.debugHttpServer = app.listen(port, () => {
            this.logger.info(`[Relay] Debug HTTP server running at http://localhost:${port}/relay/sessions`);
        });
    }
}
