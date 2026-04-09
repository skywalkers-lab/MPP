export type HealthLevel = 'healthy' | 'delayed' | 'stale_risk' | 'stale' | 'connecting';
export type RelayStatus = 'active' | 'closed' | 'idle';

export interface Room {
  sessionId: string;
  joinCode: string;
  roomTitle: string;
  relayStatus: RelayStatus;
  healthLevel: HealthLevel;
  driverLabel: string | null;
  carLabel: string | null;
  passwordEnabled: boolean;
  shareEnabled: boolean;
  visibility: 'private' | 'code';
  viewerAccessLabel?: string;
  updatedAt: number;
}

export interface RelayInfo {
  relayLabel: string;
  viewerBaseUrl: string;
  relayNamespace: string;
  wsPort?: number;
  viewerPort?: number;
  publicUrlWarning?: boolean;
}

export interface DiagnosticsData {
  ok: boolean;
  checkedAt: number;
  publicDir: string;
  relay: {
    wsPort: number;
    viewerPort: number;
    label: string;
    viewerBaseUrl: string;
    relayWsUrl: string;
  };
  embeddedAgent: {
    enabled: boolean;
    started: boolean;
    udpPort: number;
    udpAddress: string;
    udpBindSucceeded: boolean;
    udpBindAttempted: boolean;
    udpBindError: string | null;
    recentPackets10s: number;
    lastPacketAt: number | null;
    lastValidPacketId: number | null;
    lastSessionUID: string | null;
    lastParseSuccessAt: number | null;
    parseFailureCount: number;
  };
}

export interface StrategyData {
  strategyUnavailable?: boolean;
  reason?: string;
  primaryCall?: string;
  secondaryCall?: string;
  confidence?: number;
  stability?: string;
  pitWindowEta?: number | null;
  metrics?: {
    trafficExposure?: number;
    tyreFuelStress?: number;
    executionReadiness?: number;
    cleanAirProbability?: number;
    undercutScore?: number;
    overcutScore?: number;
    tyreUrgency?: number;
    fuelRisk?: number;
  };
}

export interface SessionNote {
  id: string;
  text: string;
  category?: string;
  authorLabel?: string;
  severity?: string;
  lap?: number;
  timestamp?: number;
  tag?: string;
  createdAt: number;
}

export interface TimelineEvent {
  eventId: string;
  type: string;
  sessionId?: string;
  lap?: number;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface SessionSnapshot {
  lap?: number;
  totalLaps?: number;
  position?: number;
  compound?: string;
  tyreAge?: number;
  fuelLaps?: number;
  fuelKg?: number;
  ersPercent?: number;
  lastLapMs?: number;
  bestLapMs?: number;
  speed?: number;
  gear?: number;
  throttle?: number;
  brake?: number;
  track?: string;
  sessionType?: string;
  weather?: string;
  safetyCarStatus?: number;
  wingDamageFront?: number;
  wingDamageRear?: number;
}

export interface SessionAccessRecord {
  sessionId: string;
  joinCode: string;
  roomTitle: string;
  driverLabel: string | null;
  carLabel: string | null;
  shareEnabled: boolean;
  visibility: 'private' | 'code';
  roomPassword?: string;
  permissionCode?: string;
  viewerAccessLabel?: string;
}

export interface SessionHealthData {
  sessionId: string;
  healthLevel: HealthLevel;
  relayStatus: RelayStatus;
  metrics: {
    heartbeatAgeMs: number | null;
    snapshotFreshnessMs: number | null;
    relayFreshnessMs: number | null;
  };
}

export interface OpsSession {
  sessionId: string;
  joinCode: string;
  roomTitle: string;
  relayStatus: RelayStatus;
  healthLevel: HealthLevel;
  driverLabel: string | null;
  carLabel: string | null;
  shareEnabled: boolean;
  visibility: string;
  viewerAccessLabel?: string;
  passwordEnabled: boolean;
  updatedAt: number;
  agentConnected?: boolean;
}

export interface ArchiveSummary {
  sessionId: string;
  joinCode?: string;
  roomTitle?: string;
  driverLabel?: string;
  carLabel?: string;
  archivedAt: number;
  durationMs?: number;
  totalLaps?: number;
  track?: string;
  sessionType?: string;
}
