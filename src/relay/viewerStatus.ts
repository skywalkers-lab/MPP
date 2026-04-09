// Viewer status 및 세션 직렬화 유틸

import { RelaySession } from './RelayServer.js';
import { CurrentRaceState } from '../model/CurrentRaceState.js';

export type ViewerStatus = 'not_found' | 'waiting' | 'live' | 'stale' | 'ended';

export interface ViewerSessionPayload {
  sessionId: string;
  viewerStatus: ViewerStatus;
  relayStatus: RelaySession['status'];
  hasSnapshot: boolean;
  updatedAt: number;
  lastHeartbeatAt: number | null;
  latestSequence: number | null;
  snapshot: CurrentRaceState | null;
}

export function getViewerStatus(session: RelaySession | undefined): ViewerStatus {
  if (!session) return 'not_found';
  if (!session.latestState) return 'waiting';
  if (session.status === 'active') return 'live';
  if (session.status === 'stale') return 'stale';
  if (session.status === 'closed') return 'ended';
  return 'not_found';
}

export function serializeViewerSession(session: RelaySession | undefined): ViewerSessionPayload {
  if (!session) {
    return {
      sessionId: '',
      viewerStatus: 'not_found',
      relayStatus: 'closed',
      hasSnapshot: false,
      updatedAt: 0,
      lastHeartbeatAt: null,
      latestSequence: null,
      snapshot: null,
    };
  }
  const hasSnapshot = !!session.latestState;
  return {
    sessionId: session.sessionId,
    viewerStatus: getViewerStatus(session),
    relayStatus: session.status,
    hasSnapshot,
    updatedAt: session.updatedAt,
    lastHeartbeatAt: session.lastHeartbeatAt ?? null,
    latestSequence: session.latestSequence ?? null,
    snapshot: hasSnapshot ? session.latestState : null,
  };
}
