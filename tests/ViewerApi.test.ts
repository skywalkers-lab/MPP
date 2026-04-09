import request from 'supertest';
import express from 'express';
import { createViewerApiRouter } from '../src/relay/viewerApi';

describe('Viewer API', () => {
  let app: express.Express;

  let sessionMap: Map<string, any>;
  let relayServer: any;

  beforeEach(() => {
    sessionMap = new Map();
    relayServer = {
      getSession: (id: string) => sessionMap.get(id),
      getSessionTimeline: () => [],
      getSessionAccess: () => undefined,
      resolveJoinCode: () => ({}),
      updateSessionAccess: () => undefined,
      resolveCanonicalSessionId: (id: string) => ({ canonicalSessionId: id, rebound: null }),
      getRelayRuntimeInfo: () => ({
        relayWsPort: 8787,
        relayWsUrl: 'ws://127.0.0.1:8787',
        relayLabel: 'local-relay',
        relayNamespace: 'http://127.0.0.1:4100',
        viewerBaseUrl: 'http://127.0.0.1:4100',
        shareJoinBaseUrl: 'http://127.0.0.1:4100/join',
        debugHttpEnabled: false,
        corsEnabled: false,
        heartbeatTimeoutMs: 10000,
        totalSessions: 1,
        activeSessions: 1,
        staleSessions: 0,
        checkedAt: 1000,
      }),
    };
    app = express();
    app.use('/api/viewer', createViewerApiRouter(relayServer));
  });

  it('relay runtime info endpoint를 제공한다', async () => {
    const res = await request(app).get('/api/viewer/relay-info');
    expect(res.status).toBe(200);
    expect(res.body.relayWsUrl).toBe('ws://127.0.0.1:8787');
    expect(res.body.relayLabel).toBe('local-relay');
    expect(res.body.viewerBaseUrl).toBe('http://127.0.0.1:4100');
    expect(res.body.activeSessions).toBe(1);
  });

  it('세션 없음 → 404 + not_found', async () => {
    const res = await request(app).get('/api/viewer/sessions/NOPE');
    expect(res.status).toBe(404);
    expect(res.body.viewerStatus).toBe('not_found');
  });

  it('세션 조회 응답에 access metadata가 포함된다', async () => {
    relayServer.getSessionAccess = () => ({
      sessionId: 'S-META',
      joinCode: 'ABCD23',
      visibility: 'code',
      shareEnabled: true,
      createdAt: 100,
      updatedAt: 200,
    });

    sessionMap.set('S-META', {
      sessionId: 'S-META',
      status: 'active',
      updatedAt: 123,
      lastHeartbeatAt: 123,
      latestSequence: 0,
      latestState: undefined,
    });

    const res = await request(app).get('/api/viewer/sessions/S-META');
    expect(res.status).toBe(200);
    expect(res.body.access.joinCode).toBe('ABCD23');
    expect(res.body.access.shareEnabled).toBe(true);
    expect(res.body.joinCode).toBe('ABCD23');
    expect(res.body.visibility).toBe('code');
  });

  it('세션 있으나 snapshot 없음 → waiting', async () => {
    sessionMap.set('S1', {
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
    sessionMap.set('S2', {
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

  it('timeline endpoint가 note/ops event를 공통 timeline shape로 직렬화한다', async () => {
    relayServer.getSessionTimeline = () => [
      {
        kind: 'note',
        timestamp: 1000,
        note: {
          noteId: 'note-1',
          sessionId: 'S-TL',
          timestamp: 1000,
          createdAt: 1000,
          category: 'strategy',
          text: 'Box this lap',
          authorLabel: 'Strategist',
          lap: 12,
          severity: 'high',
        },
      },
      {
        kind: 'ops_event',
        timestamp: 1100,
        event: {
          eventId: 'evt-1',
          type: 'visibility_changed',
          sessionId: 'S-TL',
          timestamp: 1100,
          payload: { nextVisibility: 'code' },
        },
      },
    ];

    const res = await request(app).get('/api/viewer/timeline/S-TL');
    expect(res.status).toBe(200);
    expect(res.body.timeline).toEqual([
      expect.objectContaining({
        eventId: 'note-1',
        type: 'note',
        sessionId: 'S-TL',
        lap: 12,
        timestamp: 1000,
        data: expect.objectContaining({
          text: 'Box this lap',
          category: 'strategy',
          authorLabel: 'Strategist',
          severity: 'high',
        }),
      }),
      expect.objectContaining({
        eventId: 'evt-1',
        type: 'visibility_changed',
        sessionId: 'S-TL',
        timestamp: 1100,
        data: { nextVisibility: 'code' },
      }),
    ]);
  });

  it('alias session 조회 시 rebound metadata를 포함한다', async () => {
    relayServer.resolveCanonicalSessionId = (id: string) =>
      id === 'S-OLD'
        ? { canonicalSessionId: 'S-CANON', rebound: { from: 'S-OLD', to: 'S-CANON' } }
        : { canonicalSessionId: id, rebound: null };
    sessionMap.set('S-CANON', {
      sessionId: 'S-CANON',
      status: 'active',
      updatedAt: 123,
      lastHeartbeatAt: 123,
      latestSequence: 10,
      latestState: { playerCarIndex: 0 },
    });

    const res = await request(app).get('/api/viewer/sessions/S-OLD');
    expect(res.status).toBe(200);
    expect(res.body.requestedSessionId).toBe('S-OLD');
    expect(res.body.rebound).toEqual({ from: 'S-OLD', to: 'S-CANON' });
  });

  it('stale → stale', async () => {
    sessionMap.set('S3', {
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
    sessionMap.set('S4', {
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
