import express from 'express';
import { RelayServer } from './RelayServer';
import { serializeViewerSession } from './viewerStatus';
import { serializeSessionAccess } from './RelayServer';
import {
  AddSessionNoteInput,
  NOTE_ALLOWED_AUTHOR_LABELS,
  NOTE_ALLOWED_CATEGORIES,
  NOTE_ALLOWED_SEVERITIES,
  NOTE_MAX_TEXT_LENGTH,
} from './notes';

export function createViewerApiRouter(relayServer: RelayServer) {
  const router = express.Router();

  function readQueryString(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
  }

  function getRelayInfo() {
    if (typeof (relayServer as any).getRelayRuntimeInfo !== 'function') {
      return null;
    }
    return (relayServer as any).getRelayRuntimeInfo();
  }

  function buildAbsoluteJoinUrl(joinCode: string): string {
    const info = getRelayInfo();
    const base = info?.viewerBaseUrl || '';
    if (!base) {
      return `/join/${joinCode}`;
    }
    return `${String(base).replace(/\/$/, '')}/join/${joinCode}`;
  }

  function resolveSession(sessionId: string) {
    if (typeof (relayServer as any).resolveCanonicalSessionId === 'function') {
      return (relayServer as any).resolveCanonicalSessionId(sessionId);
    }
    return { canonicalSessionId: sessionId, rebound: null };
  }

  function parseNotePayload(body: any): { payload?: AddSessionNoteInput; error?: string } {
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return { error: 'invalid_text' };
    }
    if (text.length > NOTE_MAX_TEXT_LENGTH) {
      return { error: 'text_too_long' };
    }

    let category: AddSessionNoteInput['category'];
    if (body?.category !== undefined) {
      if (!NOTE_ALLOWED_CATEGORIES.includes(body.category)) {
        return { error: 'invalid_category' };
      }
      category = body.category;
    }

    let authorLabel: AddSessionNoteInput['authorLabel'];
    if (body?.authorLabel !== undefined) {
      if (!NOTE_ALLOWED_AUTHOR_LABELS.includes(body.authorLabel)) {
        return { error: 'invalid_author_label' };
      }
      authorLabel = body.authorLabel;
    }

    let severity: AddSessionNoteInput['severity'];
    if (body?.severity !== undefined) {
      if (!NOTE_ALLOWED_SEVERITIES.includes(body.severity)) {
        return { error: 'invalid_severity' };
      }
      severity = body.severity;
    }

    let lap: number | undefined;
    if (body?.lap !== undefined) {
      const lapNum = Number(body.lap);
      if (!Number.isFinite(lapNum) || lapNum < 0) {
        return { error: 'invalid_lap' };
      }
      lap = Math.floor(lapNum);
    }

    let timestamp: number | undefined;
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

  // GET /api/viewer/rooms/active
  router.get('/rooms/active', (_req, res) => {
    const rooms = relayServer
      .listSessionOpsSummaries()
      .filter((row) => row.relayStatus !== 'closed')
      .map((row) => ({
        sessionId: row.sessionId,
        joinCode: row.joinCode,
        roomTitle: row.roomTitle,
        relayStatus: row.relayStatus,
        healthLevel: row.healthLevel,
        driverLabel: row.driverLabel,
        carLabel: row.carLabel,
        passwordEnabled: row.passwordEnabled,
        shareEnabled: row.shareEnabled,
        visibility: row.visibility,
        viewerAccessLabel: row.viewerAccessLabel,
        updatedAt: row.updatedAt,
      }));
    res.json({ rooms, count: rooms.length, relay: getRelayInfo() });
  });

  // GET /api/viewer/rooms/join/:joinCode
  router.get('/rooms/join/:joinCode', (req, res) => {
    const joinCode = req.params.joinCode;
    const { sessionId, access } = relayServer.resolveJoinCode(joinCode);
    if (!sessionId || !access) {
      return res.status(404).json({
        error: 'invalid_room',
        accessError: {
          code: 'invalid_code',
          message: '유효하지 않은 Room 코드입니다.',
        },
      });
    }

    const session = relayServer.getSession(sessionId);
    const viewerStatus = serializeViewerSession(session).viewerStatus;

    res.json({
      sessionId,
      joinCode,
      roomTitle: access.roomTitle,
      passwordEnabled: !!access.roomPassword,
      relayStatus: session?.status || 'closed',
      viewerStatus,
      driverLabel: access.driverLabel,
      carLabel: access.carLabel,
      shareEnabled: access.shareEnabled,
      visibility: access.visibility,
      relay: getRelayInfo(),
    });
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

  // GET /api/viewer/relay-info
  router.get('/relay-info', (_req, res) => {
    const info = getRelayInfo();
    if (!info) {
      return res.status(501).json({ error: 'relay_info_unavailable' });
    }
    const viewerBaseUrl: string = info.viewerBaseUrl || '';
    const publicUrlWarning =
      viewerBaseUrl.includes('127.0.0.1') || viewerBaseUrl.includes('localhost');
    res.json({ ...info, publicUrlWarning });
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
    const { sessionId: requestedSessionId } = req.params;
    const resolution = resolveSession(requestedSessionId);
    const strategy = relayServer.getSessionStrategy(resolution.canonicalSessionId);
    if (strategy.strategyUnavailable && strategy.reason === 'session_not_found') {
      return res.status(404).json({ sessionId: resolution.canonicalSessionId, requestedSessionId, rebound: resolution.rebound, ...strategy });
    }
    res.json({ sessionId: resolution.canonicalSessionId, requestedSessionId, rebound: resolution.rebound, ...strategy });
  });

  // GET /api/viewer/archives?limit=100
  router.get('/archives', (req, res) => {
    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 100;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
    const archives = relayServer.listSessionArchives(limit);
    res.json({ archives, count: archives.length, limit });
  });

  // GET /api/viewer/archive/:sessionId
  router.get('/archive/:sessionId', (req, res) => {
    const { sessionId: requestedSessionId } = req.params;
    const resolution = resolveSession(requestedSessionId);
    const archive = relayServer.getSessionArchive(resolution.canonicalSessionId);
    if (!archive) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({ sessionId: resolution.canonicalSessionId, requestedSessionId, rebound: resolution.rebound, archive });
  });

  // GET /api/viewer/archive/:sessionId/summary
  router.get('/archive/:sessionId/summary', (req, res) => {
    const { sessionId: requestedSessionId } = req.params;
    const resolution = resolveSession(requestedSessionId);
    const summary = relayServer.getSessionArchiveSummary(resolution.canonicalSessionId);
    if (!summary) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({ sessionId: resolution.canonicalSessionId, requestedSessionId, rebound: resolution.rebound, summary });
  });

  // GET /api/viewer/archive/:sessionId/timeline?limit=500
  router.get('/archive/:sessionId/timeline', (req, res) => {
    const { sessionId: requestedSessionId } = req.params;
    const resolution = resolveSession(requestedSessionId);
    const summary = relayServer.getSessionArchiveSummary(resolution.canonicalSessionId);
    if (!summary) {
      return res.status(404).json({ error: 'not_found' });
    }

    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 500;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, limitRaw)) : 500;
    const timeline = relayServer.getSessionArchiveTimeline(resolution.canonicalSessionId, limit);
    res.json({ sessionId: resolution.canonicalSessionId, requestedSessionId, rebound: resolution.rebound, timeline, count: timeline.length, limit });
  });

  // GET /api/viewer/health/:sessionId
  router.get('/health/:sessionId', (req, res) => {
    const { sessionId: requestedSessionId } = req.params;
    const resolution = resolveSession(requestedSessionId);
    const health = relayServer.getSessionHealth(resolution.canonicalSessionId);
    res.json({ ...health, requestedSessionId, rebound: resolution.rebound });
  });

  // GET /api/viewer/sessions/:sessionId
  router.get('/sessions/:sessionId', (req, res) => {
    const requestedSessionId = req.params.sessionId;
    const resolution = resolveSession(requestedSessionId);
    const sessionId = resolution.canonicalSessionId;
    const session = relayServer.getSession(sessionId);
    const payload = serializeViewerSession(session);
    const access = serializeSessionAccess(relayServer.getSessionAccess(sessionId));
    const response = {
      ...payload,
      requestedSessionId,
      rebound: resolution.rebound,
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
    const { sessionId: requestedSessionId } = req.params;
    const resolution = resolveSession(requestedSessionId);
    const sessionId = resolution.canonicalSessionId;
    const access = serializeSessionAccess(relayServer.getSessionAccess(sessionId), { includeSecrets: true });
    if (!access) {
      return res.status(404).json({ error: 'not_found' });
    }

    res.json({
      sessionId,
      requestedSessionId,
      rebound: resolution.rebound,
      access,
      joinCode: access.joinCode,
      roomTitle: access.roomTitle,
      passwordEnabled: access.passwordEnabled,
      permissionCode: access.permissionCode,
      shareEnabled: access.shareEnabled,
      visibility: access.visibility,
      joinPath: `/join/${access.joinCode}`,
      joinUrl: buildAbsoluteJoinUrl(access.joinCode),
      relay: getRelayInfo(),
    });
  });

  // GET /api/viewer/join/:joinCode
  router.get('/join/:joinCode', (req, res) => {
    const joinCode = req.params.joinCode;
    const roomPassword = readQueryString(req.query.password);
    const permissionCode = readQueryString(req.query.permissionCode).toUpperCase();
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

    if (access.roomPassword && roomPassword !== access.roomPassword) {
      return res.status(403).json({
        viewerStatus: 'password_required',
        accessError: {
          code: roomPassword ? 'invalid_password' : 'password_required',
          message: roomPassword
            ? 'Room Password가 일치하지 않습니다.'
            : '이 Room은 Password가 필요합니다.',
        },
        sessionId,
        roomTitle: access.roomTitle,
        joinCode,
        passwordEnabled: true,
      });
    }

    const permissionGranted = !!access.permissionCode && permissionCode === access.permissionCode;
    const grantedRole = permissionGranted
      ? 'strategist'
      : access.roomPassword
      ? 'engineer'
      : 'viewer';

    const session = relayServer.getSession(sessionId);
    const payload = serializeViewerSession(session);
    res.json({
      ...payload,
      access: accessSummary,
      joinCode,
      shareEnabled: accessSummary?.shareEnabled,
      visibility: accessSummary?.visibility,
      roomTitle: accessSummary?.roomTitle,
      passwordEnabled: accessSummary?.passwordEnabled,
      joinPath: `/join/${joinCode}`,
      joinUrl: buildAbsoluteJoinUrl(joinCode),
      roomAccess: {
        grantedRole,
        permissionGranted,
        usedPassword: !!access.roomPassword,
      },
      relay: getRelayInfo(),
    });
  });

  // PATCH /api/viewer/session-access/:sessionId
  router.patch('/session-access/:sessionId', (req, res) => {
    // Optional ops token gate: if MPP_OPS_TOKEN is set, require matching Authorization header.
    const requiredToken = (process.env.MPP_OPS_TOKEN || '').trim();
    if (requiredToken) {
      const authHeader = req.headers['authorization'] || '';
      const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      if (provided !== requiredToken) {
        return res.status(401).json({ error: 'unauthorized' });
      }
    }
    const { sessionId } = req.params;
    const {
      shareEnabled,
      visibility,
      roomTitle,
      roomPassword,
      permissionCode,
    } = req.body || {};
    const updated = relayServer.updateSessionAccess(sessionId, {
      shareEnabled,
      visibility,
      roomTitle,
      roomPassword,
      permissionCode,
    });
    if (!updated) return res.status(404).json({ error: 'not_found' });
    const access = serializeSessionAccess(updated, { includeSecrets: true });
    res.json({
      sessionId,
      access,
      joinCode: access?.joinCode,
      roomTitle: access?.roomTitle,
      passwordEnabled: access?.passwordEnabled,
      permissionCode: access?.permissionCode,
      shareEnabled: access?.shareEnabled,
      visibility: access?.visibility,
      updatedAt: access?.updatedAt,
      joinPath: access?.joinCode ? `/join/${access.joinCode}` : undefined,
      joinUrl: access?.joinCode ? buildAbsoluteJoinUrl(access.joinCode) : undefined,
      relay: getRelayInfo(),
    });
  });

  return router;
}
