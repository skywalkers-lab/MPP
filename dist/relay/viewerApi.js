import express from 'express';
import { serializeViewerSession } from './viewerStatus';
import { serializeSessionAccess } from './RelayServer';
import { NOTE_ALLOWED_AUTHOR_LABELS, NOTE_ALLOWED_CATEGORIES, NOTE_ALLOWED_SEVERITIES, NOTE_MAX_TEXT_LENGTH, } from './notes';
export function createViewerApiRouter(relayServer) {
    const router = express.Router();
    function parseNotePayload(body) {
        const text = typeof body?.text === 'string' ? body.text.trim() : '';
        if (!text) {
            return { error: 'invalid_text' };
        }
        if (text.length > NOTE_MAX_TEXT_LENGTH) {
            return { error: 'text_too_long' };
        }
        let category;
        if (body?.category !== undefined) {
            if (!NOTE_ALLOWED_CATEGORIES.includes(body.category)) {
                return { error: 'invalid_category' };
            }
            category = body.category;
        }
        let authorLabel;
        if (body?.authorLabel !== undefined) {
            if (!NOTE_ALLOWED_AUTHOR_LABELS.includes(body.authorLabel)) {
                return { error: 'invalid_author_label' };
            }
            authorLabel = body.authorLabel;
        }
        let severity;
        if (body?.severity !== undefined) {
            if (!NOTE_ALLOWED_SEVERITIES.includes(body.severity)) {
                return { error: 'invalid_severity' };
            }
            severity = body.severity;
        }
        let lap;
        if (body?.lap !== undefined) {
            const lapNum = Number(body.lap);
            if (!Number.isFinite(lapNum) || lapNum < 0) {
                return { error: 'invalid_lap' };
            }
            lap = Math.floor(lapNum);
        }
        let timestamp;
        if (body?.timestamp !== undefined) {
            const ts = Number(body.timestamp);
            if (!Number.isFinite(ts) || ts <= 0) {
                return { error: 'invalid_timestamp' };
            }
            timestamp = Math.floor(ts);
        }
        const tag = typeof body?.tag === 'string' ? body.tag.trim().slice(0, 40) : undefined;
        return {
            payload: {
                text,
                category,
                authorLabel,
                lap,
                timestamp,
                severity,
                tag,
            },
        };
    }
    // GET /api/viewer/ops/sessions
    router.get('/ops/sessions', (req, res) => {
        const sessions = relayServer.listSessionOpsSummaries();
        res.json({ sessions, count: sessions.length });
    });
    // GET /api/viewer/ops/events/recent?limit=50
    router.get('/ops/events/recent', (req, res) => {
        const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
        const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
        const events = relayServer
            .getRecentOpsEvents(300)
            .filter((event) => (sessionId ? event.sessionId === sessionId : true))
            .slice(0, limit);
        res.json({ events, count: events.length, limit });
    });
    // GET /api/viewer/notes/:sessionId
    router.get('/notes/:sessionId', (req, res) => {
        const { sessionId } = req.params;
        const notes = relayServer.listSessionNotes(sessionId);
        res.json({ sessionId, notes, count: notes.length });
    });
    // POST /api/viewer/notes/:sessionId
    router.post('/notes/:sessionId', (req, res) => {
        const { sessionId } = req.params;
        const parsed = parseNotePayload(req.body);
        if (parsed.error || !parsed.payload) {
            return res.status(400).json({ error: parsed.error ?? 'invalid_note_payload' });
        }
        const note = relayServer.addSessionNote(sessionId, parsed.payload);
        res.status(201).json({ sessionId, note });
    });
    // DELETE /api/viewer/notes/:sessionId/:noteId
    router.delete('/notes/:sessionId/:noteId', (req, res) => {
        const { sessionId, noteId } = req.params;
        const deleted = relayServer.deleteSessionNote(sessionId, noteId);
        if (!deleted) {
            return res.status(404).json({ error: 'not_found' });
        }
        res.json({ sessionId, noteId, deleted: true });
    });
    // GET /api/viewer/timeline/:sessionId?limit=100
    router.get('/timeline/:sessionId', (req, res) => {
        const { sessionId } = req.params;
        const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 100;
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
        const timeline = relayServer.getSessionTimeline(sessionId, limit);
        res.json({ sessionId, timeline, count: timeline.length, limit });
    });
    // GET /api/viewer/strategy/:sessionId
    router.get('/strategy/:sessionId', (req, res) => {
        const { sessionId } = req.params;
        const strategy = relayServer.getSessionStrategy(sessionId);
        if (strategy.strategyUnavailable && strategy.reason === 'session_not_found') {
            return res.status(404).json({ sessionId, ...strategy });
        }
        res.json({ sessionId, ...strategy });
    });
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
        }
        else {
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
        if (!updated)
            return res.status(404).json({ error: 'not_found' });
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
