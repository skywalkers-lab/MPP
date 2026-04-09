// relay/RelayServer.ts
// F1 25 Realtime Relay Core - WebSocket 기반 세션별 상태 중계 서버

import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { CurrentRaceState } from '../model/CurrentRaceState';
import { ConsoleLogger } from '../debug/ConsoleLogger';
import express from 'express';
import {
  CompositeOpsNotifier,
  ConsoleOpsNotifier,
  deriveSessionHealthLevel,
  InMemoryRecentOpsEvents,
  OpsEvent,
  OpsEventType,
  serializeSessionOpsSummary,
  SessionOpsSummary,
} from './ops';
import {
  AddSessionNoteInput,
  InMemorySessionNotesStore,
  SessionNote,
} from './notes';
import { StrategyEngine } from './strategyEngine';
import {
  StrategyEngineInput,
  StrategyEvaluationResult,
  StrategyRecommendationResult,
  StrategyUnavailableResult,
} from './strategy';
import {
  ArchiveSummary,
  ArchiveTimelineItem,
  InMemorySessionArchiveStore,
  SessionArchive,
  toArchiveRecommendationSnapshot,
} from './archive';

export type SessionVisibility = 'private' | 'code'; // public은 추후 확장

export interface SessionAccessRecord {
  sessionId: string;
  joinCode: string;
  roomTitle: string;
  roomPassword: string | null;
  permissionCode: string;
  driverLabel: string | null;
  carLabel: string | null;
  visibility: SessionVisibility;
  shareEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SessionAccessSummary {
  sessionId: string;
  joinCode: string;
  roomTitle: string;
  passwordEnabled: boolean;
  driverLabel: string | null;
  carLabel: string | null;
  roomPassword?: string | null;
  permissionCode?: string;
  visibility: SessionVisibility;
  shareEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export function serializeSessionAccess(
  access: SessionAccessRecord | undefined,
  options?: { includeSecrets?: boolean }
): SessionAccessSummary | null {
  if (!access) return null;
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
  publicViewerBaseUrl?: string;
  publicRelayWsUrl?: string;
  relayLabel?: string;
  relayNamespace?: string;
  debugHttpEnabled?: boolean;
  corsEnabled?: boolean;
}

export interface CanonicalSessionResolution {
  canonicalSessionId: string;
  rebound: {
    previousSessionId: string;
    telemetrySessionUid: string;
    mergedAt: number;
  } | null;
}

export interface RelayRuntimeInfo {
  relayWsPort: number;
  relayWsUrl: string;
  relayLabel: string;
  relayNamespace: string;
  viewerBaseUrl: string;
  shareJoinBaseUrl: string;
  debugHttpEnabled: boolean;
  corsEnabled: boolean;
  heartbeatTimeoutMs: number;
  totalSessions: number;
  activeSessions: number;
  staleSessions: number;
  checkedAt: number;
}

export class RelayServer {
  private wss: WebSocketServer;
  private heartbeatTimer?: NodeJS.Timeout;
  private debugHttpServer?: HttpServer;
  private sessions: Map<string, RelaySession> = new Map();
  private connToSession: Map<string, string> = new Map();
  private connToWs: Map<string, WebSocket> = new Map();
  private connToLastSequence: Map<string, number> = new Map();
  private sessionToConnections: Map<string, Set<string>> = new Map();
  private telemetrySessionUidToSessionId: Map<string, string> = new Map();
  private sessionAliasToCanonical = new Map<
    string,
    { canonicalSessionId: string; telemetrySessionUid: string; mergedAt: number }
  >();
  private sessionSyncUntil = new Map<string, number>();
  private logger: ConsoleLogger;
  private heartbeatTimeoutMs: number;

  // 5단계: joinCode → sessionId 매핑 및 access record 관리
  private joinCodeToSessionId: Map<string, string> = new Map();
  private sessionAccess: Map<string, SessionAccessRecord> = new Map();
  private readonly recentOpsEvents = new InMemoryRecentOpsEvents(300);
  private readonly notesStore = new InMemorySessionNotesStore();
  private readonly strategyEngine = new StrategyEngine();
  private readonly strategyCache = new Map<
    string,
    { latestSequence: number | null; result: StrategyEvaluationResult }
  >();
  private readonly archiveStore = new InMemorySessionArchiveStore();
  private readonly opsNotifier = new CompositeOpsNotifier([
    this.recentOpsEvents,
    new ConsoleOpsNotifier(),
  ]);

  constructor(private options: RelayServerOptions) {
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

  public close() {
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
  public resolveJoinCode(joinCode: string): {
    sessionId?: string;
    access?: SessionAccessRecord;
  } {
    const sessionId = this.joinCodeToSessionId.get(joinCode);
    if (!sessionId) return {};

    const resolved = this.resolveCanonicalSessionId(sessionId);
    const access = this.sessionAccess.get(resolved.canonicalSessionId);
    return { sessionId: resolved.canonicalSessionId, access };
  }

  public resolveCanonicalSessionId(sessionId: string): CanonicalSessionResolution {
    let cursor = sessionId;
    let rebound: CanonicalSessionResolution['rebound'] = null;
    const visited = new Set<string>();

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

  public getRelayRuntimeInfo(): RelayRuntimeInfo {
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
  public getSessionAccess(sessionId: string): SessionAccessRecord | undefined {
    const resolved = this.resolveCanonicalSessionId(sessionId);
    return this.sessionAccess.get(resolved.canonicalSessionId);
  }

  public listSessionOpsSummaries(): SessionOpsSummary[] {
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

  public getSessionStrategy(sessionId: string): StrategyEvaluationResult {
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

  public getRecentOpsEvents(limit: number = 50): OpsEvent[] {
    return this.recentOpsEvents.getRecent(limit);
  }

  public listSessionNotes(sessionId: string): SessionNote[] {
    const resolved = this.resolveCanonicalSessionId(sessionId);
    return this.notesStore.listNotes(resolved.canonicalSessionId);
  }

  public addSessionNote(
    sessionId: string,
    payload: AddSessionNoteInput
  ): SessionNote {
    const resolved = this.resolveCanonicalSessionId(sessionId);
    const note = this.notesStore.addNote(resolved.canonicalSessionId, payload);
    this.archiveStore.recordNote(note);
    return note;
  }

  public deleteSessionNote(sessionId: string, noteId: string): boolean {
    const resolved = this.resolveCanonicalSessionId(sessionId);
    return this.notesStore.deleteNote(resolved.canonicalSessionId, noteId);
  }

  public getSessionTimeline(sessionId: string, limit: number = 100) {
    const resolved = this.resolveCanonicalSessionId(sessionId);
    const canonicalSessionId = resolved.canonicalSessionId;
    const notes = this.notesStore
      .listNotes(canonicalSessionId)
      .map((note) => ({
        kind: 'note' as const,
        timestamp: note.timestamp,
        note,
      }));

    const opsEvents = this.recentOpsEvents
      .getRecent(300)
      .filter((event) => event.sessionId === canonicalSessionId)
      .map((event) => ({
        kind: 'ops_event' as const,
        timestamp: event.timestamp,
        event,
      }));

    return [...notes, ...opsEvents]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-Math.max(1, Math.min(500, limit)));
  }

  public listSessionArchives(limit: number = 100): ArchiveSummary[] {
    return this.archiveStore.listArchiveSummaries(limit);
  }

  public getSessionArchive(sessionId: string): SessionArchive | undefined {
    const resolved = this.resolveCanonicalSessionId(sessionId);
    return this.archiveStore.getArchiveBySession(resolved.canonicalSessionId);
  }

  public getSessionArchiveSummary(sessionId: string): ArchiveSummary | undefined {
    const resolved = this.resolveCanonicalSessionId(sessionId);
    return this.archiveStore.getArchiveSummary(resolved.canonicalSessionId);
  }

  public getSessionArchiveTimeline(
    sessionId: string,
    limit: number = 500
  ): ArchiveTimelineItem[] {
    const resolved = this.resolveCanonicalSessionId(sessionId);
    return this.archiveStore.getArchiveTimeline(resolved.canonicalSessionId, limit);
  }

  /**
   * 세션 접근 정책을 업데이트 (shareEnabled, visibility)
   * PATCH /api/viewer/session-access/:sessionId에서 호출
   */
  public updateSessionAccess(
    sessionId: string,
    patch: Partial<
      Pick<
        SessionAccessRecord,
        'shareEnabled' | 'visibility' | 'roomTitle' | 'roomPassword' | 'permissionCode'
      >
    >
  ): SessionAccessRecord | undefined {
    const resolved = this.resolveCanonicalSessionId(sessionId);
    const canonicalSessionId = resolved.canonicalSessionId;
    const access = this.sessionAccess.get(canonicalSessionId);
    if (!access) return undefined;

    let changed = false;

    if (
      patch.shareEnabled !== undefined &&
      patch.shareEnabled !== access.shareEnabled
    ) {
      const previousShareEnabled = access.shareEnabled;
      access.shareEnabled = patch.shareEnabled;
      changed = true;
      this.emitOpsEvent('share_enabled_changed', canonicalSessionId, {
        previousShareEnabled,
        nextShareEnabled: access.shareEnabled,
      });
    }

    if (
      patch.visibility !== undefined &&
      patch.visibility !== access.visibility
    ) {
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
  public getSession(sessionId: string): RelaySession | undefined {
    const resolved = this.resolveCanonicalSessionId(sessionId);
    return this.sessions.get(resolved.canonicalSessionId);
  }

  /**
   * 세션 health 상태를 계산합니다.
   * heartbeat 수신 간격을 기준으로 healthy / delayed / stale_risk / stale 네 단계를 반환합니다.
   */
  public getSessionHealth(sessionId: string): {
    sessionId: string;
    sessionFound: boolean;
    relayStatus: string;
    heartbeatAgeMs: number;
    relayFreshnessMs: number;
    snapshotFreshnessMs: number;
    healthLevel: 'healthy' | 'delayed' | 'stale_risk' | 'stale' | 'connecting';
    checkedAt: number;
  } {
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

    const healthLevel = deriveSessionHealthLevel(
      session.status,
      heartbeatAgeMs,
      !!session.latestState
    );

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

  private isSyncingCanonicalSession(sessionId: string): {
    syncingCanonicalSession: boolean;
    syncingUntil: number | null;
  } {
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

  private computeSessionStrategy(session: RelaySession): StrategyEvaluationResult {
    const cached = this.strategyCache.get(session.sessionId);
    if (
      cached &&
      session.latestState &&
      cached.latestSequence != null &&
      cached.latestSequence === session.latestSequence
    ) {
      return cached.result;
    }

    const previousStrategy =
      cached && !cached.result.strategyUnavailable
        ? cached.result
        : undefined;

    const input = this.buildStrategyInput(session, previousStrategy);
    if (!input) {
      const unavailable: StrategyUnavailableResult = {
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

  private buildStrategyInput(
    session: RelaySession,
    previousStrategy?: StrategyRecommendationResult
  ): StrategyEngineInput | null {
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
        ersPercent: null,
        recentLapTimesMs: [],
        rivals: [],
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
    const playerCar =
      playerCarIndex != null ? state.cars[playerCarIndex] : undefined;

    if (!playerCar) {
      return null;
    }

    const recentLapTimesMs: number[] = [];
    if (playerCar.lastLapTime != null && playerCar.lastLapTime > 0) {
      recentLapTimesMs.push(playerCar.lastLapTime * 1000);
    }
    if (playerCar.bestLapTime != null && playerCar.bestLapTime > 0 &&
        playerCar.bestLapTime !== playerCar.lastLapTime) {
      recentLapTimesMs.push(playerCar.bestLapTime * 1000);
    }

    const rivals = Object.values(state.cars)
      .filter((car): car is (typeof car & { position: number }) =>
        car.carIndex !== playerCarIndex &&
        car.position != null &&
        Number.isFinite(car.position)
      )
      .map(car => ({
        carIndex: car.carIndex,
        position: car.position as number,
        stintAge: car.tyreAgeLaps ?? 0,
        tyreCompound: car.tyreCompound ?? 'unknown',
        gapToLeader: car.gapToLeader != null ? String(car.gapToLeader) : null,
      }));

    return {
      sessionId: session.sessionId,
      relayStatus: session.status,
      isStale: session.status === 'stale',
      syncingCanonicalSession: syncing.syncingCanonicalSession,
      syncingUntil: syncing.syncingUntil,
      hasSnapshot,
      latestSequence: session.latestSequence ?? null,
      currentLap:
        playerCar.currentLapNum ?? state.sessionMeta?.currentLap ?? null,
      totalLaps: state.sessionMeta?.totalLaps ?? null,
      position: playerCar.position ?? null,
      tyreAgeLaps: playerCar.tyreAgeLaps ?? null,
      fuelRemaining: playerCar.fuelRemaining ?? null,
      fuelLapsRemaining: playerCar.fuelLapsRemaining ?? null,
      pitStatus: playerCar.pitStatus ?? null,
      tyreCompound: playerCar.tyreCompound ?? null,
      ersPercent: playerCar.ersLevel ?? null,
      recentLapTimesMs,
      rivals,
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
  private generateJoinCode(): string {
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

  private generatePermissionCode(length: number = 8): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < length; i += 1) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  private deriveDriverProfile(
    state: CurrentRaceState | null
  ): { driverLabel: string | null; carLabel: string | null } {
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

  private handleConnection(ws: WebSocket) {
    const connId = uuidv4();
    this.logger.info(`[Relay] New connection: ${connId}`);
    this.connToWs.set(connId, ws);

    ws.on('message', (data: any) =>
      this.handleMessage(ws, connId, data)
    );
    ws.on('close', () => this.handleClose(connId));
    ws.on('error', (err: Error) =>
      this.logger.warn(`[Relay] WS error: ${err}`)
    );
  }

  private handleMessage(ws: WebSocket, connId: string, data: any) {
    let msg: any;

    try {
      msg = JSON.parse(data.toString());
    } catch {
      this.logger.warn(`[Relay] Invalid JSON from ${connId}`);
      ws.send(JSON.stringify({ type: 'error', error: 'invalid_json' }));
      return;
    }

    if (!msg.type) {
      ws.send(JSON.stringify({ type: 'error', error: 'missing_type' }));
      return;
    }

    if (msg.type === 'host_hello') {
      if (
        typeof msg.protocolVersion !== 'number' ||
        msg.protocolVersion !== 1
      ) {
        ws.send(
          JSON.stringify({
            type: 'error',
            error: 'unsupported_protocol_version',
          })
        );
        return;
      }
    }

    if (msg.type === 'state_snapshot') {
      if (
        typeof msg.sessionId !== 'string' ||
        typeof msg.sequence !== 'number' ||
        typeof msg.timestamp !== 'number' ||
        typeof msg.state !== 'object'
      ) {
        ws.send(
          JSON.stringify({
            type: 'error',
            error: 'invalid_state_snapshot_shape',
          })
        );
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
    this.trackConnectionForSession(connId, sessionId);
    this.connToLastSequence.set(connId, 0);

    this.logger.info(`[Relay] session_started: ${sessionId} (host=${connId})`);
    ws.send(JSON.stringify({ type: 'session_started', sessionId, role: 'host' }));

    // 5단계: 세션 생성 시 joinCode 및 access record 생성
    const joinCode = this.generateJoinCode();
    const access: SessionAccessRecord = {
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

  private handleStateSnapshot(connId: string, msg: any) {
    const sessionId = this.connToSession.get(connId);
    if (!sessionId) return;

    if (typeof msg.sequence !== 'number' || !msg.state) return;

    const lastConnSequence = this.connToLastSequence.get(connId) ?? 0;
    if (msg.sequence <= lastConnSequence) {
      this.logger.warn(
        `[Relay] Out-of-order snapshot (seq=${msg.sequence}) for conn ${connId}`
      );
      return;
    }

    this.connToLastSequence.set(connId, msg.sequence);

    const telemetrySessionUid =
      typeof msg.state?.sessionMeta?.sessionUID === 'string'
        ? msg.state.sessionMeta.sessionUID
        : null;

    const canonicalSessionId = this.resolveCanonicalSessionForTelemetry(
      sessionId,
      telemetrySessionUid,
      connId
    );

    const session = this.sessions.get(canonicalSessionId);
    if (!session) return;

    session.latestSequence = Math.max(session.latestSequence, msg.sequence);
    session.latestState = msg.state;
    session.updatedAt = Date.now();

    const strategy = this.computeSessionStrategy(session);
    this.archiveStore.recordSnapshot(
      canonicalSessionId,
      msg.sequence,
      msg.timestamp,
      msg.state,
      toArchiveRecommendationSnapshot(strategy, Date.now())
    );

    this.logger.debug(
      `[Relay] state_snapshot seq=${msg.sequence} for session ${canonicalSessionId}`
    );
  }

  private handleHeartbeat(connId: string) {
    const sessionId = this.connToSession.get(connId);
    if (!sessionId) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

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

  private handleClose(connId: string) {
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
          this.logger.info(
            `[Relay] Connection closed: ${connId}, session ${sessionId} marked stale`
          );

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

  private checkHeartbeats() {
    const now = Date.now();

    for (const session of this.sessions.values()) {
      if (
        session.status === 'active' &&
        now - session.lastHeartbeatAt > this.heartbeatTimeoutMs
      ) {
        const previousStatus = session.status;
        session.status = 'stale';
        this.logger.warn(
          `[Relay] Heartbeat timeout: session ${session.sessionId} marked stale`
        );
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

  private emitOpsEvent(
    type: OpsEventType,
    sessionId: string,
    payload?: Record<string, unknown>
  ) {
    const event: OpsEvent = {
      eventId: `${type}-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      sessionId,
      timestamp: Date.now(),
      payload,
    };
    this.opsNotifier.notify(event);
    this.archiveStore.recordOpsEvent(event);
  }

  private finalizeArchiveForSession(
    session: RelaySession,
    reason: 'session_stale' | 'session_closed' | 'server_shutdown',
    endedAt: number
  ) {
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

  private generateSessionId(): string {
    return 'S-' + Math.random().toString(36).substr(2, 6).toUpperCase();
  }

  private trackConnectionForSession(connId: string, sessionId: string) {
    let set = this.sessionToConnections.get(sessionId);
    if (!set) {
      set = new Set<string>();
      this.sessionToConnections.set(sessionId, set);
    }
    set.add(connId);
  }

  private untrackConnectionForSession(connId: string, sessionId: string) {
    const set = this.sessionToConnections.get(sessionId);
    if (!set) return;
    set.delete(connId);
    if (set.size === 0) {
      this.sessionToConnections.delete(sessionId);
    }
  }

  private resolveCanonicalSessionForTelemetry(
    currentSessionId: string,
    telemetrySessionUid: string | null,
    connId: string
  ): string {
    const currentCanonicalSessionId =
      this.resolveCanonicalSessionId(currentSessionId).canonicalSessionId;

    if (!telemetrySessionUid || telemetrySessionUid.length === 0) {
      return currentCanonicalSessionId;
    }

    const mappedSessionId = this.telemetrySessionUidToSessionId.get(telemetrySessionUid);
    if (!mappedSessionId) {
      this.telemetrySessionUidToSessionId.set(
        telemetrySessionUid,
        currentCanonicalSessionId
      );
      return currentCanonicalSessionId;
    }

    const mappedCanonicalSessionId =
      this.resolveCanonicalSessionId(mappedSessionId).canonicalSessionId;

    if (mappedCanonicalSessionId === currentCanonicalSessionId) {
      this.telemetrySessionUidToSessionId.set(
        telemetrySessionUid,
        mappedCanonicalSessionId
      );
      return mappedCanonicalSessionId;
    }

    const currentSession = this.sessions.get(currentCanonicalSessionId);
    const mappedSession = this.sessions.get(mappedCanonicalSessionId);

    if (!currentSession && mappedSession) {
      this.untrackConnectionForSession(connId, currentCanonicalSessionId);
      this.trackConnectionForSession(connId, mappedCanonicalSessionId);
      this.connToSession.set(connId, mappedCanonicalSessionId);
      this.telemetrySessionUidToSessionId.set(
        telemetrySessionUid,
        mappedCanonicalSessionId
      );
      return mappedCanonicalSessionId;
    }

    if (currentSession && !mappedSession) {
      this.telemetrySessionUidToSessionId.set(
        telemetrySessionUid,
        currentCanonicalSessionId
      );
      return currentCanonicalSessionId;
    }

    if (!currentSession || !mappedSession) {
      this.telemetrySessionUidToSessionId.set(
        telemetrySessionUid,
        currentCanonicalSessionId
      );
      return currentCanonicalSessionId;
    }

    const canonicalSessionId = this.pickCanonicalSessionId(
      currentSession,
      mappedSession
    );
    const aliasSessionId =
      canonicalSessionId === currentCanonicalSessionId
        ? mappedCanonicalSessionId
        : currentCanonicalSessionId;

    this.telemetrySessionUidToSessionId.set(telemetrySessionUid, canonicalSessionId);
    this.mergeSessionAlias(aliasSessionId, canonicalSessionId, telemetrySessionUid);

    return canonicalSessionId;
  }

  private pickCanonicalSessionId(left: RelaySession, right: RelaySession): string {
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

  private mergeSessionAlias(
    aliasSessionId: string,
    canonicalSessionId: string,
    telemetrySessionUid: string
  ): void {
    if (aliasSessionId === canonicalSessionId) {
      return;
    }

    const aliasSession = this.sessions.get(aliasSessionId);
    const canonicalSession = this.sessions.get(canonicalSessionId);
    if (!aliasSession || !canonicalSession) {
      return;
    }

    const mergedAt = Date.now();
    this.rebindSessionConnections(
      aliasSessionId,
      canonicalSessionId,
      telemetrySessionUid,
      mergedAt
    );

    if (
      aliasSession.latestSequence > canonicalSession.latestSequence ||
      (aliasSession.latestSequence === canonicalSession.latestSequence &&
        aliasSession.updatedAt > canonicalSession.updatedAt)
    ) {
      canonicalSession.latestSequence = aliasSession.latestSequence;
      canonicalSession.latestState = aliasSession.latestState;
    } else if (!canonicalSession.latestState && aliasSession.latestState) {
      canonicalSession.latestState = aliasSession.latestState;
    }

    canonicalSession.updatedAt = Math.max(
      canonicalSession.updatedAt,
      aliasSession.updatedAt,
      mergedAt
    );
    canonicalSession.lastHeartbeatAt = Math.max(
      canonicalSession.lastHeartbeatAt,
      aliasSession.lastHeartbeatAt,
      mergedAt
    );
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

    this.logger.info(
      `[Relay] Merged telemetry session ${telemetrySessionUid}: ${aliasSessionId} -> ${canonicalSessionId}`
    );
  }

  private rebindSessionConnections(
    fromSessionId: string,
    toSessionId: string,
    telemetrySessionUid: string,
    mergedAt: number
  ): void {
    const sourceConnections = Array.from(
      this.sessionToConnections.get(fromSessionId) ?? []
    );

    for (const connectionId of sourceConnections) {
      this.untrackConnectionForSession(connectionId, fromSessionId);
      this.trackConnectionForSession(connectionId, toSessionId);
      this.connToSession.set(connectionId, toSessionId);

      const ws = this.connToWs.get(connectionId);
      if (!ws) {
        continue;
      }

      ws.send(
        JSON.stringify({
          type: 'session_rebound',
          sessionId: toSessionId,
          previousSessionId: fromSessionId,
          telemetrySessionUid,
          mergedAt,
        })
      );
    }
  }

  private remapJoinCodes(fromSessionId: string, toSessionId: string): void {
    for (const [joinCode, mappedSessionId] of this.joinCodeToSessionId.entries()) {
      if (mappedSessionId === fromSessionId) {
        this.joinCodeToSessionId.set(joinCode, toSessionId);
      }
    }
  }

  private mergeSessionAccessRecords(
    fromSessionId: string,
    toSessionId: string,
    mergedAt: number
  ): void {
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
      targetAccess.updatedAt = Math.max(
        targetAccess.updatedAt,
        sourceAccess.updatedAt,
        mergedAt
      );

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

  private mergeStrategyCaches(fromSessionId: string, toSessionId: string): void {
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

  private startDebugHttp(port: number) {
    const app = express();

    app.get('/relay/sessions', (req, res) => {
      res.json(
        Array.from(this.sessions.values()).map((s) => {
          const access = serializeSessionAccess(this.sessionAccess.get(s.sessionId));
          const opsSummary = serializeSessionOpsSummary(
            s,
            this.sessionAccess.get(s.sessionId)
          );

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
        })
      );
    });

    app.get('/relay/sessions/:id', (req, res) => {
      const s = this.sessions.get(req.params.id);
      if (!s) {
        return res.status(404).json({ error: 'not_found' });
      }

      const access = serializeSessionAccess(this.sessionAccess.get(s.sessionId));
      const opsSummary = serializeSessionOpsSummary(
        s,
        this.sessionAccess.get(s.sessionId)
      );

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
      this.logger.info(
        `[Relay] Debug HTTP server running at http://localhost:${port}/relay/sessions`
      );
    });
  }
}