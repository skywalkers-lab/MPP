// viewer 전용 API 라우트 (Express Router)
import express from 'express';
import { RelayServer } from './RelayServer';
import { serializeViewerSession } from './viewerStatus';

export function createViewerApiRouter(relayServer: RelayServer) {
  const router = express.Router();

  // PATCH /api/session-access/:sessionId (host/internal용, shareEnabled/visibility 변경)
  router.patch('/session-access/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const { shareEnabled, visibility } = req.body || {};
    const updated = relayServer.updateSessionAccess(sessionId, { shareEnabled, visibility });
    if (!updated) return res.status(404).json({ error: 'not_found' });
    res.json({ sessionId, shareEnabled: updated.shareEnabled, visibility: updated.visibility, updatedAt: updated.updatedAt });
  });
// viewer 전용 API 라우트 (Express Router)
import express from 'express';
import { RelayServer } from './RelayServer';
import { serializeViewerSession } from './viewerStatus';

export function createViewerApiRouter(relayServer: RelayServer) {
  const router = express.Router();

  // GET /api/viewer/sessions/:sessionId
  router.get('/sessions/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const session = relayServer.getSession(sessionId);
    const payload = serializeViewerSession(session);
    if (!session) {
      res.status(404).json(payload);
    } else {
      res.json(payload);
    }
  });

  // GET /api/viewer/join/:joinCode
  router.get('/join/:joinCode', (req, res) => {
    const joinCode = req.params.joinCode;
    const { sessionId, access } = relayServer.resolveJoinCode(joinCode);
    if (!sessionId || !access) {
      // 잘못된 코드
      return res.status(404).json({ viewerStatus: 'invalid_code', message: '유효하지 않은 초대 코드입니다.' });
    }
    if (!access.shareEnabled || access.visibility === 'private') {
      // 공유 비활성/비공개
      return res.status(403).json({ viewerStatus: 'not_shared', message: '이 세션은 현재 공유 중이 아닙니다.' });
    }
    const session = relayServer.getSession(sessionId);
    const payload = serializeViewerSession(session);
    // viewerStatus는 기존 serializeViewerSession 결과 사용
    res.json({ ...payload, joinCode, access });
  });

  return router;
}
