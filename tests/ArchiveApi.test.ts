import express from 'express';
import request from 'supertest';
import { RelayServer } from '../src/relay/RelayServer';
import { createViewerApiRouter } from '../src/relay/viewerApi';

function sampleState(lap: number, position: number, tyreAgeLaps: number) {
  return {
    sessionMeta: {
      sessionUID: 'UID-A',
      sessionType: 'Race',
      trackId: 3,
      weather: 'clear',
      safetyCarStatus: 'none',
      totalLaps: 58,
      currentLap: lap,
      sessionTime: lap * 90,
    },
    playerCarIndex: 0,
    spectatorCarIndex: null,
    cars: {
      0: {
        carIndex: 0,
        position,
        currentLapNum: lap,
        lastLapTime: null,
        bestLapTime: null,
        gapToLeader: null,
        gapToFront: null,
        pitStatus: null,
        tyreCompound: 'M',
        tyreAgeLaps,
        fuelRemaining: 22,
        fuelLapsRemaining: 18,
        ersLevel: null,
        ersDeployMode: null,
        tyreWear: null,
        tyreTemp: null,
        damage: null,
      },
    },
    drivers: {},
    eventLog: [],
  } as any;
}

describe('Archive API', () => {
  let app: express.Express;
  let relayServer: RelayServer;

  beforeEach(async () => {
    relayServer = new RelayServer({ wsPort: 0, heartbeatTimeoutMs: 1000 });
    app = express();
    app.use(express.json());
    app.use('/api/viewer', createViewerApiRouter(relayServer));

    const ws = { send: jest.fn() } as any;
    (relayServer as any).handleHostHello(ws, 'conn-archive', {
      requestedSessionId: 'S-ARCH01',
      protocolVersion: 1,
    });

    (relayServer as any).handleStateSnapshot('conn-archive', {
      type: 'state_snapshot',
      sessionId: 'S-ARCH01',
      sequence: 1,
      timestamp: 1000,
      state: sampleState(10, 9, 12),
    });

    (relayServer as any).handleStateSnapshot('conn-archive', {
      type: 'state_snapshot',
      sessionId: 'S-ARCH01',
      sequence: 2,
      timestamp: 2000,
      state: sampleState(11, 8, 13),
    });

    await request(app)
      .post('/api/viewer/notes/S-ARCH01')
      .send({ text: 'traffic building in sector 2', category: 'strategy', authorLabel: 'Strategist' });

    (relayServer as any).handleClose('conn-archive');
  });

  afterEach(() => {
    relayServer.close();
  });

  it('returns archive list/detail/summary/timeline after session finalization', async () => {
    const listRes = await request(app).get('/api/viewer/archives');
    expect(listRes.status).toBe(200);
    expect(listRes.body.count).toBeGreaterThanOrEqual(1);

    const row = listRes.body.archives.find((a: any) => a.sessionId === 'S-ARCH01');
    expect(row).toBeDefined();
    expect(row.snapshotCount).toBeGreaterThan(0);
    expect(row.opsEventCount).toBeGreaterThan(0);
    expect(row.noteCount).toBeGreaterThan(0);

    const detailRes = await request(app).get('/api/viewer/archive/S-ARCH01');
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.archive.summary.sessionId).toBe('S-ARCH01');
    expect(detailRes.body.archive.snapshots.length).toBeGreaterThan(0);
    expect(detailRes.body.archive.opsEvents.length).toBeGreaterThan(0);
    expect(detailRes.body.archive.notes.length).toBeGreaterThan(0);

    const summaryRes = await request(app).get('/api/viewer/archive/S-ARCH01/summary');
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.summary.sessionId).toBe('S-ARCH01');

    const timelineRes = await request(app).get('/api/viewer/archive/S-ARCH01/timeline?limit=200');
    expect(timelineRes.status).toBe(200);
    expect(timelineRes.body.count).toBeGreaterThan(0);

    const timeline = timelineRes.body.timeline;
    expect(timeline.some((i: any) => i.kind === 'snapshot')).toBe(true);
    expect(timeline.some((i: any) => i.kind === 'ops_event')).toBe(true);
    expect(timeline.some((i: any) => i.kind === 'note')).toBe(true);

    for (let i = 1; i < timeline.length; i += 1) {
      expect(timeline[i - 1].timestamp).toBeLessThanOrEqual(timeline[i].timestamp);
    }
  });

  it('returns 404 for missing archive resources', async () => {
    const detail = await request(app).get('/api/viewer/archive/S-NOPE');
    expect(detail.status).toBe(404);
    expect(detail.body.error).toBe('not_found');

    const summary = await request(app).get('/api/viewer/archive/S-NOPE/summary');
    expect(summary.status).toBe(404);

    const timeline = await request(app).get('/api/viewer/archive/S-NOPE/timeline');
    expect(timeline.status).toBe(404);
  });
});
