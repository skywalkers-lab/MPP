import request from 'supertest';
import express from 'express';
import { RelayServer } from '../src/relay/RelayServer';
import { createViewerApiRouter } from '../src/relay/viewerApi';

describe('Strategy API', () => {
  let app: express.Express;
  let relayServer: RelayServer;
  const sessionId = 'S-STRAT01';

  beforeEach(() => {
    relayServer = new RelayServer({ wsPort: 0 });
    app = express();
    app.use(express.json());
    app.use('/api/viewer', createViewerApiRouter(relayServer));

    const ws = { send: jest.fn() } as any;
    (relayServer as any).handleHostHello(ws, 'conn-strategy', {
      requestedSessionId: sessionId,
      protocolVersion: 1,
    });
  });

  afterEach(() => {
    relayServer.close();
  });

  function setSnapshot(overrides: Record<string, unknown> = {}) {
    const session = relayServer.getSession(sessionId)!;
    session.latestSequence = 10;
    session.latestState = {
      sessionMeta: {
        sessionUID: 'UID-1',
        sessionType: 'Race',
        trackId: 1,
        weather: 'clear',
        safetyCarStatus: 'none',
        totalLaps: 58,
        currentLap: 20,
        sessionTime: 1000,
      },
      playerCarIndex: 0,
      spectatorCarIndex: null,
      cars: {
        0: {
          carIndex: 0,
          position: 9,
          currentLapNum: 20,
          lastLapTime: null,
          bestLapTime: null,
          gapToLeader: null,
          gapToFront: null,
          pitStatus: null,
          tyreCompound: 'M',
          tyreAgeLaps: 14,
          fuelRemaining: 13,
          fuelLapsRemaining: 16,
          ersLevel: null,
          ersDeployMode: null,
          tyreWear: null,
          tyreTemp: null,
          damage: null,
        },
      },
      drivers: {},
      eventLog: [],
      ...overrides,
    } as any;
  }

  it('returns strategy recommendation shape when snapshot exists', async () => {
    setSnapshot();

    const res = await request(app).get(`/api/viewer/strategy/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.strategyUnavailable).toBe(false);
    expect(typeof res.body.recommendation).toBe('string');
    expect(typeof res.body.severity).toBe('string');
    expect(typeof res.body.primaryRecommendation).toBe('string');
    expect(typeof res.body.recommendationChanged).toBe('boolean');
    expect(typeof res.body.trendReason).toBe('string');
    expect(Array.isArray(res.body.reasons)).toBe(true);
    expect(typeof res.body.generatedAt).toBe('number');
    expect(res.body.signals).toBeDefined();
    expect(res.body.signals).toHaveProperty('undercutScore');
    expect(res.body.signals).toHaveProperty('overcutScore');
    expect(res.body.signals).toHaveProperty('trafficRiskScore');
    expect(res.body.signals).toHaveProperty('degradationTrend');
    expect(res.body.signals).toHaveProperty('pitLossHeuristic');
    expect(res.body.signals).toHaveProperty('compoundStintBias');
    expect(res.body.signals).toHaveProperty('expectedRejoinBand');
    expect(res.body.signals).toHaveProperty('cleanAirProbability');
  });

  it('returns unavailable reason when snapshot is missing', async () => {
    const res = await request(app).get(`/api/viewer/strategy/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.strategyUnavailable).toBe(true);
    expect(res.body.reason).toBe('no_snapshot');
    expect(res.body.signals.undercutScore).toBeUndefined();
  });

  it('returns unavailable reason when session is stale', async () => {
    setSnapshot();
    const session = relayServer.getSession(sessionId)!;
    session.status = 'stale';

    const res = await request(app).get(`/api/viewer/strategy/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.strategyUnavailable).toBe(true);
    expect(res.body.reason).toBe('session_stale');
  });

  it('returns 404 when session is missing', async () => {
    const res = await request(app).get('/api/viewer/strategy/S-NOPE');
    expect(res.status).toBe(404);
    expect(res.body.strategyUnavailable).toBe(true);
    expect(res.body.reason).toBe('session_not_found');
  });

  it('keeps strategy evaluation separated by sessionId', async () => {
    const ws = { send: jest.fn() } as any;
    (relayServer as any).handleHostHello(ws, 'conn-strategy-2', {
      requestedSessionId: 'S-STRAT02',
      protocolVersion: 1,
    });

    setSnapshot();
    const s2 = relayServer.getSession('S-STRAT02')!;
    s2.latestSequence = 20;
    s2.latestState = {
      sessionMeta: {
        sessionUID: 'UID-2',
        sessionType: 'Race',
        trackId: 2,
        weather: 'clear',
        safetyCarStatus: 'none',
        totalLaps: 58,
        currentLap: 52,
        sessionTime: 5000,
      },
      playerCarIndex: 0,
      spectatorCarIndex: null,
      cars: {
        0: {
          carIndex: 0,
          position: 15,
          currentLapNum: 52,
          lastLapTime: null,
          bestLapTime: null,
          gapToLeader: null,
          gapToFront: null,
          pitStatus: null,
          tyreCompound: 'H',
          tyreAgeLaps: 8,
          fuelRemaining: 2,
          fuelLapsRemaining: 1,
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

    const r1 = await request(app).get(`/api/viewer/strategy/${sessionId}`);
    const r2 = await request(app).get('/api/viewer/strategy/S-STRAT02');

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.sessionId).toBe(sessionId);
    expect(r2.body.sessionId).toBe('S-STRAT02');
    expect(r2.body.strategyUnavailable).toBe(false);
    expect(r2.body.recommendation).toBe('FUEL RISK HIGH');
  });
});
