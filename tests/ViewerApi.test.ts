import request from 'supertest';
import express from 'express';
import { createViewerApiRouter } from '../src/relay/viewerApi';

describe('Viewer API', () => {
  let app: express.Express;
  let relayServer: any;

  beforeEach(() => {
    relayServer = {
      sessions: new Map(),
    };
    app = express();
    app.use('/api/viewer', createViewerApiRouter(relayServer));
  });

  it('세션 없음 → 404 + not_found', async () => {
    const res = await request(app).get('/api/viewer/sessions/NOPE');
    expect(res.status).toBe(404);
    expect(res.body.viewerStatus).toBe('not_found');
  });

  it('세션 있으나 snapshot 없음 → waiting', async () => {
    relayServer.sessions.set('S1', {
      sessionId: 'S1',
      status: 'active',
      updatedAt: 123,
      lastHeartbeatAt: 123,
      latestSequence: 0,
      latestState: undefined,
    });
    const res = await request(app).get('/api/viewer/sessions/S1');
    expect(res.status).toBe(200);
    expect(res.body.viewerStatus).toBe('waiting');
    expect(res.body.snapshot).toBeNull();
  });

  it('active+snapshot → live', async () => {
    relayServer.sessions.set('S2', {
      sessionId: 'S2',
      status: 'active',
      updatedAt: 123,
      lastHeartbeatAt: 123,
      latestSequence: 1,
      latestState: { playerCarIndex: 0 },
    });
    const res = await request(app).get('/api/viewer/sessions/S2');
    expect(res.status).toBe(200);
    expect(res.body.viewerStatus).toBe('live');
    expect(res.body.snapshot).not.toBeNull();
  });

  it('stale → stale', async () => {
    relayServer.sessions.set('S3', {
      sessionId: 'S3',
      status: 'stale',
      updatedAt: 123,
      lastHeartbeatAt: 123,
      latestSequence: 2,
      latestState: { playerCarIndex: 1 },
    });
    const res = await request(app).get('/api/viewer/sessions/S3');
    expect(res.status).toBe(200);
    expect(res.body.viewerStatus).toBe('stale');
  });

  it('closed → ended', async () => {
    relayServer.sessions.set('S4', {
      sessionId: 'S4',
      status: 'closed',
      updatedAt: 123,
      lastHeartbeatAt: 123,
      latestSequence: 3,
      latestState: { playerCarIndex: 2 },
    });
    const res = await request(app).get('/api/viewer/sessions/S4');
    expect(res.status).toBe(200);
    expect(res.body.viewerStatus).toBe('ended');
  });
});
