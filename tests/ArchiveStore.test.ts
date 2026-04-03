import { InMemorySessionArchiveStore } from '../src/relay/archive';

describe('InMemorySessionArchiveStore', () => {
  it('records snapshots, ops events, notes and builds ordered timeline', () => {
    const store = new InMemorySessionArchiveStore({ maxSnapshotsPerSession: 10 });
    store.startRecording({ sessionId: 'S-A1', startedAt: 1000, joinCode: 'ABC123', visibility: 'code' });

    store.recordOpsEvent({
      eventId: 'e1',
      type: 'session_started',
      sessionId: 'S-A1',
      timestamp: 1000,
      payload: {},
    });

    store.recordSnapshot(
      'S-A1',
      1,
      1010,
      {
        sessionMeta: null,
        playerCarIndex: null,
        spectatorCarIndex: null,
        cars: {},
        drivers: {},
        eventLog: [],
      },
      {
        strategyUnavailable: false,
        recommendation: 'STAY OUT',
        primaryRecommendation: 'STAY OUT',
        secondaryRecommendation: 'BOX IN 2 LAPS',
        severity: 'info',
        reasons: ['signals stable'],
        confidenceScore: 78,
        stabilityScore: 72,
        recommendationChanged: false,
        trendReason: 'recommendation remained stable with low signal drift',
        reason: null,
        generatedAt: 1010,
      }
    );

    store.recordNote({
      noteId: 'n1',
      sessionId: 'S-A1',
      timestamp: 1020,
      createdAt: 1020,
      category: 'strategy',
      text: 'monitor traffic',
      authorLabel: 'Strategist',
    });

    const archive = store.finalizeSessionArchive('S-A1', {
      endedAt: 1030,
      latestSequence: 1,
      lastKnownStatus: 'stale',
      reason: 'session_stale',
      lastRecommendation: 'STAY OUT',
    });

    expect(archive).toBeDefined();
    expect(archive?.summary.snapshotCount).toBe(1);
    expect(archive?.summary.opsEventCount).toBe(1);
    expect(archive?.summary.noteCount).toBe(1);

    const timeline = store.getArchiveTimeline('S-A1', 100);
    expect(timeline).toHaveLength(3);
    expect(timeline[0].timestamp).toBeLessThanOrEqual(timeline[1].timestamp);
    expect(timeline[1].timestamp).toBeLessThanOrEqual(timeline[2].timestamp);
    expect(timeline.some((i) => i.kind === 'snapshot')).toBe(true);
    expect(timeline.some((i) => i.kind === 'ops_event')).toBe(true);
    expect(timeline.some((i) => i.kind === 'note')).toBe(true);
  });

  it('applies snapshot retention limit conservatively', () => {
    const store = new InMemorySessionArchiveStore({ maxSnapshotsPerSession: 100 });
    store.startRecording({ sessionId: 'S-A2', startedAt: 1 });

    for (let i = 1; i <= 180; i += 1) {
      store.recordSnapshot(
        'S-A2',
        i,
        1000 + i,
        {
          sessionMeta: null,
          playerCarIndex: null,
          spectatorCarIndex: null,
          cars: {},
          drivers: {},
          eventLog: [],
        },
        null
      );
    }

    const archive = store.finalizeSessionArchive('S-A2', {
      endedAt: 5000,
      latestSequence: 180,
      lastKnownStatus: 'closed',
      reason: 'session_closed',
      lastRecommendation: null,
    });

    expect(archive).toBeDefined();
    expect((archive?.snapshots.length ?? 0)).toBeLessThanOrEqual(100);
    expect(archive?.summary.latestSequence).toBe(180);
  });
});
