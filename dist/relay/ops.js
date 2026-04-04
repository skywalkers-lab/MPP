import { getViewerStatus } from './viewerStatus';
export class InMemoryRecentOpsEvents {
    constructor(maxSize = 200) {
        this.maxSize = maxSize;
        this.events = [];
    }
    notify(event) {
        this.events.push(event);
        if (this.events.length > this.maxSize) {
            this.events.splice(0, this.events.length - this.maxSize);
        }
    }
    getRecent(limit = 50) {
        const size = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 50;
        return this.events.slice(-size).reverse();
    }
}
export class ConsoleOpsNotifier {
    notify(event) {
        // Keep log payload compact for operational visibility.
        console.log(`[OpsEvent] ${event.type} session=${event.sessionId} ts=${event.timestamp}`);
    }
}
export class CompositeOpsNotifier {
    constructor(notifiers) {
        this.notifiers = notifiers;
    }
    notify(event) {
        for (const notifier of this.notifiers) {
            try {
                notifier.notify(event);
            }
            catch (err) {
                // Log error but continue with next notifier
                console.error(`[OpsNotifier] Error in notifier:`, err);
            }
        }
    }
}
export function getViewerAccessLabel(access) {
    if (!access || !access.joinCode)
        return 'no_join_code';
    if (access.visibility === 'private')
        return 'private';
    if (!access.shareEnabled)
        return 'not_shared';
    if (access.visibility === 'code')
        return 'shared';
    return 'code_required';
}
export function serializeSessionOpsSummary(session, access) {
    const now = Date.now();
    const viewerStatus = getViewerStatus(session);
    const hasSnapshot = !!session.latestState;
    const shareEnabled = access?.shareEnabled === true;
    const visibility = access?.visibility ?? 'unknown';
    const joinCode = access?.joinCode ?? null;
    const hasViewerAccess = shareEnabled && access?.visibility === 'code';
    const heartbeatAgeMs = Math.max(0, now - (session.lastHeartbeatAt || now));
    const relayFreshnessMs = Math.max(0, now - session.updatedAt);
    const snapshotFreshnessMs = hasSnapshot ? relayFreshnessMs : -1;
    const healthLevel = deriveSessionHealthLevel(session.status, heartbeatAgeMs, hasSnapshot);
    return {
        sessionId: session.sessionId,
        roomTitle: access?.roomTitle || `Room ${joinCode ?? session.sessionId.slice(0, 6)}`,
        passwordEnabled: !!access?.roomPassword,
        driverLabel: access?.driverLabel ?? null,
        carLabel: access?.carLabel ?? null,
        relayStatus: session.status,
        healthLevel,
        heartbeatAgeMs,
        relayFreshnessMs,
        snapshotFreshnessMs,
        viewerStatus,
        shareEnabled,
        visibility,
        hasViewerAccess,
        viewerAccessLabel: getViewerAccessLabel(access),
        joinCode,
        updatedAt: session.updatedAt,
        lastHeartbeatAt: session.lastHeartbeatAt ?? null,
        latestSequence: session.latestSequence ?? null,
        hasSnapshot,
    };
}
export function deriveSessionHealthLevel(relayStatus, heartbeatAgeMs, hasSnapshot) {
    if (relayStatus !== 'active')
        return 'stale';
    if (!hasSnapshot)
        return 'connecting';
    if (heartbeatAgeMs < 3000)
        return 'healthy';
    if (heartbeatAgeMs < 6000)
        return 'delayed';
    if (heartbeatAgeMs < 10000)
        return 'stale_risk';
    return 'stale';
}
