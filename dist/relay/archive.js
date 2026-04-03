export class InMemorySessionArchiveStore {
    constructor(options = {}) {
        this.activeBySession = new Map();
        this.archivesBySession = new Map();
        this.maxSnapshotsPerSession = Math.max(100, options.maxSnapshotsPerSession ?? 1500);
        this.snapshotSamplingStep = Math.max(1, options.snapshotSamplingStep ?? 1);
    }
    startRecording(input) {
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
    hasActiveRecording(sessionId) {
        return this.activeBySession.has(sessionId);
    }
    recordSnapshot(sessionId, sequence, timestamp, state, recommendation) {
        const active = this.activeBySession.get(sessionId);
        if (!active)
            return;
        if (active.lastRecordedSequence != null && sequence <= active.lastRecordedSequence) {
            return;
        }
        const isFirst = active.lastRecordedSequence == null;
        const shouldSample = isFirst || sequence % this.snapshotSamplingStep === 0;
        active.lastRecordedSequence = sequence;
        if (!shouldSample)
            return;
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
    recordOpsEvent(event) {
        const active = this.activeBySession.get(event.sessionId);
        if (!active)
            return;
        active.opsEvents.push(event);
    }
    recordNote(note) {
        const active = this.activeBySession.get(note.sessionId);
        if (!active)
            return;
        active.notes.push(note);
    }
    updateAccessMetadata(sessionId, patch) {
        const active = this.activeBySession.get(sessionId);
        if (!active)
            return;
        if (patch.joinCode !== undefined) {
            active.joinCode = patch.joinCode;
        }
        if (patch.visibility !== undefined) {
            active.visibility = patch.visibility;
        }
    }
    mergeActiveRecordings(fromSessionId, toSessionId) {
        if (fromSessionId === toSessionId)
            return;
        const source = this.activeBySession.get(fromSessionId);
        if (!source)
            return;
        let target = this.activeBySession.get(toSessionId);
        if (!target) {
            this.activeBySession.set(toSessionId, {
                ...source,
                sessionId: toSessionId,
            });
            this.activeBySession.delete(fromSessionId);
            return;
        }
        target.snapshots.push(...source.snapshots);
        target.opsEvents.push(...source.opsEvents);
        target.notes.push(...source.notes);
        target.lastRecordedSequence = Math.max(target.lastRecordedSequence ?? 0, source.lastRecordedSequence ?? 0);
        target.startedAt = Math.min(target.startedAt, source.startedAt);
        target.createdAt = Math.min(target.createdAt, source.createdAt);
        if (!target.joinCode && source.joinCode) {
            target.joinCode = source.joinCode;
        }
        if (target.visibility === 'unknown' && source.visibility !== 'unknown') {
            target.visibility = source.visibility;
        }
        target.snapshots.sort((a, b) => a.sequence - b.sequence);
        if (target.snapshots.length > this.maxSnapshotsPerSession) {
            target.snapshots.splice(0, target.snapshots.length - this.maxSnapshotsPerSession);
        }
        this.activeBySession.delete(fromSessionId);
    }
    finalizeSessionArchive(sessionId, input) {
        const active = this.activeBySession.get(sessionId);
        if (!active)
            return undefined;
        const endedAt = input.endedAt;
        const summary = {
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
        const archive = {
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
    getArchiveBySession(sessionId) {
        return this.archivesBySession.get(sessionId);
    }
    getArchiveSummary(sessionId) {
        return this.archivesBySession.get(sessionId)?.summary;
    }
    listArchiveSummaries(limit = 100) {
        const size = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 100;
        return Array.from(this.archivesBySession.values())
            .map((archive) => archive.summary)
            .sort((a, b) => b.endedAt - a.endedAt)
            .slice(0, size);
    }
    getArchiveTimeline(sessionId, limit = 500) {
        const archive = this.archivesBySession.get(sessionId);
        if (!archive)
            return [];
        const items = [
            ...archive.snapshots.map((snapshot) => ({
                kind: 'snapshot',
                timestamp: snapshot.timestamp,
                sequence: snapshot.sequence,
                snapshot,
            })),
            ...archive.opsEvents.map((event) => ({
                kind: 'ops_event',
                timestamp: event.timestamp,
                event,
            })),
            ...archive.notes.map((note) => ({
                kind: 'note',
                timestamp: note.timestamp,
                note,
            })),
        ];
        const size = Number.isFinite(limit) ? Math.max(1, Math.min(5000, Math.floor(limit))) : 500;
        return items.sort((a, b) => a.timestamp - b.timestamp).slice(-size);
    }
}
export function toArchiveRecommendationSnapshot(strategy, generatedAt) {
    if (strategy.strategyUnavailable) {
        return {
            strategyUnavailable: true,
            recommendation: null,
            primaryRecommendation: null,
            secondaryRecommendation: null,
            severity: null,
            reasons: strategy.reasons,
            confidenceScore: null,
            stabilityScore: null,
            recommendationChanged: false,
            trendReason: null,
            reason: strategy.reason,
            generatedAt,
        };
    }
    return {
        strategyUnavailable: false,
        recommendation: strategy.primaryRecommendation ?? strategy.recommendation,
        primaryRecommendation: strategy.primaryRecommendation ?? strategy.recommendation,
        secondaryRecommendation: strategy.secondaryRecommendation ?? null,
        severity: strategy.severity,
        reasons: strategy.reasons,
        confidenceScore: strategy.confidenceScore,
        stabilityScore: strategy.stabilityScore,
        recommendationChanged: strategy.recommendationChanged,
        trendReason: strategy.trendReason,
        reason: null,
        generatedAt,
    };
}
