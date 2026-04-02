import express from 'express';
import request from 'supertest';
import { RelayServer } from '../src/relay/RelayServer';
import { createViewerApiRouter } from '../src/relay/viewerApi';
import { serializeSessionOpsSummary } from '../src/relay/ops';

describe('Session Ops / Notification / Control Plane', () => {
  let app: express.Express;
  let relayServer: RelayServer;
  let sessionId: string;
  let joinCode: string;

  beforeEach(() => {
    relayServer = new RelayServer({ wsPort: 0, heartbeatTimeoutMs: 1000 });

    app = express();
    app.use(express.json());
    app.use('/api/viewer', createViewerApiRouter(relayServer));

    const ws = { send: jest.fn() } as any;
    (relayServer as any).handleHostHello(ws, 'conn-ops', {
      requestedSessionId: 'S-OPS01',
      protocolVersion: 1,
    });

    const access = relayServer.getSessionAccess('S-OPS01');
    sessionId = access!.sessionId;
    joinCode = access!.joinCode;
  });

  afterEach(() => {
    relayServer.close();
  });

  it('ops summary serializer가 relay/access 상태를 일관되게 묶는다', () => {
    const session = relayServer.getSession(sessionId)!;
    const access = relayServer.getSessionAccess(sessionId);

    const summary = serializeSessionOpsSummary(session, access);
    expect(summary.sessionId).toBe(sessionId);
    expect(summary.relayStatus).toBe('active');
    expect(summary.viewerStatus).toBe('waiting');
    expect(summary.joinCode).toBe(joinCode);
    expect(summary.hasViewerAccess).toBe(false);
    expect(summary.viewerAccessLabel).toBe('private');
    expect(summary.hasSnapshot).toBe(false);
  });

  it('ops sessions 목록 API가 control plane 표시용 shape를 반환한다', async () => {
    const res = await request(app).get('/api/viewer/ops/sessions');
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);

    const row = res.body.sessions.find((s: any) => s.sessionId === sessionId);
    expect(row).toBeDefined();
    expect(row.joinCode).toBe(joinCode);
    expect(row.relayStatus).toBe('active');
    expect(row.viewerStatus).toBe('waiting');
    expect(row.shareEnabled).toBe(false);
    expect(row.visibility).toBe('private');
    expect(typeof row.updatedAt).toBe('number');
    expect(typeof row.lastHeartbeatAt).toBe('number');
    expect(typeof row.latestSequence).toBe('number');
    expect(typeof row.hasSnapshot).toBe('boolean');
    expect(typeof row.hasViewerAccess).toBe('boolean');
    expect(typeof row.strategyUnavailable).toBe('boolean');
    expect(typeof row.strategyGeneratedAt).toBe('number');
    expect(row).toHaveProperty('strategySecondaryLabel');
    expect(row).toHaveProperty('strategyTrafficBand');
  });

  it('shareEnabled/visibility 변경은 ops 이벤트로 기록되고 ops summary에 반영된다', async () => {
    const patchRes = await request(app)
      .patch(`/api/viewer/session-access/${sessionId}`)
      .send({ shareEnabled: true, visibility: 'code' });

    expect(patchRes.status).toBe(200);

    const sessionsRes = await request(app).get('/api/viewer/ops/sessions');
    const row = sessionsRes.body.sessions.find((s: any) => s.sessionId === sessionId);
    expect(row.hasViewerAccess).toBe(true);
    expect(row.viewerAccessLabel).toBe('shared');

    const eventsRes = await request(app).get('/api/viewer/ops/events/recent?limit=20');
    expect(eventsRes.status).toBe(200);

    const types = eventsRes.body.events
      .filter((e: any) => e.sessionId === sessionId)
      .map((e: any) => e.type);

    expect(types).toContain('share_enabled_changed');
    expect(types).toContain('visibility_changed');
  });

  it('stale/active 전이는 session_stale, session_recovered 이벤트로 기록된다', async () => {
    const session = relayServer.getSession(sessionId)!;
    session.lastHeartbeatAt = Date.now() - 5000;

    (relayServer as any).checkHeartbeats();
    (relayServer as any).handleHeartbeat('conn-ops');

    const eventsRes = await request(app).get('/api/viewer/ops/events/recent?limit=20');
    expect(eventsRes.status).toBe(200);

    const types = eventsRes.body.events
      .filter((e: any) => e.sessionId === sessionId)
      .map((e: any) => e.type);

    expect(types).toContain('session_stale');
    expect(types).toContain('session_recovered');
  });
});
