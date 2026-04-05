// relay/RelayServer.ts
// F1 25 Realtime Relay Core - WebSocket 기반 세션별 상태 중계 서버
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { ConsoleLogger } from '../debug/ConsoleLogger';
import express from 'express';
import { CompositeOpsNotifier, ConsoleOpsNotifier, deriveSessionHealthLevel, InMemoryRecentOpsEvents, serializeSessionOpsSummary, } from './ops';
import { InMemorySessionNotesStore, } from './notes';
import { StrategyEngine } from './strategyEngine';
import { InMemorySessionArchiveStore, toArchiveRecommendationSnapshot, } from './archive';
export function serializeSessionAccess(access, options) {
    if (!access)
        return null;
    const includeSecrets = options?.includeSecrets === true;
    return {
        sessionId: access.sessionId,
        joinCode: access.joinCode,
        roomTitle: access.roomTitle,
        passwordEnabled: !!access.roomPassword,
        driverLabel: access.driverLabel,
        carLabel: access.carLabel,
        roomPassword: includeSecrets ? access.roomPassword : undefined,
        permissionCode: includeSecrets ? access.permissionCode : undefined,
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
        this.connToWs = new Map();
        this.connToLastSequence = new Map();
        this.sessionToConnections = new Map();
        this.telemetrySessionUidToSessionId = new Map();
        this.sessionAliasToCanonical = new Map();
        this.sessionSyncUntil = new Map();
        // 5단계: joinCode → sessionId 매핑 및 access record 관리
        this.joinCodeToSessionId = new Map();
        this.sessionAccess = new Map();
        this.recentOpsEvents = new InMemoryRecentOpsEvents(300);
        this.notesStore = new InMemorySessionNotesStore();
        this.strategyEngine = new StrategyEngine();
        this.strategyCache = new Map();
        this.archiveStore = new InMemorySessionArchiveStore();
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
                this.finalizeArchiveForSession(session, 'server_shutdown', closedAt);
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
        const resolved = this.resolveCanonicalSessionId(sessionId);
        const access = this.sessionAccess.get(resolved.canonicalSessionId);
        return { sessionId: resolved.canonicalSessionId, access };
    }
    resolveCanonicalSessionId(sessionId) {
        let cursor = sessionId;
        let rebound = null;
        const visited = new Set();
        while (true) {
            if (visited.has(cursor)) {
                break;
            }
            visited.add(cursor);
            const alias = this.sessionAliasToCanonical.get(cursor);
            if (!alias) {
                break;
            }
            rebound = {
                previousSessionId: cursor,
                telemetrySessionUid: alias.telemetrySessionUid,
                mergedAt: alias.mergedAt,
            };
            cursor = alias.canonicalSessionId;
        }
        return {
            canonicalSessionId: cursor,
            rebound,
        };
    }
    getRelayRuntimeInfo() {
        const sessions = Array.from(this.sessions.values());
        const activeSessions = sessions.filter((s) => s.status === 'active').length;
        const staleSessions = sessions.filter((s) => s.status === 'stale').length;
        const viewerBaseUrl = this.options.publicViewerBaseUrl || 'http://127.0.0.1:4100';
        const relayWsUrl = this.options.publicRelayWsUrl || `ws://127.0.0.1:${this.options.wsPort}`;
        const relayNamespace = this.options.relayNamespace || viewerBaseUrl;
        const relayLabel = this.options.relayLabel || (relayNamespace.includes('127.0.0.1') || relayNamespace.includes('localhost') ? 'local-relay' : 'public-relay');
        return {
            relayWsPort: this.options.wsPort,
            relayWsUrl,
            relayLabel,
            relayNamespace,
            viewerBaseUrl,
            shareJoinBaseUrl: `${viewerBaseUrl.replace(/\/$/, '')}/join`,
            debugHttpEnabled: this.options.debugHttpEnabled === true,
            corsEnabled: this.options.corsEnabled === true,
            heartbeatTimeoutMs: this.heartbeatTimeoutMs,
            totalSessions: sessions.length,
            activeSessions,
            staleSessions,
            checkedAt: Date.now(),
        };
    }
    /**
     * 세션의 접근/공유 메타데이터 반환
     */
    getSessionAccess(sessionId) {
        const resolved = this.resolveCanonicalSessionId(sessionId);
        return this.sessionAccess.get(resolved.canonicalSessionId);
    }
    listSessionOpsSummaries() {
        return Array.from(this.sessions.values())
            .map((session) => {
            const access = this.sessionAccess.get(session.sessionId);
            const driverProfile = this.deriveDriverProfile(session.latestState);
            if (access) {
                access.driverLabel = driverProfile.driverLabel;
                access.carLabel = driverProfile.carLabel;
            }
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
                strategySecondaryLabel: strategy.strategyUnavailable
                    ? null
                    : strategy.secondaryRecommendation ?? null,
                strategySeverity: strategy.strategyUnavailable
                    ? null
                    : strategy.severity,
                strategyTrafficBand: strategy.strategyUnavailable
                    ? null
                    : strategy.signals.expectedRejoinBand,
                strategyConfidence: strategy.strategyUnavailable
                    ? null
                    : strategy.confidenceScore,
                strategyStability: strategy.strategyUnavailable
                    ? null
                    : strategy.stabilityScore,
                strategyChanged: strategy.strategyUnavailable
                    ? null
                    : strategy.recommendationChanged,
                strategyTrendReason: strategy.strategyUnavailable
                    ? null
                    : strategy.trendReason,
                strategyPitWindowHint: strategy.strategyUnavailable
                    ? null
                    : strategy.signals.pitWindowHint,
                strategyRejoinRiskHint: strategy.strategyUnavailable
                    ? null
                    : strategy.signals.rejoinRiskHint,
                strategyTyreUrgency: strategy.strategyUnavailable
                    ? null
                    : strategy.signals.tyreUrgencyScore,
                strategyFuelRisk: strategy.strategyUnavailable
                    ? null
                    : strategy.signals.fuelRiskScore,
                strategyUndercut: strategy.strategyUnavailable
                    ? null
                    : strategy.signals.undercutScore,
                strategyOvercut: strategy.strategyUnavailable
                    ? null
                    : strategy.signals.overcutScore,
                strategyTrafficRisk: strategy.strategyUnavailable
                    ? null
                    : strategy.signals.trafficRiskScore,
                strategyPitLoss: strategy.strategyUnavailable
                    ? null
                    : strategy.signals.pitLossHeuristic,
                strategyCleanAirProbability: strategy.strategyUnavailable
                    ? null
                    : strategy.signals.cleanAirProbability,
                strategyLapsRemaining: strategy.strategyUnavailable
                    ? null
                    : strategy.signals.lapsRemaining,
                strategyGeneratedAt: strategy.generatedAt,
                strategyUnavailable: strategy.strategyUnavailable,
                strategySyncingCanonicalSession: strategy.strategyUnavailable
                    ? false
                    : strategy.syncingCanonicalSession,
                strategySyncingUntil: strategy.strategyUnavailable
                    ? null
                    : strategy.syncingUntil,
            };
        })
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }
    getSessionStrategy(sessionId) {
        const resolved = this.resolveCanonicalSessionId(sessionId);
        const session = this.sessions.get(resolved.canonicalSessionId);
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
        const resolved = this.resolveCanonicalSessionId(sessionId);
        return this.notesStore.listNotes(resolved.canonicalSessionId);
    }
    addSessionNote(sessionId, payload) {
        const resolved = this.resolveCanonicalSessionId(sessionId);
        const note = this.notesStore.addNote(resolved.canonicalSessionId, payload);
        this.archiveStore.recordNote(note);
        return note;
    }
    deleteSessionNote(sessionId, noteId) {
        const resolved = this.resolveCanonicalSessionId(sessionId);
        return this.notesStore.deleteNote(resolved.canonicalSessionId, noteId);
    }
    getSessionTimeline(sessionId, limit = 100) {
        const resolved = this.resolveCanonicalSessionId(sessionId);
        const canonicalSessionId = resolved.canonicalSessionId;
        const notes = this.notesStore
            .listNotes(canonicalSessionId)
            .map((note) => ({
            kind: 'note',
            timestamp: note.timestamp,
            note,
        }));
        const opsEvents = this.recentOpsEvents
            .getRecent(300)
            .filter((event) => event.sessionId === canonicalSessionId)
            .map((event) => ({
            kind: 'ops_event',
            timestamp: event.timestamp,
            event,
        }));
        return [...notes, ...opsEvents]
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-Math.max(1, Math.min(500, limit)));
    }
    listSessionArchives(limit = 100) {
        return this.archiveStore.listArchiveSummaries(limit);
    }
    getSessionArchive(sessionId) {
        const resolved = this.resolveCanonicalSessionId(sessionId);
        return this.archiveStore.getArchiveBySession(resolved.canonicalSessionId);
    }
    getSessionArchiveSummary(sessionId) {
        const resolved = this.resolveCanonicalSessionId(sessionId);
        return this.archiveStore.getArchiveSummary(resolved.canonicalSessionId);
    }
    getSessionArchiveTimeline(sessionId, limit = 500) {
        const resolved = this.resolveCanonicalSessionId(sessionId);
        return this.archiveStore.getArchiveTimeline(resolved.canonicalSessionId, limit);
    }
    /**
     * 세션 접근 정책을 업데이트 (shareEnabled, visibility)
     * PATCH /api/viewer/session-access/:sessionId에서 호출
     */
    updateSessionAccess(sessionId, patch) {
        const resolved = this.resolveCanonicalSessionId(sessionId);
        const canonicalSessionId = resolved.canonicalSessionId;
        const access = this.sessionAccess.get(canonicalSessionId);
        if (!access)
            return undefined;
        let changed = false;
        if (patch.shareEnabled !== undefined &&
            patch.shareEnabled !== access.shareEnabled) {
            const previousShareEnabled = access.shareEnabled;
            access.shareEnabled = patch.shareEnabled;
            changed = true;
            this.emitOpsEvent('share_enabled_changed', canonicalSessionId, {
                previousShareEnabled,
                nextShareEnabled: access.shareEnabled,
            });
        }
        if (patch.visibility !== undefined &&
            patch.visibility !== access.visibility) {
            const previousVisibility = access.visibility;
            access.visibility = patch.visibility;
            changed = true;
            this.emitOpsEvent('visibility_changed', canonicalSessionId, {
                previousVisibility,
                nextVisibility: access.visibility,
            });
        }
        if (patch.roomTitle !== undefined) {
            const normalizedTitle = String(patch.roomTitle).trim().slice(0, 80);
            if (normalizedTitle && normalizedTitle !== access.roomTitle) {
                access.roomTitle = normalizedTitle;
                changed = true;
            }
        }
        if (patch.roomPassword !== undefined) {
            const normalizedPassword = String(patch.roomPassword || '').trim().slice(0, 64) || null;
            if (normalizedPassword !== access.roomPassword) {
                access.roomPassword = normalizedPassword;
                changed = true;
            }
        }
        if (patch.permissionCode !== undefined) {
            const normalizedPermission = String(patch.permissionCode || '').trim().toUpperCase().slice(0, 24)
                || this.generatePermissionCode();
            if (normalizedPermission !== access.permissionCode) {
                access.permissionCode = normalizedPermission;
                changed = true;
            }
        }
        if (changed) {
            access.updatedAt = Date.now();
            this.archiveStore.updateAccessMetadata(canonicalSessionId, {
                joinCode: access.joinCode,
                visibility: access.visibility,
            });
        }
        return access;
    }
    /**
     * 세션ID로 세션을 조회합니다. (향후 joinCode/visibility validation 확장 가능)
     */
    getSession(sessionId) {
        const resolved = this.resolveCanonicalSessionId(sessionId);
        return this.sessions.get(resolved.canonicalSessionId);
    }
    /**
     * 세션 health 상태를 계산합니다.
     * heartbeat 수신 간격을 기준으로 healthy / delayed / stale_risk / stale 네 단계를 반환합니다.
     */
    getSessionHealth(sessionId) {
        const now = Date.now();
        const resolved = this.resolveCanonicalSessionId(sessionId);
        const canonicalSessionId = resolved.canonicalSessionId;
        const session = this.sessions.get(canonicalSessionId);
        if (!session) {
            return {
                sessionId: canonicalSessionId,
                sessionFound: false,
                relayStatus: 'not_found',
                heartbeatAgeMs: -1,
                relayFreshnessMs: -1,
                snapshotFreshnessMs: -1,
                healthLevel: 'stale',
                checkedAt: now,
            };
        }
        const heartbeatAgeMs = now - session.lastHeartbeatAt;
        const relayFreshnessMs = now - session.updatedAt;
        const snapshotFreshnessMs = session.latestState ? relayFreshnessMs : -1;
        const healthLevel = deriveSessionHealthLevel(session.status, heartbeatAgeMs, !!session.latestState);
        return {
            sessionId: canonicalSessionId,
            sessionFound: true,
            relayStatus: session.status,
            heartbeatAgeMs,
            relayFreshnessMs,
            snapshotFreshnessMs,
            healthLevel,
            checkedAt: now,
        };
    }
    isSyncingCanonicalSession(sessionId) {
        const syncingUntil = this.sessionSyncUntil.get(sessionId) ?? null;
        if (syncingUntil == null) {
            return { syncingCanonicalSession: false, syncingUntil: null };
        }
        if (Date.now() > syncingUntil) {
            this.sessionSyncUntil.delete(sessionId);
            return { syncingCanonicalSession: false, syncingUntil: null };
        }
        return { syncingCanonicalSession: true, syncingUntil };
    }
    computeSessionStrategy(session) {
        const cached = this.strategyCache.get(session.sessionId);
        if (cached &&
            session.latestState &&
            cached.latestSequence != null &&
            cached.latestSequence === session.latestSequence) {
            return cached.result;
        }
        const previousStrategy = cached && !cached.result.strategyUnavailable
            ? cached.result
            : undefined;
        const input = this.buildStrategyInput(session, previousStrategy);
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
        const result = this.strategyEngine.evaluate(input);
        this.strategyCache.set(session.sessionId, {
            latestSequence: session.latestSequence ?? null,
            result,
        });
        return result;
    }
    buildStrategyInput(session, previousStrategy) {
        const now = Date.now();
        const syncing = this.isSyncingCanonicalSession(session.sessionId);
        const hasSnapshot = !!session.latestState;
        const state = session.latestState;
        if (!hasSnapshot || !state) {
            return {
                sessionId: session.sessionId,
                relayStatus: session.status,
                isStale: session.status === 'stale',
                syncingCanonicalSession: syncing.syncingCanonicalSession,
                syncingUntil: syncing.syncingUntil,
                hasSnapshot: false,
                latestSequence: session.latestSequence ?? null,
                currentLap: null,
                totalLaps: null,
                position: null,
                tyreAgeLaps: null,
                fuelRemaining: null,
                fuelLapsRemaining: null,
                pitStatus: null,
                tyreCompound: null,
                previousStrategy: previousStrategy
                    ? {
                        recommendation: previousStrategy.recommendation,
                        secondaryRecommendation: previousStrategy.secondaryRecommendation,
                        severity: previousStrategy.severity,
                        confidenceScore: previousStrategy.confidenceScore,
                        stabilityScore: previousStrategy.stabilityScore,
                        signals: previousStrategy.signals,
                        generatedAt: previousStrategy.generatedAt,
                    }
                    : null,
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
            syncingCanonicalSession: syncing.syncingCanonicalSession,
            syncingUntil: syncing.syncingUntil,
            hasSnapshot,
            latestSequence: session.latestSequence ?? null,
            currentLap: playerCar.currentLapNum ?? state.sessionMeta?.currentLap ?? null,
            totalLaps: state.sessionMeta?.totalLaps ?? null,
            position: playerCar.position ?? null,
            tyreAgeLaps: playerCar.tyreAgeLaps ?? null,
            fuelRemaining: playerCar.fuelRemaining ?? null,
            fuelLapsRemaining: playerCar.fuelLapsRemaining ?? null,
            pitStatus: playerCar.pitStatus ?? null,
            tyreCompound: playerCar.tyreCompound ?? null,
            previousStrategy: previousStrategy
                ? {
                    recommendation: previousStrategy.recommendation,
                    secondaryRecommendation: previousStrategy.secondaryRecommendation,
                    severity: previousStrategy.severity,
                    confidenceScore: previousStrategy.confidenceScore,
                    stabilityScore: previousStrategy.stabilityScore,
                    signals: previousStrategy.signals,
                    generatedAt: previousStrategy.generatedAt,
                }
                : null,
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
    generatePermissionCode(length = 8) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < length; i += 1) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }
    deriveDriverProfile(state) {
        if (!state) {
            return {
                driverLabel: null,
                carLabel: null,
            };
        }
        const playerIndex = state.playerCarIndex;
        if (playerIndex === null || playerIndex === undefined) {
            return {
                driverLabel: null,
                carLabel: null,
            };
        }
        const driver = state.drivers?.[playerIndex];
        const car = state.cars?.[playerIndex];
        return {
            driverLabel: driver?.driverName || null,
            carLabel: driver?.teamName || car?.tyreCompound || null,
        };
    }
    handleConnection(ws) {
        const connId = uuidv4();
        this.logger.info(`[Relay] New connection: ${connId}`);
        this.connToWs.set(connId, ws);
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
        this.trackConnectionForSession(connId, sessionId);
        this.connToLastSequence.set(connId, 0);
        this.logger.info(`[Relay] session_started: ${sessionId} (host=${connId})`);
        ws.send(JSON.stringify({ type: 'session_started', sessionId, role: 'host' }));
        // 5단계: 세션 생성 시 joinCode 및 access record 생성
        const joinCode = this.generateJoinCode();
        const access = {
            sessionId,
            joinCode,
            roomTitle: `Room ${joinCode}`,
            roomPassword: null,
            permissionCode: this.generatePermissionCode(),
            driverLabel: null,
            carLabel: null,
            visibility: 'private',
            shareEnabled: false,
            createdAt: now,
            updatedAt: now,
        };
        this.joinCodeToSessionId.set(joinCode, sessionId);
        this.sessionAccess.set(sessionId, access);
        this.strategyCache.delete(sessionId);
        this.archiveStore.startRecording({
            sessionId,
            startedAt: now,
            createdAt: now,
            joinCode,
            visibility: access.visibility,
        });
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
        if (typeof msg.sequence !== 'number' || !msg.state)
            return;
        const lastConnSequence = this.connToLastSequence.get(connId) ?? 0;
        if (msg.sequence <= lastConnSequence) {
            this.logger.warn(`[Relay] Out-of-order snapshot (seq=${msg.sequence}) for conn ${connId}`);
            return;
        }
        this.connToLastSequence.set(connId, msg.sequence);
        const telemetrySessionUid = typeof msg.state?.sessionMeta?.sessionUID === 'string'
            ? msg.state.sessionMeta.sessionUID
            : null;
        const canonicalSessionId = this.resolveCanonicalSessionForTelemetry(sessionId, telemetrySessionUid, connId);
        const session = this.sessions.get(canonicalSessionId);
        if (!session)
            return;
        session.latestSequence = Math.max(session.latestSequence, msg.sequence);
        session.latestState = msg.state;
        session.updatedAt = Date.now();
        const strategy = this.computeSessionStrategy(session);
        this.archiveStore.recordSnapshot(canonicalSessionId, msg.sequence, msg.timestamp, msg.state, toArchiveRecommendationSnapshot(strategy, Date.now()));
        this.logger.debug(`[Relay] state_snapshot seq=${msg.sequence} for session ${canonicalSessionId}`);
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
        this.connToWs.delete(connId);
        this.connToLastSequence.delete(connId);
        if (sessionId) {
            this.untrackConnectionForSession(connId, sessionId);
            const session = this.sessions.get(sessionId);
            if (session) {
                const activeConnections = this.sessionToConnections.get(sessionId);
                if (!activeConnections || activeConnections.size === 0) {
                    const previousStatus = session.status;
                    session.status = 'stale';
                    this.logger.info(`[Relay] Connection closed: ${connId}, session ${sessionId} marked stale`);
                    if (previousStatus !== 'stale') {
                        this.emitOpsEvent('session_stale', sessionId, {
                            reason: 'connection_closed',
                            previousStatus,
                        });
                        this.finalizeArchiveForSession(session, 'session_stale', Date.now());
                    }
                }
            }
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
                // Conservative replay model: stale transition can mark a partial archive boundary.
                this.finalizeArchiveForSession(session, 'session_stale', now);
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
        this.archiveStore.recordOpsEvent(event);
    }
    finalizeArchiveForSession(session, reason, endedAt) {
        if (!this.archiveStore.hasActiveRecording(session.sessionId)) {
            return;
        }
        const strategy = this.computeSessionStrategy(session);
        const lastRecommendation = strategy.strategyUnavailable
            ? null
            : strategy.primaryRecommendation ?? strategy.recommendation;
        this.archiveStore.finalizeSessionArchive(session.sessionId, {
            endedAt,
            latestSequence: session.latestSequence ?? null,
            lastKnownStatus: session.status,
            reason,
            lastRecommendation,
        });
    }
    generateSessionId() {
        return 'S-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    }
    trackConnectionForSession(connId, sessionId) {
        let set = this.sessionToConnections.get(sessionId);
        if (!set) {
            set = new Set();
            this.sessionToConnections.set(sessionId, set);
        }
        set.add(connId);
    }
    untrackConnectionForSession(connId, sessionId) {
        const set = this.sessionToConnections.get(sessionId);
        if (!set)
            return;
        set.delete(connId);
        if (set.size === 0) {
            this.sessionToConnections.delete(sessionId);
        }
    }
    resolveCanonicalSessionForTelemetry(currentSessionId, telemetrySessionUid, connId) {
        const currentCanonicalSessionId = this.resolveCanonicalSessionId(currentSessionId).canonicalSessionId;
        if (!telemetrySessionUid || telemetrySessionUid.length === 0) {
            return currentCanonicalSessionId;
        }
        const mappedSessionId = this.telemetrySessionUidToSessionId.get(telemetrySessionUid);
        if (!mappedSessionId) {
            this.telemetrySessionUidToSessionId.set(telemetrySessionUid, currentCanonicalSessionId);
            return currentCanonicalSessionId;
        }
        const mappedCanonicalSessionId = this.resolveCanonicalSessionId(mappedSessionId).canonicalSessionId;
        if (mappedCanonicalSessionId === currentCanonicalSessionId) {
            this.telemetrySessionUidToSessionId.set(telemetrySessionUid, mappedCanonicalSessionId);
            return mappedCanonicalSessionId;
        }
        const currentSession = this.sessions.get(currentCanonicalSessionId);
        const mappedSession = this.sessions.get(mappedCanonicalSessionId);
        if (!currentSession && mappedSession) {
            this.untrackConnectionForSession(connId, currentCanonicalSessionId);
            this.trackConnectionForSession(connId, mappedCanonicalSessionId);
            this.connToSession.set(connId, mappedCanonicalSessionId);
            this.telemetrySessionUidToSessionId.set(telemetrySessionUid, mappedCanonicalSessionId);
            return mappedCanonicalSessionId;
        }
        if (currentSession && !mappedSession) {
            this.telemetrySessionUidToSessionId.set(telemetrySessionUid, currentCanonicalSessionId);
            return currentCanonicalSessionId;
        }
        if (!currentSession || !mappedSession) {
            this.telemetrySessionUidToSessionId.set(telemetrySessionUid, currentCanonicalSessionId);
            return currentCanonicalSessionId;
        }
        const canonicalSessionId = this.pickCanonicalSessionId(currentSession, mappedSession);
        const aliasSessionId = canonicalSessionId === currentCanonicalSessionId
            ? mappedCanonicalSessionId
            : currentCanonicalSessionId;
        this.telemetrySessionUidToSessionId.set(telemetrySessionUid, canonicalSessionId);
        this.mergeSessionAlias(aliasSessionId, canonicalSessionId, telemetrySessionUid);
        return canonicalSessionId;
    }
    pickCanonicalSessionId(left, right) {
        if (left.latestSequence !== right.latestSequence) {
            return left.latestSequence >= right.latestSequence
                ? left.sessionId
                : right.sessionId;
        }
        const leftConnections = this.sessionToConnections.get(left.sessionId)?.size ?? 0;
        const rightConnections = this.sessionToConnections.get(right.sessionId)?.size ?? 0;
        if (leftConnections !== rightConnections) {
            return leftConnections >= rightConnections ? left.sessionId : right.sessionId;
        }
        if (left.updatedAt !== right.updatedAt) {
            return left.updatedAt >= right.updatedAt ? left.sessionId : right.sessionId;
        }
        if (left.createdAt !== right.createdAt) {
            return left.createdAt <= right.createdAt ? left.sessionId : right.sessionId;
        }
        return left.sessionId <= right.sessionId ? left.sessionId : right.sessionId;
    }
    mergeSessionAlias(aliasSessionId, canonicalSessionId, telemetrySessionUid) {
        if (aliasSessionId === canonicalSessionId) {
            return;
        }
        const aliasSession = this.sessions.get(aliasSessionId);
        const canonicalSession = this.sessions.get(canonicalSessionId);
        if (!aliasSession || !canonicalSession) {
            return;
        }
        const mergedAt = Date.now();
        this.rebindSessionConnections(aliasSessionId, canonicalSessionId, telemetrySessionUid, mergedAt);
        if (aliasSession.latestSequence > canonicalSession.latestSequence ||
            (aliasSession.latestSequence === canonicalSession.latestSequence &&
                aliasSession.updatedAt > canonicalSession.updatedAt)) {
            canonicalSession.latestSequence = aliasSession.latestSequence;
            canonicalSession.latestState = aliasSession.latestState;
        }
        else if (!canonicalSession.latestState && aliasSession.latestState) {
            canonicalSession.latestState = aliasSession.latestState;
        }
        canonicalSession.updatedAt = Math.max(canonicalSession.updatedAt, aliasSession.updatedAt, mergedAt);
        canonicalSession.lastHeartbeatAt = Math.max(canonicalSession.lastHeartbeatAt, aliasSession.lastHeartbeatAt, mergedAt);
        canonicalSession.status = 'active';
        this.remapJoinCodes(aliasSessionId, canonicalSessionId);
        this.mergeSessionAccessRecords(aliasSessionId, canonicalSessionId, mergedAt);
        this.notesStore.mergeSessions(aliasSessionId, canonicalSessionId);
        this.archiveStore.mergeActiveRecordings(aliasSessionId, canonicalSessionId);
        this.mergeStrategyCaches(aliasSessionId, canonicalSessionId);
        this.sessions.delete(aliasSessionId);
        this.strategyCache.delete(aliasSessionId);
        this.sessionAliasToCanonical.set(aliasSessionId, {
            canonicalSessionId,
            telemetrySessionUid,
            mergedAt,
        });
        this.sessionSyncUntil.set(canonicalSessionId, mergedAt + 8000);
        this.emitOpsEvent('session_rebound', canonicalSessionId, {
            previousSessionId: aliasSessionId,
            canonicalSessionId,
            telemetrySessionUid,
            mergedAt,
        });
        this.logger.info(`[Relay] Merged telemetry session ${telemetrySessionUid}: ${aliasSessionId} -> ${canonicalSessionId}`);
    }
    rebindSessionConnections(fromSessionId, toSessionId, telemetrySessionUid, mergedAt) {
        const sourceConnections = Array.from(this.sessionToConnections.get(fromSessionId) ?? []);
        for (const connectionId of sourceConnections) {
            this.untrackConnectionForSession(connectionId, fromSessionId);
            this.trackConnectionForSession(connectionId, toSessionId);
            this.connToSession.set(connectionId, toSessionId);
            const ws = this.connToWs.get(connectionId);
            if (!ws) {
                continue;
            }
            ws.send(JSON.stringify({
                type: 'session_rebound',
                sessionId: toSessionId,
                previousSessionId: fromSessionId,
                telemetrySessionUid,
                mergedAt,
            }));
        }
    }
    remapJoinCodes(fromSessionId, toSessionId) {
        for (const [joinCode, mappedSessionId] of this.joinCodeToSessionId.entries()) {
            if (mappedSessionId === fromSessionId) {
                this.joinCodeToSessionId.set(joinCode, toSessionId);
            }
        }
    }
    mergeSessionAccessRecords(fromSessionId, toSessionId, mergedAt) {
        const sourceAccess = this.sessionAccess.get(fromSessionId);
        const targetAccess = this.sessionAccess.get(toSessionId);
        if (!sourceAccess && !targetAccess) {
            return;
        }
        if (!targetAccess && sourceAccess) {
            this.sessionAccess.set(toSessionId, {
                ...sourceAccess,
                sessionId: toSessionId,
                updatedAt: Math.max(sourceAccess.updatedAt, mergedAt),
            });
            this.sessionAccess.delete(fromSessionId);
            if (sourceAccess.joinCode) {
                this.joinCodeToSessionId.set(sourceAccess.joinCode, toSessionId);
            }
            return;
        }
        if (sourceAccess && targetAccess) {
            if (!targetAccess.roomTitle && sourceAccess.roomTitle) {
                targetAccess.roomTitle = sourceAccess.roomTitle;
            }
            if (!targetAccess.roomPassword && sourceAccess.roomPassword) {
                targetAccess.roomPassword = sourceAccess.roomPassword;
            }
            if (!targetAccess.permissionCode && sourceAccess.permissionCode) {
                targetAccess.permissionCode = sourceAccess.permissionCode;
            }
            if (!targetAccess.driverLabel && sourceAccess.driverLabel) {
                targetAccess.driverLabel = sourceAccess.driverLabel;
            }
            if (!targetAccess.carLabel && sourceAccess.carLabel) {
                targetAccess.carLabel = sourceAccess.carLabel;
            }
            targetAccess.visibility =
                targetAccess.visibility === 'code' || sourceAccess.visibility === 'code'
                    ? 'code'
                    : 'private';
            targetAccess.shareEnabled = targetAccess.shareEnabled || sourceAccess.shareEnabled;
            targetAccess.createdAt = Math.min(targetAccess.createdAt, sourceAccess.createdAt);
            targetAccess.updatedAt = Math.max(targetAccess.updatedAt, sourceAccess.updatedAt, mergedAt);
            if (sourceAccess.joinCode) {
                this.joinCodeToSessionId.set(sourceAccess.joinCode, toSessionId);
            }
            if (targetAccess.joinCode) {
                this.joinCodeToSessionId.set(targetAccess.joinCode, toSessionId);
            }
            this.archiveStore.updateAccessMetadata(toSessionId, {
                joinCode: targetAccess.joinCode,
                visibility: targetAccess.visibility,
            });
        }
        this.sessionAccess.delete(fromSessionId);
    }
    mergeStrategyCaches(fromSessionId, toSessionId) {
        const sourceCache = this.strategyCache.get(fromSessionId);
        const targetCache = this.strategyCache.get(toSessionId);
        if (!sourceCache) {
            return;
        }
        if (!targetCache) {
            this.strategyCache.set(toSessionId, sourceCache);
            return;
        }
        const sourceSeq = sourceCache.latestSequence ?? -1;
        const targetSeq = targetCache.latestSequence ?? -1;
        if (sourceSeq > targetSeq) {
            this.strategyCache.set(toSessionId, sourceCache);
        }
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
