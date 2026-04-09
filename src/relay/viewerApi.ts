import { timingSafeEqual } from 'crypto';
import express, { Request, Response } from 'express';
import {
  RelayServer,
  SessionAccessRecord,
  STRATEGY_ACTIONS,
  StrategyActionName,
} from './RelayServer.js';
import { serializeViewerSession } from './viewerStatus.js';
import { serializeSessionAccess } from './RelayServer.js';
import {
  AddSessionNoteInput,
  NOTE_ALLOWED_AUTHOR_LABELS,
  NOTE_ALLOWED_CATEGORIES,
  NOTE_ALLOWED_SEVERITIES,
  NOTE_MAX_TEXT_LENGTH,
} from './notes.js';

export function createViewerApiRouter(relayServer: RelayServer) {
  const router = express.Router();

  type ViewerRole = 'viewer' | 'engineer' | 'strategist' | 'ops';
  type RequestedViewerRole = 'viewer' | 'engineer' | 'strategist';

  const viewerRoleRank: Record<ViewerRole, number> = {
    viewer: 0,
    engineer: 1,
    strategist: 2,
    ops: 3,
  };

  function readQueryString(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
  }

  function readHeaderString(v: unknown): string {
    if (Array.isArray(v)) {
      return typeof v[0] === 'string' ? v[0].trim() : '';
    }
    return typeof v === 'string' ? v.trim() : '';
  }

  function secureCompareSecret(expected: string, provided: string): boolean {
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');
    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, providedBuf);
  }

  function readRequiredOpsToken(): string {
    return (process.env.MPP_OPS_TOKEN || '').trim();
  }

  function readOpsTokenFromRequest(req: Request): string {
    const authHeader = readHeaderString(req.headers.authorization);
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7).trim();
    }

    const tokenHeader = readHeaderString(req.headers['x-ops-token']);
    if (tokenHeader) {
      return tokenHeader;
    }

    return authHeader;
  }

  function isLoopbackAddress(address: string): boolean {
    const normalized = address.trim();
    if (!normalized) {
      return false;
    }
    if (normalized === '::1' || normalized === '127.0.0.1') {
      return true;
    }
    if (normalized.startsWith('::ffff:')) {
      return normalized.slice(7) === '127.0.0.1';
    }
    return false;
  }

  function isLoopbackHost(hostHeader: string): boolean {
    const host = hostHeader.split(':')[0].trim().toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  }

  function isTrustedLocalRequest(req: Request): boolean {
    const remoteAddress = req.socket.remoteAddress || '';
    if (isLoopbackAddress(remoteAddress)) {
      return true;
    }

    const hostHeader = readHeaderString(req.headers.host);
    return hostHeader ? isLoopbackHost(hostHeader) : false;
  }

  function allowLocalOpsBypass(): boolean {
    const raw = (process.env.MPP_TRUST_LOCAL_OPS || '').trim().toLowerCase();
    if (!raw) {
      return true;
    }
    if (['0', 'false', 'off', 'no'].includes(raw)) {
      return false;
    }
    return true;
  }

  function requirePermissionForMutations(): boolean {
    const raw = (process.env.MPP_REQUIRE_PERMISSION_FOR_MUTATIONS || '')
      .trim()
      .toLowerCase();
    if (!raw) {
      return false;
    }
    return ['1', 'true', 'on', 'yes'].includes(raw);
  }

  function hasValidOpsToken(req: Request): boolean {
    const requiredToken = readRequiredOpsToken();
    if (!requiredToken) {
      return false;
    }
    const providedToken = readOpsTokenFromRequest(req);
    if (!providedToken) {
      return false;
    }
    return secureCompareSecret(requiredToken, providedToken);
  }

  function requireOpsControlAccess(req: Request, res: Response): boolean {
    const requiredToken = readRequiredOpsToken();
    if (!requiredToken) {
      return true;
    }

    if (
      (allowLocalOpsBypass() && isTrustedLocalRequest(req)) ||
      hasValidOpsToken(req)
    ) {
      return true;
    }

    res.status(401).json({ error: 'unauthorized' });
    return false;
  }

  function readViewerCredentials(req: Request): {
    roomPassword: string;
    permissionCode: string;
    usedQueryCredentials: boolean;
    permissionProvided: boolean;
  } {
    const headerPassword = readHeaderString(req.headers['x-room-password']);
    const queryPassword = readQueryString(req.query.password);
    const roomPassword = headerPassword || queryPassword;

    const headerPermission = readHeaderString(req.headers['x-permission-code']).toUpperCase();
    const queryPermission = readQueryString(req.query.permissionCode).toUpperCase();
    const permissionCode = headerPermission || queryPermission;

    return {
      roomPassword,
      permissionCode,
      usedQueryCredentials:
        (!headerPassword && !!queryPassword) || (!headerPermission && !!queryPermission),
      permissionProvided: permissionCode.length > 0,
    };
  }

  function resolveSessionAccess(
    requestedSessionId: string
  ): {
    canonicalSessionId: string;
    rebound: ReturnType<typeof resolveSession>['rebound'];
    access: SessionAccessRecord | undefined;
  } {
    const resolution = resolveSession(requestedSessionId);
    const canonicalSessionId = resolution.canonicalSessionId;
    const access = relayServer.getSessionAccess(canonicalSessionId);
    return { canonicalSessionId, rebound: resolution.rebound, access };
  }

  function deriveGrantedViewerRole(
    req: Request,
    access: SessionAccessRecord | undefined
  ): {
    role: ViewerRole | null;
    accessError?: { code: string; message: string };
    permissionProvided: boolean;
    usedQueryCredentials: boolean;
  } {
    if (hasValidOpsToken(req)) {
      return {
        role: 'ops',
        permissionProvided: false,
        usedQueryCredentials: false,
      };
    }

    const credentials = readViewerCredentials(req);
    if (!access || !access.shareEnabled || access.visibility !== 'code') {
      return {
        role: 'viewer',
        permissionProvided: credentials.permissionProvided,
        usedQueryCredentials: credentials.usedQueryCredentials,
      };
    }

    const expectedPassword = access.roomPassword || '';
    const expectedPermission = (access.permissionCode || '').trim().toUpperCase();

    if (expectedPassword) {
      if (!credentials.roomPassword) {
        return {
          role: null,
          accessError: {
            code: 'password_required',
            message: '이 Room은 Password가 필요합니다.',
          },
          permissionProvided: credentials.permissionProvided,
          usedQueryCredentials: credentials.usedQueryCredentials,
        };
      }

      if (!secureCompareSecret(expectedPassword, credentials.roomPassword)) {
        return {
          role: null,
          accessError: {
            code: 'invalid_password',
            message: 'Room Password가 일치하지 않습니다.',
          },
          permissionProvided: credentials.permissionProvided,
          usedQueryCredentials: credentials.usedQueryCredentials,
        };
      }
    }

    const permissionGranted =
      expectedPermission.length > 0 &&
      credentials.permissionCode.length > 0 &&
      secureCompareSecret(expectedPermission, credentials.permissionCode);

    return {
      role: permissionGranted ? 'strategist' : expectedPassword ? 'engineer' : 'viewer',
      permissionProvided: credentials.permissionProvided,
      usedQueryCredentials: credentials.usedQueryCredentials,
    };
  }

  function ensureViewerRole(
    req: Request,
    res: Response,
    requestedSessionId: string,
    requiredRole: RequestedViewerRole | ((access: SessionAccessRecord | undefined) => RequestedViewerRole)
  ):
    | {
        canonicalSessionId: string;
        rebound: ReturnType<typeof resolveSession>['rebound'];
        access: SessionAccessRecord | undefined;
        role: ViewerRole;
        usedQueryCredentials: boolean;
      }
    | null {
    const { canonicalSessionId, rebound, access } = resolveSessionAccess(requestedSessionId);
    const grant = deriveGrantedViewerRole(req, access);

    if (!grant.role) {
      res.status(403).json({
        error: 'forbidden',
        accessError: grant.accessError,
        sessionId: canonicalSessionId,
        requestedSessionId,
        rebound,
      });
      return null;
    }

    const desiredRole =
      typeof requiredRole === 'function' ? requiredRole(access) : requiredRole;
    const effectiveRequiredRole: RequestedViewerRole =
      access && access.shareEnabled && access.visibility === 'code'
        ? desiredRole
        : 'viewer';

    if (viewerRoleRank[grant.role] < viewerRoleRank[effectiveRequiredRole]) {
      const code =
        effectiveRequiredRole === 'strategist'
          ? grant.permissionProvided
            ? 'invalid_permission_code'
            : 'permission_required'
          : 'password_required';

      const message =
        effectiveRequiredRole === 'strategist'
          ? grant.permissionProvided
            ? 'Permission Code가 일치하지 않습니다.'
            : '이 작업은 Permission Code가 필요합니다.'
          : '이 작업은 Room Password 권한이 필요합니다.';

      res.status(403).json({
        error: 'forbidden',
        accessError: { code, message },
        sessionId: canonicalSessionId,
        requestedSessionId,
        rebound,
      });
      return null;
    }

    return {
      canonicalSessionId,
      rebound,
      access,
      role: grant.role,
      usedQueryCredentials: grant.usedQueryCredentials,
    };
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

  function parseActionPayload(body: any): {
    payload?: {
      action: StrategyActionName;
      lap?: number;
      timestamp?: number;
      authorLabel?: AddSessionNoteInput['authorLabel'];
      severity?: AddSessionNoteInput['severity'];
    };
    error?: string;
  } {
    const rawAction = typeof body?.action === 'string' ? body.action.trim().toUpperCase() : '';
    if (!rawAction || !STRATEGY_ACTIONS.includes(rawAction as StrategyActionName)) {
      return { error: 'invalid_action' };
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

    return {
      payload: {
        action: rawAction as StrategyActionName,
        lap,
        timestamp,
        authorLabel,
        severity,
      },
    };
  }

  // GET /api/viewer/ops/sessions
  router.get('/ops/sessions', (req, res) => {
    if (!requireOpsControlAccess(req, res)) {
      return;
    }
    const sessions = relayServer.listSessionOpsSummaries();
    res.json({ sessions, count: sessions.length });
  });

  // GET /api/viewer/rooms/active
  router.get('/rooms/active', (req, res) => {
    if (!requireOpsControlAccess(req, res)) {
      return;
    }
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
    if (!requireOpsControlAccess(req, res)) {
      return;
    }
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
    const auth = ensureViewerRole(req, res, req.params.sessionId, 'viewer');
    if (!auth) {
      return;
    }

    const notes = relayServer.listSessionNotes(auth.canonicalSessionId);
    res.json({
      sessionId: auth.canonicalSessionId,
      requestedSessionId: req.params.sessionId,
      rebound: auth.rebound,
      notes,
      count: notes.length,
    });
  });

  // POST /api/viewer/notes/:sessionId
  router.post('/notes/:sessionId', (req, res) => {
    const auth = ensureViewerRole(req, res, req.params.sessionId, (access) => {
      if (!access || !access.shareEnabled || access.visibility !== 'code') {
        return 'viewer';
      }
      if (requirePermissionForMutations() && access.permissionCode) {
        return 'strategist';
      }
      if (access.roomPassword) {
        return 'engineer';
      }
      return 'viewer';
    });
    if (!auth) {
      return;
    }

    const parsed = parseNotePayload(req.body);
    if (parsed.error || !parsed.payload) {
      return res.status(400).json({ error: parsed.error ?? 'invalid_note_payload' });
    }

    const note = relayServer.addSessionNote(auth.canonicalSessionId, parsed.payload);
    res.status(201).json({
      sessionId: auth.canonicalSessionId,
      requestedSessionId: req.params.sessionId,
      rebound: auth.rebound,
      note,
    });
  });

  // DELETE /api/viewer/notes/:sessionId/:noteId
  router.delete('/notes/:sessionId/:noteId', (req, res) => {
    const auth = ensureViewerRole(req, res, req.params.sessionId, (access) => {
      if (!access || !access.shareEnabled || access.visibility !== 'code') {
        return 'viewer';
      }
      if (requirePermissionForMutations() && access.permissionCode) {
        return 'strategist';
      }
      if (access.roomPassword) {
        return 'engineer';
      }
      return 'viewer';
    });
    if (!auth) {
      return;
    }

    const { noteId } = req.params;
    const deleted = relayServer.deleteSessionNote(auth.canonicalSessionId, noteId);
    if (!deleted) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({
      sessionId: auth.canonicalSessionId,
      requestedSessionId: req.params.sessionId,
      rebound: auth.rebound,
      noteId,
      deleted: true,
    });
  });

  // POST /api/viewer/actions/:sessionId
  router.post('/actions/:sessionId', (req, res) => {
    const auth = ensureViewerRole(req, res, req.params.sessionId, (access) => {
      if (!access || !access.shareEnabled || access.visibility !== 'code') {
        return 'viewer';
      }
      if (requirePermissionForMutations() && access.permissionCode) {
        return 'strategist';
      }
      if (access.roomPassword) {
        return 'engineer';
      }
      return 'viewer';
    });
    if (!auth) {
      return;
    }

    const parsed = parseActionPayload(req.body);
    if (parsed.error || !parsed.payload) {
      return res.status(400).json({ error: parsed.error ?? 'invalid_action_payload' });
    }

    const action = relayServer.logStrategyAction(auth.canonicalSessionId, parsed.payload);
    res.status(201).json({
      sessionId: auth.canonicalSessionId,
      requestedSessionId: req.params.sessionId,
      rebound: auth.rebound,
      action,
    });
  });

  // GET /api/viewer/timeline/:sessionId?limit=100
  router.get('/timeline/:sessionId', (req, res) => {
    const auth = ensureViewerRole(req, res, req.params.sessionId, 'viewer');
    if (!auth) {
      return;
    }

    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 100;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
    const timeline = relayServer.getSessionTimeline(auth.canonicalSessionId, limit);
    res.json({
      sessionId: auth.canonicalSessionId,
      requestedSessionId: req.params.sessionId,
      rebound: auth.rebound,
      timeline,
      count: timeline.length,
      limit,
    });
  });

  // GET /api/viewer/strategy/:sessionId
  router.get('/strategy/:sessionId', (req, res) => {
    const requestedSessionId = req.params.sessionId;
    const auth = ensureViewerRole(req, res, requestedSessionId, 'viewer');
    if (!auth) {
      return;
    }

    const strategy = relayServer.getSessionStrategy(auth.canonicalSessionId);
    if (strategy.strategyUnavailable && strategy.reason === 'session_not_found') {
      return res.status(404).json({
        sessionId: auth.canonicalSessionId,
        requestedSessionId,
        rebound: auth.rebound,
        ...strategy,
      });
    }
    res.json({
      sessionId: auth.canonicalSessionId,
      requestedSessionId,
      rebound: auth.rebound,
      ...strategy,
    });
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
    const requestedSessionId = req.params.sessionId;
    const auth = ensureViewerRole(req, res, requestedSessionId, 'viewer');
    if (!auth) {
      return;
    }

    const archive = relayServer.getSessionArchive(auth.canonicalSessionId);
    if (!archive) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({
      sessionId: auth.canonicalSessionId,
      requestedSessionId,
      rebound: auth.rebound,
      archive,
    });
  });

  // GET /api/viewer/archive/:sessionId/summary
  router.get('/archive/:sessionId/summary', (req, res) => {
    const requestedSessionId = req.params.sessionId;
    const auth = ensureViewerRole(req, res, requestedSessionId, 'viewer');
    if (!auth) {
      return;
    }

    const summary = relayServer.getSessionArchiveSummary(auth.canonicalSessionId);
    if (!summary) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({
      sessionId: auth.canonicalSessionId,
      requestedSessionId,
      rebound: auth.rebound,
      summary,
    });
  });

  // GET /api/viewer/archive/:sessionId/timeline?limit=500
  router.get('/archive/:sessionId/timeline', (req, res) => {
    const requestedSessionId = req.params.sessionId;
    const auth = ensureViewerRole(req, res, requestedSessionId, 'viewer');
    if (!auth) {
      return;
    }

    const summary = relayServer.getSessionArchiveSummary(auth.canonicalSessionId);
    if (!summary) {
      return res.status(404).json({ error: 'not_found' });
    }

    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 500;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, limitRaw)) : 500;
    const timeline = relayServer.getSessionArchiveTimeline(auth.canonicalSessionId, limit);
    res.json({
      sessionId: auth.canonicalSessionId,
      requestedSessionId,
      rebound: auth.rebound,
      timeline,
      count: timeline.length,
      limit,
    });
  });

  // GET /api/viewer/health/:sessionId
  router.get('/health/:sessionId', (req, res) => {
    const requestedSessionId = req.params.sessionId;
    const auth = ensureViewerRole(req, res, requestedSessionId, 'viewer');
    if (!auth) {
      return;
    }

    const health = relayServer.getSessionHealth(auth.canonicalSessionId);
    res.json({ ...health, requestedSessionId, rebound: auth.rebound });
  });

  // GET /api/viewer/sessions/:sessionId
  router.get('/sessions/:sessionId', (req, res) => {
    const requestedSessionId = req.params.sessionId;
    const auth = ensureViewerRole(req, res, requestedSessionId, 'viewer');
    if (!auth) {
      return;
    }

    const sessionId = auth.canonicalSessionId;
    const session = relayServer.getSession(sessionId);
    const payload = serializeViewerSession(session);
    const access = serializeSessionAccess(relayServer.getSessionAccess(sessionId));
    const response = {
      ...payload,
      requestedSessionId,
      rebound: auth.rebound,
      access,
      joinCode: access?.joinCode,
      shareEnabled: access?.shareEnabled,
      visibility: access?.visibility,
      credentialWarning: auth.usedQueryCredentials ? 'query_credentials_deprecated' : undefined,
    };
    if (!session) {
      res.status(404).json(response);
    } else {
      res.json(response);
    }
  });

  // GET /api/viewer/session-access/:sessionId
  router.get('/session-access/:sessionId', (req, res) => {
    if (!requireOpsControlAccess(req, res)) {
      return;
    }

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
    const credentials = readViewerCredentials(req);
    const roomPassword = credentials.roomPassword;
    const permissionCode = credentials.permissionCode;
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

    const expectedPassword = access.roomPassword || '';
    if (expectedPassword) {
      const passwordMatched =
        roomPassword.length > 0 && secureCompareSecret(expectedPassword, roomPassword);
      if (!passwordMatched) {
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
          credentialWarning: credentials.usedQueryCredentials
            ? 'query_credentials_deprecated'
            : undefined,
        });
      }
    }

    const expectedPermission = (access.permissionCode || '').trim().toUpperCase();
    const permissionGranted =
      expectedPermission.length > 0 &&
      permissionCode.length > 0 &&
      secureCompareSecret(expectedPermission, permissionCode);

    const grantedRole = permissionGranted
      ? 'strategist'
      : expectedPassword
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
        usedPassword: !!expectedPassword,
      },
      credentialWarning: credentials.usedQueryCredentials
        ? 'query_credentials_deprecated'
        : undefined,
      relay: getRelayInfo(),
    });
  });

  // PATCH /api/viewer/session-access/:sessionId
  router.patch('/session-access/:sessionId', (req, res) => {
    if (!requireOpsControlAccess(req, res)) {
      return;
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
