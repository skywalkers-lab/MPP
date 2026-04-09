import type { DiagnosticsData, RelayInfo, Room, StrategyData, SessionNote, TimelineEvent, SessionAccessRecord, SessionHealthData, OpsSession, ArchiveSummary, SessionActionResult, StrategyActionName } from '../types';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchRooms(): Promise<{ rooms: Room[]; count: number; relay: RelayInfo }> {
  return get('/api/viewer/rooms/active');
}

export async function fetchDiagnostics(): Promise<DiagnosticsData> {
  return get('/diagnostics');
}

export async function fetchRelayInfo(): Promise<RelayInfo> {
  return get('/api/viewer/relay-info');
}

export async function fetchStrategy(sessionId: string): Promise<StrategyData> {
  return get(`/api/viewer/strategy/${encodeURIComponent(sessionId)}`);
}

export async function fetchNotes(sessionId: string, password?: string, permissionCode?: string): Promise<{ notes: SessionNote[]; count: number }> {
  const params = new URLSearchParams();
  if (password) params.set('password', password);
  if (permissionCode) params.set('permissionCode', permissionCode);
  const q = params.toString();
  return get(`/api/viewer/notes/${encodeURIComponent(sessionId)}${q ? `?${q}` : ''}`);
}

export async function addNote(sessionId: string, payload: Partial<SessionNote> & { text: string }, password?: string, permissionCode?: string): Promise<{ note: SessionNote }> {
  const params = new URLSearchParams();
  if (password) params.set('password', password);
  if (permissionCode) params.set('permissionCode', permissionCode);
  const q = params.toString();
  const res = await fetch(`/api/viewer/notes/${encodeURIComponent(sessionId)}${q ? `?${q}` : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function deleteNote(sessionId: string, noteId: string, password?: string, permissionCode?: string): Promise<void> {
  const params = new URLSearchParams();
  if (password) params.set('password', password);
  if (permissionCode) params.set('permissionCode', permissionCode);
  const q = params.toString();
  const res = await fetch(`/api/viewer/notes/${encodeURIComponent(sessionId)}/${encodeURIComponent(noteId)}${q ? `?${q}` : ''}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function fetchTimeline(sessionId: string, limit = 120): Promise<{ timeline: TimelineEvent[]; count: number }> {
  return get(`/api/viewer/timeline/${encodeURIComponent(sessionId)}?limit=${limit}`);
}

export async function fetchSessionAccess(sessionId: string, password?: string, permissionCode?: string): Promise<SessionAccessRecord> {
  const params = new URLSearchParams();
  if (password) params.set('password', password);
  if (permissionCode) params.set('permissionCode', permissionCode);
  const q = params.toString();
  return get(`/api/viewer/session-access/${encodeURIComponent(sessionId)}${q ? `?${q}` : ''}`);
}

export async function fetchSessionHealth(sessionId: string): Promise<SessionHealthData> {
  return get(`/api/viewer/health/${encodeURIComponent(sessionId)}`);
}

export async function fetchJoinRoom(joinCode: string, password?: string, permissionCode?: string): Promise<{ sessionId: string; roomTitle: string; relayStatus: string; viewerStatus: unknown }> {
  const params = new URLSearchParams();
  if (password) params.set('password', password);
  if (permissionCode) params.set('permissionCode', permissionCode);
  const q = params.toString();
  return get(`/api/viewer/rooms/join/${encodeURIComponent(joinCode)}${q ? `?${q}` : ''}`);
}

export async function fetchOpsSessions(): Promise<{ sessions: OpsSession[]; count: number }> {
  return get('/api/viewer/ops/sessions');
}

export async function fetchOpsEvents(limit = 50): Promise<{ events: TimelineEvent[]; count: number }> {
  return get(`/api/viewer/ops/events/recent?limit=${limit}`);
}

export async function fetchArchives(limit = 100): Promise<{ archives: ArchiveSummary[]; count: number }> {
  return get(`/api/viewer/archives?limit=${limit}`);
}

export async function fetchSessionSnapshot(sessionId: string, password?: string, permissionCode?: string): Promise<unknown> {
  const params = new URLSearchParams();
  if (password) params.set('password', password);
  if (permissionCode) params.set('permissionCode', permissionCode);
  const q = params.toString();
  return get(`/api/viewer/sessions/${encodeURIComponent(sessionId)}${q ? `?${q}` : ''}`);
}

export async function patchSessionAccess(sessionId: string, patch: Partial<SessionAccessRecord>, token?: string): Promise<SessionAccessRecord> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`/api/viewer/session-access/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function executeSessionAction(
  sessionId: string,
  payload: {
    action: StrategyActionName;
    lap?: number;
    timestamp?: number;
    authorLabel?: string;
    severity?: string;
  },
  password?: string,
  permissionCode?: string
): Promise<{ action: SessionActionResult }> {
  const params = new URLSearchParams();
  if (password) params.set('password', password);
  if (permissionCode) params.set('permissionCode', permissionCode);
  const q = params.toString();
  const res = await fetch(`/api/viewer/actions/${encodeURIComponent(sessionId)}${q ? `?${q}` : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const accessError = (data as { accessError?: { message?: string } }).accessError;
    throw new Error(accessError?.message || (data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}
