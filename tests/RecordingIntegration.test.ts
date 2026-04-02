import { RelayServer } from '../src/relay/RelayServer';

describe('Recording integration lifecycle', () => {
  it('finalizes archive on server close and keeps summary/detail available', () => {
    const relayServer = new RelayServer({ wsPort: 0, heartbeatTimeoutMs: 1000 });

    const ws = { send: jest.fn() } as any;
    (relayServer as any).handleHostHello(ws, 'conn-rec', {
      requestedSessionId: 'S-REC01',
      protocolVersion: 1,
    });

    (relayServer as any).handleStateSnapshot('conn-rec', {
      type: 'state_snapshot',
      sessionId: 'S-REC01',
      sequence: 1,
      timestamp: 1000,
      state: {
        sessionMeta: {
          sessionUID: 'UID-R1',
          sessionType: 'Race',
          trackId: 5,
          weather: 'clear',
          safetyCarStatus: 'none',
          totalLaps: 58,
          currentLap: 4,
          sessionTime: 300,
        },
        playerCarIndex: 0,
        spectatorCarIndex: null,
        cars: {
          0: {
            carIndex: 0,
            position: 7,
            currentLapNum: 4,
            lastLapTime: null,
            bestLapTime: null,
            gapToLeader: null,
            gapToFront: null,
            pitStatus: null,
            tyreCompound: 'M',
            tyreAgeLaps: 5,
            fuelRemaining: 48,
            fuelLapsRemaining: 40,
            ersLevel: null,
            ersDeployMode: null,
            tyreWear: null,
            tyreTemp: null,
            damage: null,
          },
        },
        drivers: {},
        eventLog: [],
      },
    });

    relayServer.addSessionNote('S-REC01', {
      text: 'pace stable',
      category: 'general',
      authorLabel: 'Engineer',
      timestamp: 1010,
    });

    relayServer.close();

    const summary = relayServer.getSessionArchiveSummary('S-REC01');
    expect(summary).toBeDefined();
    expect(summary?.finalizeReason).toBe('server_shutdown');
    expect(summary?.snapshotCount).toBeGreaterThan(0);
    expect(summary?.noteCount).toBeGreaterThan(0);

    const archive = relayServer.getSessionArchive('S-REC01');
    expect(archive).toBeDefined();
    expect((archive?.snapshots.length ?? 0)).toBeGreaterThan(0);
    expect((archive?.notes.length ?? 0)).toBeGreaterThan(0);

    const timeline = relayServer.getSessionArchiveTimeline('S-REC01', 100);
    expect(timeline.length).toBeGreaterThan(0);
  });
});
