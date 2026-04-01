import request from 'supertest';
import express from 'express';
import { createViewerApiRouter } from '../src/relay/viewerApi';
import { RelayServer } from '../src/relay/RelayServer';

describe('Session Access/Invite (joinCode) API', () => {
  let app: express.Express;
  let relayServer: RelayServer;
  let sessionId: string;
  let joinCode: string;

  beforeEach(() => {
    relayServer = new RelayServer({ wsPort: 0 });
    app = express();
    app.use(express.json());
    app.use('/api/viewer', createViewerApiRouter(relayServer));

    const ws = { send: jest.fn() } as any;
    (relayServer as any).handleHostHello(ws, 'conn-test', {
      requestedSessionId: 'S-TEST01',
      protocolVersion: 1,
    });

    const access = (relayServer as any).sessionAccess.get('S-TEST01');
    sessionId = access.sessionId;
    joinCode = access.joinCode;
  });

  it('세션 생성 시 joinCode/access record가 생성된다', () => {
    const access = relayServer.getSessionAccess(sessionId);
    expect(access).toBeDefined();
    expect(access?.joinCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(access?.sessionId).toBe(sessionId);
    expect(access?.shareEnabled).toBe(false);
    expect(access?.visibility).toBe('private');
  });

  it('session access metadata 조회 가능', async () => {
    const res = await request(app).get(`/api/viewer/session-access/${sessionId}`);

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(sessionId);
    expect(res.body.access.joinCode).toBe(joinCode);
    expect(res.body.access.shareEnabled).toBe(false);
    expect(res.body.access.visibility).toBe('private');
    expect(res.body.joinPath).toBe(`/join/${joinCode}`);
  });

  it('존재하지 않는 세션 access 조회는 404를 반환한다', async () => {
    const res = await request(app).get('/api/viewer/session-access/S-NOPE');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('PATCH로 shareEnabled/visibility를 변경할 수 있다', async () => {
    const patchRes = await request(app)
      .patch(`/api/viewer/session-access/${sessionId}`)
      .send({ shareEnabled: true, visibility: 'code' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.access.shareEnabled).toBe(true);
    expect(patchRes.body.access.visibility).toBe('code');
    expect(patchRes.body.joinCode).toBe(joinCode);

    const getRes = await request(app).get(`/api/viewer/session-access/${sessionId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.access.shareEnabled).toBe(true);
    expect(getRes.body.access.visibility).toBe('code');
  });

  it('joinCode 접근은 정책에 따라 허용/거부된다', async () => {
    let res = await request(app).get(`/api/viewer/join/${joinCode}`);
    expect(res.status).toBe(403);
    expect(res.body.viewerStatus).toBe('not_shared');
    expect(res.body.accessError.code).toBe('not_shared');

    await request(app)
      .patch(`/api/viewer/session-access/${sessionId}`)
      .send({ shareEnabled: true, visibility: 'code' });

    res = await request(app).get(`/api/viewer/join/${joinCode}`);
    expect(res.status).toBe(200);
    expect(res.body.viewerStatus).toBeDefined();
    expect(res.body.access.joinCode).toBe(joinCode);
    expect(res.body.shareEnabled).toBe(true);
    expect(res.body.visibility).toBe('code');

    res = await request(app).get(`/api/viewer/join/ZZZZZZ`);
    expect(res.status).toBe(404);
    expect(res.body.viewerStatus).toBe('invalid_code');
    expect(res.body.accessError.code).toBe('invalid_code');
  });
});
