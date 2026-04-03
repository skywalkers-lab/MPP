import { RelaySession, SessionAccessRecord } from './RelayServer';
import { getViewerStatus, ViewerStatus } from './viewerStatus';

export type OpsEventType =
  | 'session_started'
  | 'session_stale'
  | 'session_recovered'
  | 'session_closed'
  | 'share_enabled_changed'
  | 'visibility_changed';

export interface OpsEvent {
  eventId: string;
  type: OpsEventType;
  sessionId: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface OpsNotifier {
  notify(event: OpsEvent): void;
}

export class InMemoryRecentOpsEvents implements OpsNotifier {
  private events: OpsEvent[] = [];

  constructor(private readonly maxSize: number = 200) {}

  notify(event: OpsEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxSize) {
      this.events.splice(0, this.events.length - this.maxSize);
    }
  }

  getRecent(limit: number = 50): OpsEvent[] {
    const size = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 50;
    return this.events.slice(-size).reverse();
  }
}

export class ConsoleOpsNotifier implements OpsNotifier {
  notify(event: OpsEvent): void {
    // Keep log payload compact for operational visibility.
    console.log(`[OpsEvent] ${event.type} session=${event.sessionId} ts=${event.timestamp}`);
  }
}

export class CompositeOpsNotifier implements OpsNotifier {
  constructor(private readonly notifiers: OpsNotifier[]) {}

  notify(event: OpsEvent): void {
    for (const notifier of this.notifiers) {
      try {
        notifier.notify(event);
      } catch (err) {
        // Log error but continue with next notifier
        console.error(`[OpsNotifier] Error in notifier:`, err);
      }
    }
  }
}

export type ViewerAccessLabel =
  | 'shared'
  | 'not_shared'
  | 'private'
  | 'code_required'
  | 'no_join_code';

export interface SessionOpsSummary {
  sessionId: string;
  relayStatus: RelaySession['status'];
  healthLevel: 'healthy' | 'delayed' | 'stale_risk' | 'stale' | 'connecting';
  heartbeatAgeMs: number;
  relayFreshnessMs: number;
  snapshotFreshnessMs: number;
  viewerStatus: ViewerStatus;
  shareEnabled: boolean;
  visibility: SessionAccessRecord['visibility'] | 'unknown';
  hasViewerAccess: boolean;
  viewerAccessLabel: ViewerAccessLabel;
  joinCode: string | null;
  updatedAt: number;
  lastHeartbeatAt: number | null;
  latestSequence: number | null;
  hasSnapshot: boolean;
  noteCount?: number;
  latestNoteAt?: number | null;
  latestNotePreview?: string | null;
  strategyLabel?: string | null;
  strategySecondaryLabel?: string | null;
  strategySeverity?: 'info' | 'caution' | 'warning' | 'critical' | null;
  strategyTrafficBand?: 'low' | 'medium' | 'high' | 'critical' | 'unknown' | null;
  strategyGeneratedAt?: number | null;
  strategyUnavailable?: boolean;
}

export function getViewerAccessLabel(
  access: SessionAccessRecord | undefined
): ViewerAccessLabel {
  if (!access || !access.joinCode) return 'no_join_code';
  if (access.visibility === 'private') return 'private';
  if (!access.shareEnabled) return 'not_shared';
  if (access.visibility === 'code') return 'shared';
  return 'code_required';
}

export function serializeSessionOpsSummary(
  session: RelaySession,
  access: SessionAccessRecord | undefined
): SessionOpsSummary {
  const now = Date.now();
  const viewerStatus = getViewerStatus(session);
  const hasSnapshot = !!session.latestState;
  const shareEnabled = access?.shareEnabled === true;
  const visibility = access?.visibility ?? 'unknown';
  const joinCode = access?.joinCode ?? null;
  const hasViewerAccess = shareEnabled && access?.visibility === 'code';
  const heartbeatAgeMs = Math.max(0, now - (session.lastHeartbeatAt || now));
  const relayFreshnessMs = Math.max(0, now - session.updatedAt);
  const snapshotFreshnessMs = hasSnapshot ? relayFreshnessMs : -1;
  const healthLevel = deriveSessionHealthLevel(session.status, heartbeatAgeMs, hasSnapshot);

  return {
    sessionId: session.sessionId,
    relayStatus: session.status,
    healthLevel,
    heartbeatAgeMs,
    relayFreshnessMs,
    snapshotFreshnessMs,
    viewerStatus,
    shareEnabled,
    visibility,
    hasViewerAccess,
    viewerAccessLabel: getViewerAccessLabel(access),
    joinCode,
    updatedAt: session.updatedAt,
    lastHeartbeatAt: session.lastHeartbeatAt ?? null,
    latestSequence: session.latestSequence ?? null,
    hasSnapshot,
  };
}

export function deriveSessionHealthLevel(
  relayStatus: RelaySession['status'] | 'not_found',
  heartbeatAgeMs: number,
  hasSnapshot: boolean
): 'healthy' | 'delayed' | 'stale_risk' | 'stale' | 'connecting' {
  if (relayStatus !== 'active') return 'stale';
  if (!hasSnapshot) return 'connecting';
  if (heartbeatAgeMs < 3000) return 'healthy';
  if (heartbeatAgeMs < 6000) return 'delayed';
  if (heartbeatAgeMs < 10000) return 'stale_risk';
  return 'stale';
}
