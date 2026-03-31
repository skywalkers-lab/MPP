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
      return res.status(404).json({ viewerStatus: 'invalid_code', message: '유효하지 않은 초대 코드입니다.' });
    }
    if (!access.shareEnabled || access.visibility === 'private') {
      return res.status(403).json({ viewerStatus: 'not_shared', message: '이 세션은 현재 공유 중이 아닙니다.' });
    }
    const session = relayServer.getSession(sessionId);
    const payload = serializeViewerSession(session);
    res.json({ ...payload, joinCode, access });
  });

  // PATCH /api/viewer/session-access/:sessionId
  router.patch('/session-access/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const { shareEnabled, visibility } = req.body || {};
    const updated = relayServer.updateSessionAccess(sessionId, { shareEnabled, visibility });
    if (!updated) return res.status(404).json({ error: 'not_found' });
    res.json({ sessionId, shareEnabled: updated.shareEnabled, visibility: updated.visibility, updatedAt: updated.updatedAt });
  });

  return router;
}
