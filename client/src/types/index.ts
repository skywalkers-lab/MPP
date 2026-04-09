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

export interface StrategySimulationMeta {
  iterations: number;
  converged: boolean;
  optimalPitLap?: number;
  confidenceInterval?: [number, number];
  meanGainSeconds?: number;
  stdDevGainSeconds?: number;
}

export interface StrategySignalsData {
  pitWindowHint?: 'open_now' | 'open_soon' | 'monitor' | 'too_early' | 'unknown';
  expectedRejoinBand?: string;
  undercutScore?: number;
  overcutScore?: number;
  cleanAirProbability?: number;
  trafficRiskScore?: number;
  undercutProbability?: number;
  overcutProbability?: number;
  ersEndLapPct?: number | null;
  tyreUrgencyScore?: number;
  fuelRiskScore?: number;
}

export interface StrategyData {
  strategyUnavailable?: boolean;
  reason?: string;
  recommendation?: string;
  primaryRecommendation?: string;
  secondaryRecommendation?: string;
  primaryCall?: string;
  secondaryCall?: string;
  confidenceScore?: number;
  confidence?: number;
  stabilityScore?: number | null;
  stability?: string;
  pitWindowEta?: number | null;
  simulationMeta?: StrategySimulationMeta;
  signals?: StrategySignalsData;
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

export interface CarSnapshot {
  carIndex: number;
  position?: number | null;
  currentLapNum?: number | null;
  lastLapTime?: number | null;
  bestLapTime?: number | null;
  gapToLeader?: number | string | null;
  gapToFront?: number | string | null;
  pitStatus?: string | null;
  tyreCompound?: string | null;
  tyreAgeLaps?: number | null;
  fuelRemaining?: number | null;
  fuelLapsRemaining?: number | null;
  ersLevel?: number | null;
  tyreWear?: number[] | null;
  tyreTemp?: number[] | null;
  damage?: {
    frontWingLeft?: number | null;
    frontWingRight?: number | null;
    rearWing?: number | null;
    floor?: number | null;
    sidepod?: number | null;
    engine?: number | null;
    gearbox?: number | null;
  } | null;
}

export interface DriverSnapshot {
  carIndex: number;
  driverName: string;
  teamId?: number;
  teamName?: string;
  nationality?: string;
  aiControlled?: boolean;
  raceNumber?: number;
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
  playerCarIndex?: number;
  fuelLapsRemaining?: number;
  cars?: Record<number, CarSnapshot>;
  drivers?: Record<number, DriverSnapshot>;
  tyreTemps?: number[];
  tyreSurfaceTemp?: number[];
  tyreWear?: number[];
  tyreCarcassDamage?: number[];
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

// ─────────────────────────────────────────────────────────────────────────────
// Qualifying Strategy Types
// ─────────────────────────────────────────────────────────────────────────────

export type QualiSessionType = 'Q1' | 'Q2' | 'Q3';
export type QualiOutlapRecommendation = 'GO_NOW' | 'WAIT' | 'PREPARE';
export type TrafficDensity = 'LOW' | 'MEDIUM' | 'HIGH';
export type DriverLapStatus = 'IN_LAP' | 'OUT_LAP' | 'FLYING_LAP' | 'IN_GARAGE';
export type CarPitStatus = 'ON_TRACK' | 'IN_PIT' | 'PIT_ENTRY' | 'PIT_EXIT';

export interface TrackZone {
  start: number;
  end: number;
  density: number;
}

export interface CarTrackPosition {
  carIndex: number;
  driverName: string;
  lapDistance: number;
  pitStatus: CarPitStatus;
  driverStatus: DriverLapStatus;
  isPlayer: boolean;
  currentLapTime?: number | null;
  bestLapTime?: number | null;
}

export interface QualiTrafficPrediction {
  clearWindowSeconds: number;
  carsOnTrack: number;
  carsInPit: number;
  carsOnFlyingLap: number;
  carsOnOutLap: number;
  predictedTrafficDensity: TrafficDensity;
  hotZones: TrackZone[];
}

export interface QualiOutlapTiming {
  recommendation: QualiOutlapRecommendation;
  waitSeconds?: number;
  reason: string;
  reasonCode: string;
  confidence: number;
}

export interface QualiSessionContext {
  sessionType: QualiSessionType;
  timeRemaining: number;
  estimatedLapsRemaining: number;
  cutoffPosition: number;
  currentPosition: number;
  gapToCutoff: number | null;
  isInDanger: boolean;
  isInEliminationZone: boolean;
  playerBestLapTime: number | null;
  cutoffLapTime: number | null;
}

export interface QualiStrategyData {
  strategyUnavailable?: boolean;
  reason?: string;
  sessionType?: QualiSessionType;
  trafficPrediction?: QualiTrafficPrediction;
  outlapTiming?: QualiOutlapTiming;
  sessionContext?: QualiSessionContext;
  carPositions?: CarTrackPosition[];
  generatedAt?: number;
}
