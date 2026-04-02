// tests/HealthApi.test.ts
// Health endpoint unit tests for Stage 12

import request from 'supertest';
import express from 'express';
import { RelayServer } from '../src/relay/RelayServer';
import { createViewerApiRouter } from '../src/relay/viewerApi';

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
});
