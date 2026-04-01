import express from 'express';
import { RelayServer } from './RelayServer';
import { serializeViewerSession } from './viewerStatus';
import { serializeSessionAccess } from './RelayServer';

export function createViewerApiRouter(relayServer: RelayServer) {
  const router = express.Router();

  // GET /api/viewer/sessions/:sessionId
  router.get('/sessions/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const session = relayServer.getSession(sessionId);
    const payload = serializeViewerSession(session);
    const access = serializeSessionAccess(relayServer.getSessionAccess(sessionId));
    const response = {
      ...payload,
      access,
      joinCode: access?.joinCode,
      shareEnabled: access?.shareEnabled,
      visibility: access?.visibility,
    };
    if (!session) {
      res.status(404).json(response);
    } else {
      res.json(response);
    }
  });

  // GET /api/viewer/session-access/:sessionId
  router.get('/session-access/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const access = serializeSessionAccess(relayServer.getSessionAccess(sessionId));
    if (!access) {
      return res.status(404).json({ error: 'not_found' });
    }

    res.json({
      sessionId,
      access,
      joinCode: access.joinCode,
      shareEnabled: access.shareEnabled,
      visibility: access.visibility,
      joinPath: `/join/${access.joinCode}`,
    });
  });

  // GET /api/viewer/join/:joinCode
  router.get('/join/:joinCode', (req, res) => {
    const joinCode = req.params.joinCode;
    const { sessionId, access } = relayServer.resolveJoinCode(joinCode);
    if (!sessionId || !access) {
      return res.status(404).json({
        viewerStatus: 'invalid_code',
        accessError: {
          code: 'invalid_code',
          message: '유효하지 않은 초대 코드입니다.',
        },
        message: '유효하지 않은 초대 코드입니다.',
      });
    }

    const accessSummary = serializeSessionAccess(access);

    if (!access.shareEnabled || access.visibility === 'private') {
      return res.status(403).json({
        viewerStatus: 'not_shared',
        accessError: {
          code: 'not_shared',
          message: '이 세션은 현재 공유 중이 아닙니다.',
        },
        sessionId,
        access: accessSummary,
        joinCode,
        message: '이 세션은 현재 공유 중이 아닙니다.',
      });
    }

    const session = relayServer.getSession(sessionId);
    const payload = serializeViewerSession(session);
    res.json({
      ...payload,
      access: accessSummary,
      joinCode,
      shareEnabled: accessSummary?.shareEnabled,
      visibility: accessSummary?.visibility,
    });
  });

  // PATCH /api/viewer/session-access/:sessionId
  router.patch('/session-access/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const { shareEnabled, visibility } = req.body || {};
    const updated = relayServer.updateSessionAccess(sessionId, { shareEnabled, visibility });
    if (!updated) return res.status(404).json({ error: 'not_found' });
    const access = serializeSessionAccess(updated);
    res.json({
      sessionId,
      access,
      joinCode: access?.joinCode,
      shareEnabled: access?.shareEnabled,
      visibility: access?.visibility,
      updatedAt: access?.updatedAt,
    });
  });

  return router;
}
