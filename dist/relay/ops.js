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
    const viewerStatus = getViewerStatus(session);
    const hasSnapshot = !!session.latestState;
    const shareEnabled = access?.shareEnabled === true;
    const visibility = access?.visibility ?? 'unknown';
    const joinCode = access?.joinCode ?? null;
    const hasViewerAccess = shareEnabled && access?.visibility === 'code';
    return {
        sessionId: session.sessionId,
        relayStatus: session.status,
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
