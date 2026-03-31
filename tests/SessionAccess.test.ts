import request from 'supertest';
import express from 'express';
import { createViewerApiRouter } from '../src/relay/viewerApi';
import { RelayServer } from '../src/relay/RelayServer';

describe('Session Access/Invite (joinCode) API', () => {
  let app: express.Express;
  let relayServer: RelayServer;

  beforeEach(() => {
    relayServer = new RelayServer({ wsPort: 0 });
    app = express();
    app.use('/api/viewer', createViewerApiRouter(relayServer));
  });

  it('세션 생성 시 joinCode/access record가 생성된다', () => {
    // host_hello 시점에 joinCode/access 생성
    // 내부 메서드 직접 호출 (테스트 목적)
    const ws = { send: jest.fn() } as any;
    (relayServer as any).handleHostHello(ws, 'conn1', { requestedSessionId: undefined });
    const accessRecords = Array.from((relayServer as any).sessionAccess.values());
    expect(accessRecords.length).toBe(1);
    expect(accessRecords[0].joinCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(accessRecords[0].sessionId).toBeDefined();
  });

  it('joinCode로 세션 조회 가능, 정책별 접근 가능/불가', async () => {
    // 세션 생성
    const ws = { send: jest.fn() } as any;
    (relayServer as any).handleHostHello(ws, 'conn2', { requestedSessionId: undefined });
    const access = Array.from((relayServer as any).sessionAccess.values())[0];
    // 기본값: shareEnabled=false, visibility=private
    let res = await request(app).get(`/api/viewer/join/${access.joinCode}`);
    expect(res.status).toBe(403);
    expect(res.body.viewerStatus).toBe('not_shared');
    // 공유 활성화
    access.shareEnabled = true;
    access.visibility = 'code';
    res = await request(app).get(`/api/viewer/join/${access.joinCode}`);
    expect(res.status).toBe(200);
    expect(res.body.viewerStatus).toBeDefined();
    // 잘못된 코드
    res = await request(app).get(`/api/viewer/join/ZZZZZZ`);
    expect(res.status).toBe(404);
    expect(res.body.viewerStatus).toBe('invalid_code');
  });
});
