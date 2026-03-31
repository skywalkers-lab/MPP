// Viewer status 및 세션 직렬화 유틸
export function getViewerStatus(session) {
    if (!session)
        return 'not_found';
    if (!session.latestState)
        return 'waiting';
    if (session.status === 'active')
        return 'live';
    if (session.status === 'stale')
        return 'stale';
    if (session.status === 'closed')
        return 'ended';
    return 'not_found';
}
export function serializeViewerSession(session) {
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
