// viewer 전용 API 라우트 (Express Router)
import express from 'express';
import { serializeViewerSession } from './viewerStatus';
export function createViewerApiRouter(relayServer) {
    const router = express.Router();
    // GET /api/viewer/sessions/:sessionId
    router.get('/sessions/:sessionId', (req, res) => {
        const sessionId = req.params.sessionId;
        const session = relayServer.getSession(sessionId);
        const payload = serializeViewerSession(session);
        if (!session) {
            res.status(404).json(payload);
        }
        else {
            res.json(payload);
        }
    });
    return router;
}
