import { getViewerStatus, serializeViewerSession, ViewerSessionPayload } from '../src/relay/viewerStatus';
import { RelaySession } from '../src/relay/RelayServer';

describe('ViewerStatus 판정', () => {
  const baseSession: Partial<RelaySession> = {
    sessionId: 'abc',
    updatedAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    latestSequence: 1,
    status: 'active',
    latestState: { playerCarIndex: 0 } as any,
  };

  it('세션 없음 → not_found', () => {
    expect(getViewerStatus(undefined)).toBe('not_found');
    const payload = serializeViewerSession(undefined);
    expect(payload.viewerStatus).toBe('not_found');
    expect(payload.snapshot).toBeNull();
  });

  it('세션 있으나 snapshot 없음 → waiting', () => {
    const session = { ...baseSession, latestState: undefined } as RelaySession;
    expect(getViewerStatus(session)).toBe('waiting');
    const payload = serializeViewerSession(session);
    expect(payload.viewerStatus).toBe('waiting');
    expect(payload.snapshot).toBeNull();
  });

  it('active+snapshot → live', () => {
    const session = { ...baseSession, status: 'active', latestState: { playerCarIndex: 1 } as any } as RelaySession;
    expect(getViewerStatus(session)).toBe('live');
    const payload = serializeViewerSession(session);
    expect(payload.viewerStatus).toBe('live');
    expect(payload.snapshot).not.toBeNull();
  });

  it('stale → stale', () => {
    const session = { ...baseSession, status: 'stale', latestState: { playerCarIndex: 2 } as any } as RelaySession;
    expect(getViewerStatus(session)).toBe('stale');
    const payload = serializeViewerSession(session);
    expect(payload.viewerStatus).toBe('stale');
  });

  it('closed → ended', () => {
    const session = { ...baseSession, status: 'closed', latestState: { playerCarIndex: 3 } as any } as RelaySession;
    expect(getViewerStatus(session)).toBe('ended');
    const payload = serializeViewerSession(session);
    expect(payload.viewerStatus).toBe('ended');
  });
});
