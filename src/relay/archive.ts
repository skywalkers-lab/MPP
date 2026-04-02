import { CurrentRaceState } from '../model/CurrentRaceState';
import { SessionNote } from './notes';
import { OpsEvent } from './ops';
import { StrategyEvaluationResult } from './strategy';

type ArchiveVisibility = 'private' | 'code';

export type ArchiveFinalizeReason = 'session_stale' | 'session_closed' | 'server_shutdown';

export interface ArchiveRecommendationSnapshot {
  strategyUnavailable: boolean;
  recommendation: string | null;
  severity: string | null;
  reason: string | null;
  generatedAt: number;
}

export interface ArchiveSnapshot {
  sequence: number;
  timestamp: number;
  recordedAt: number;
  state: CurrentRaceState;
  recommendation: ArchiveRecommendationSnapshot | null;
}

export interface ArchiveSummary {
  archiveId: string;
  sessionId: string;
  createdAt: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  snapshotCount: number;
  opsEventCount: number;
  noteCount: number;
  latestSequence: number | null;
  lastKnownStatus: 'active' | 'stale' | 'closed';
  lastRecommendation: string | null;
  joinCode: string | null;
  visibility: ArchiveVisibility | 'unknown';
  finalizeReason: ArchiveFinalizeReason;
}

export interface SessionArchive {
  archiveId: string;
  sessionId: string;
  createdAt: number;
  startedAt: number;
  endedAt: number;
  snapshots: ArchiveSnapshot[];
  opsEvents: OpsEvent[];
  notes: SessionNote[];
  summary: ArchiveSummary;
}

export type ArchiveTimelineItem =
  | {
      kind: 'snapshot';
      timestamp: number;
      sequence: number;
      snapshot: ArchiveSnapshot;
    }
  | {
      kind: 'ops_event';
      timestamp: number;
      event: OpsEvent;
    }
  | {
      kind: 'note';
      timestamp: number;
      note: SessionNote;
    };

export interface StartRecordingInput {
  sessionId: string;
  startedAt: number;
  createdAt?: number;
  joinCode?: string | null;
  visibility?: ArchiveVisibility | 'unknown';
}

export interface FinalizeArchiveInput {
  endedAt: number;
  latestSequence: number | null;
  lastKnownStatus: 'active' | 'stale' | 'closed';
  reason: ArchiveFinalizeReason;
  lastRecommendation: string | null;
}

interface ActiveRecording {
  archiveId: string;
  sessionId: string;
  createdAt: number;
  startedAt: number;
  joinCode: string | null;
  visibility: ArchiveVisibility | 'unknown';
  snapshots: ArchiveSnapshot[];
  opsEvents: OpsEvent[];
  notes: SessionNote[];
  lastRecordedSequence: number | null;
}

export interface SessionArchiveStoreOptions {
  maxSnapshotsPerSession?: number;
  snapshotSamplingStep?: number;
}

export class InMemorySessionArchiveStore {
  private readonly activeBySession = new Map<string, ActiveRecording>();
  private readonly archivesBySession = new Map<string, SessionArchive>();
  private readonly maxSnapshotsPerSession: number;
  private readonly snapshotSamplingStep: number;

  constructor(options: SessionArchiveStoreOptions = {}) {
    this.maxSnapshotsPerSession = Math.max(100, options.maxSnapshotsPerSession ?? 1500);
    this.snapshotSamplingStep = Math.max(1, options.snapshotSamplingStep ?? 1);
  }

