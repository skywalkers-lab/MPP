// tests/HealthApi.test.ts
// Health endpoint unit tests for Stage 12

import request from 'supertest';
import express from 'express';
import { RelayServer } from '../src/relay/RelayServer';
import { createViewerApiRouter } from '../src/relay/viewerApi';

function sampleState() {
  return {
    sessionMeta: {
      sessionUID: 'UID-HEALTH',
      sessionType: 'Race',
      trackId: 1,
      weather: 'clear',
      safetyCarStatus: 'none',
      totalLaps: 58,
      currentLap: 1,
      sessionTime: 0,
    },
    playerCarIndex: 0,
    spectatorCarIndex: null,
    cars: {
      0: {
        carIndex: 0,
        position: 1,
        currentLapNum: 1,
        lastLapTime: null,
        bestLapTime: null,
        gapToLeader: null,
        gapToFront: null,
        pitStatus: null,
        tyreCompound: 'M',
        tyreAgeLaps: 0,
        fuelRemaining: 100,
        fuelLapsRemaining: 45,
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

function seedSession(relay: RelayServer, sessionId: string, withSnapshot: boolean = true) {
  const ws = { send: jest.fn() } as any;
  (relay as any).handleHostHello(ws, `conn-${sessionId}`, {
    requestedSessionId: sessionId,
    protocolVersion: 1,
  });

  if (withSnapshot) {
    (relay as any).handleStateSnapshot(`conn-${sessionId}`, {
      type: 'state_snapshot',
      sessionId,
      sequence: 1,
      timestamp: Date.now(),
      state: sampleState(),
    });
  }
}

function buildTestApp(relayServer: RelayServer) {
  const app = express();
  app.use(express.json());
  app.use('/api/viewer', createViewerApiRouter(relayServer));
  return app;
}

describe('GET /api/viewer/health/:sessionId', () => {
  let relay: RelayServer;
  let app: express.Express;

  beforeEach(() => {
    relay = new RelayServer({
      wsPort: 0,
      logger: undefined as any,
      heartbeatTimeoutMs: 10000,
    });
    app = buildTestApp(relay);
  });

  afterEach(() => {
    relay.close();
  });

  it('returns sessionFound=false and healthLevel=stale for unknown session', async () => {
    const res = await request(app)
      .get('/api/viewer/health/NONEXISTENT')
      .expect(200);

    expect(res.body.sessionFound).toBe(false);
    expect(res.body.relayStatus).toBe('not_found');
    expect(res.body.healthLevel).toBe('stale');
    expect(res.body.heartbeatAgeMs).toBe(-1);
    expect(res.body.relayFreshnessMs).toBe(-1);
    expect(res.body.snapshotFreshnessMs).toBe(-1);
    expect(res.body.sessionId).toBe('NONEXISTENT');
    expect(typeof res.body.checkedAt).toBe('number');
  });

  it('returns correct structure for the health response', async () => {
    const res = await request(app)
      .get('/api/viewer/health/ANY-SESSION')
      .expect(200);

    expect(res.body).toHaveProperty('sessionId');
    expect(res.body).toHaveProperty('sessionFound');
    expect(res.body).toHaveProperty('relayStatus');
    expect(res.body).toHaveProperty('heartbeatAgeMs');
    expect(res.body).toHaveProperty('relayFreshnessMs');
    expect(res.body).toHaveProperty('snapshotFreshnessMs');
    expect(res.body).toHaveProperty('healthLevel');
    expect(res.body).toHaveProperty('checkedAt');
  });

  it('returns connecting when session is active but snapshot is not ready', async () => {
    seedSession(relay, 'S-CONNECTING', false);

    const res = await request(app)
      .get('/api/viewer/health/S-CONNECTING')
      .expect(200);

    expect(res.body.sessionId).toBe('S-CONNECTING');
    expect(res.body.sessionFound).toBe(true);
    expect(res.body.relayStatus).toBe('active');
    expect(res.body.healthLevel).toBe('connecting');
    expect(typeof res.body.heartbeatAgeMs).toBe('number');
    expect(res.body.snapshotFreshnessMs).toBe(-1);
    expect(typeof res.body.relayFreshnessMs).toBe('number');
  });

  it('returns stale when relay status is stale', async () => {
    seedSession(relay, 'S-STALE-RELAY', true);
    (relay as any).handleClose('conn-S-STALE-RELAY');

    const res = await request(app)
      .get('/api/viewer/health/S-STALE-RELAY')
      .expect(200);

    expect(res.body.relayStatus).toBe('stale');
    expect(res.body.healthLevel).toBe('stale');
  });

  it('returns delayed or stale_risk when heartbeat age grows on active session', async () => {
    seedSession(relay, 'S-AGED', true);
    const session = (relay as any).sessions.get('S-AGED');
    session.lastHeartbeatAt = Date.now() - 7000;

    const res = await request(app)
      .get('/api/viewer/health/S-AGED')
      .expect(200);

    expect(res.body.relayStatus).toBe('active');
    expect(['delayed', 'stale_risk']).toContain(res.body.healthLevel);
    expect(res.body.heartbeatAgeMs).toBeGreaterThanOrEqual(6000);
  });

  it('matches overlay-required health payload keys', async () => {
    seedSession(relay, 'S-OVERLAY-SHAPE', true);

    const res = await request(app)
      .get('/api/viewer/health/S-OVERLAY-SHAPE')
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        sessionId: expect.any(String),
        healthLevel: expect.any(String),
        heartbeatAgeMs: expect.any(Number),
        snapshotFreshnessMs: expect.any(Number),
        relayFreshnessMs: expect.any(Number),
      })
    );
  });
});

describe('RelayServer.getSessionHealth()', () => {
  let relay: RelayServer;

  beforeEach(() => {
    relay = new RelayServer({
      wsPort: 0,
      logger: undefined as any,
      heartbeatTimeoutMs: 10000,
    });
  });

  afterEach(() => {
    relay.close();
  });

  it('returns stale for unknown session', () => {
    const health = relay.getSessionHealth('UNKNOWN');
    expect(health.sessionFound).toBe(false);
    expect(health.healthLevel).toBe('stale');
    expect(health.relayStatus).toBe('not_found');
    expect(health.heartbeatAgeMs).toBe(-1);
    expect(health.relayFreshnessMs).toBe(-1);
    expect(health.snapshotFreshnessMs).toBe(-1);
  });

  it('includes checkedAt as a recent timestamp', () => {
    const before = Date.now();
    const health = relay.getSessionHealth('UNKNOWN');
    const after = Date.now();
    expect(health.checkedAt).toBeGreaterThanOrEqual(before);
    expect(health.checkedAt).toBeLessThanOrEqual(after);
  });

  it('returns healthy with fresh heartbeat and snapshot', () => {
    seedSession(relay, 'S-HEALTHY', true);

    const health = relay.getSessionHealth('S-HEALTHY');
    expect(health.sessionFound).toBe(true);
    expect(health.relayStatus).toBe('active');
    expect(health.healthLevel).toBe('healthy');
    expect(health.snapshotFreshnessMs).toBeGreaterThanOrEqual(0);
  });

  it('returns connecting for active session without snapshot', () => {
    seedSession(relay, 'S-NO-SNAPSHOT', false);

    const health = relay.getSessionHealth('S-NO-SNAPSHOT');
    expect(health.relayStatus).toBe('active');
    expect(health.healthLevel).toBe('connecting');
    expect(health.snapshotFreshnessMs).toBe(-1);
  });

  it('returns stale_risk when heartbeat age approaches timeout', () => {
    seedSession(relay, 'S-RISK', true);
    const session = (relay as any).sessions.get('S-RISK');
    session.lastHeartbeatAt = Date.now() - 8000;

    const health = relay.getSessionHealth('S-RISK');
    expect(health.relayStatus).toBe('active');
    expect(health.healthLevel).toBe('stale_risk');
  });

  it('returns stale when heartbeat timeout is exceeded', () => {
    seedSession(relay, 'S-TIMEOUT', true);
    const session = (relay as any).sessions.get('S-TIMEOUT');
    session.lastHeartbeatAt = Date.now() - 15000;

    const health = relay.getSessionHealth('S-TIMEOUT');
    expect(health.relayStatus).toBe('active');
    expect(health.healthLevel).toBe('stale');
  });
});