  startRecording(input: StartRecordingInput): string {
    const existing = this.activeBySession.get(input.sessionId);
    if (existing) {
      return existing.archiveId;
    }

    const archiveId = `A-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    this.activeBySession.set(input.sessionId, {
      archiveId,
      sessionId: input.sessionId,
      createdAt: input.createdAt ?? Date.now(),
      startedAt: input.startedAt,
      joinCode: input.joinCode ?? null,
      visibility: input.visibility ?? 'unknown',
      snapshots: [],
      opsEvents: [],
      notes: [],
      lastRecordedSequence: null,
    });

    return archiveId;
  }

  hasActiveRecording(sessionId: string): boolean {
    return this.activeBySession.has(sessionId);
  }

  recordSnapshot(
    sessionId: string,
    sequence: number,
    timestamp: number,
    state: CurrentRaceState,
    recommendation: ArchiveRecommendationSnapshot | null
  ): void {
    const active = this.activeBySession.get(sessionId);
    if (!active) return;

    if (active.lastRecordedSequence != null && sequence <= active.lastRecordedSequence) {
      return;
    }

    const isFirst = active.lastRecordedSequence == null;
    const shouldSample = isFirst || sequence % this.snapshotSamplingStep === 0;
    active.lastRecordedSequence = sequence;

    if (!shouldSample) return;

    active.snapshots.push({
      sequence,
      timestamp,
      recordedAt: Date.now(),
      state,
      recommendation,
    });

    if (active.snapshots.length > this.maxSnapshotsPerSession) {
      active.snapshots.splice(0, active.snapshots.length - this.maxSnapshotsPerSession);
    }
  }

  recordOpsEvent(event: OpsEvent): void {
    const active = this.activeBySession.get(event.sessionId);
    if (!active) return;
    active.opsEvents.push(event);
  }

  recordNote(note: SessionNote): void {
    const active = this.activeBySession.get(note.sessionId);
    if (!active) return;
    active.notes.push(note);
  }

  updateAccessMetadata(
    sessionId: string,
    patch: { joinCode?: string | null; visibility?: ArchiveVisibility | 'unknown' }
  ): void {
    const active = this.activeBySession.get(sessionId);
    if (!active) return;
    if (patch.joinCode !== undefined) {
      active.joinCode = patch.joinCode;
    }
    if (patch.visibility !== undefined) {
      active.visibility = patch.visibility;
    }
  }

  finalizeSessionArchive(
    sessionId: string,
    input: FinalizeArchiveInput
  ): SessionArchive | undefined {
    const active = this.activeBySession.get(sessionId);
    if (!active) return undefined;

    const endedAt = input.endedAt;
    const summary: ArchiveSummary = {
      archiveId: active.archiveId,
      sessionId,
      createdAt: active.createdAt,
      startedAt: active.startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - active.startedAt),
      snapshotCount: active.snapshots.length,
      opsEventCount: active.opsEvents.length,
      noteCount: active.notes.length,
      latestSequence: input.latestSequence,
      lastKnownStatus: input.lastKnownStatus,
      lastRecommendation: input.lastRecommendation,
      joinCode: active.joinCode,
      visibility: active.visibility,
      finalizeReason: input.reason,
    };

    const archive: SessionArchive = {
      archiveId: active.archiveId,
      sessionId,
      createdAt: active.createdAt,
      startedAt: active.startedAt,
      endedAt,
      snapshots: [...active.snapshots],
      opsEvents: [...active.opsEvents],
      notes: [...active.notes],
      summary,
    };

    this.archivesBySession.set(sessionId, archive);
    this.activeBySession.delete(sessionId);

    return archive;
  }

  getArchiveBySession(sessionId: string): SessionArchive | undefined {
    return this.archivesBySession.get(sessionId);
  }

  getArchiveSummary(sessionId: string): ArchiveSummary | undefined {
    return this.archivesBySession.get(sessionId)?.summary;
  }

  listArchiveSummaries(limit: number = 100): ArchiveSummary[] {
    const size = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 100;
    return Array.from(this.archivesBySession.values())
      .map((archive) => archive.summary)
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, size);
  }

  getArchiveTimeline(sessionId: string, limit: number = 500): ArchiveTimelineItem[] {
    const archive = this.archivesBySession.get(sessionId);
    if (!archive) return [];

    const items: ArchiveTimelineItem[] = [
      ...archive.snapshots.map((snapshot) => ({
        kind: 'snapshot' as const,
        timestamp: snapshot.timestamp,
        sequence: snapshot.sequence,
        snapshot,
      })),
      ...archive.opsEvents.map((event) => ({
        kind: 'ops_event' as const,
        timestamp: event.timestamp,
        event,
      })),
      ...archive.notes.map((note) => ({
        kind: 'note' as const,
        timestamp: note.timestamp,
        note,
      })),
    ];

    const size = Number.isFinite(limit) ? Math.max(1, Math.min(5000, Math.floor(limit))) : 500;
    return items.sort((a, b) => a.timestamp - b.timestamp).slice(-size);
  }
}

export function toArchiveRecommendationSnapshot(
  strategy: StrategyEvaluationResult,
  generatedAt: number
): ArchiveRecommendationSnapshot | null {
  if (strategy.strategyUnavailable) {
    return {
      strategyUnavailable: true,
      recommendation: null,
      severity: null,
      reason: strategy.reason,
      generatedAt,
    };
  }

  return {
    strategyUnavailable: false,
    recommendation: strategy.primaryRecommendation ?? strategy.recommendation,
    severity: strategy.severity,
    reason: null,
    generatedAt,
  };
}
