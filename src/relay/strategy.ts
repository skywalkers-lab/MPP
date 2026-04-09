export type StrategySeverity = 'info' | 'caution' | 'warning' | 'critical';
export type StrategyScoreBand = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

export type StrategyRecommendationLabel =
  | 'PIT NOW'
  | 'BOX IN 2 LAPS'
  | 'STAY OUT'
  | 'TRAFFIC RISK HIGH'
  | 'TYRE LIFE CRITICAL'
  | 'FUEL RISK HIGH';

export type StrategyUnavailableReason =
  | 'session_not_found'
  | 'no_snapshot'
  | 'session_stale'
  | 'player_state_missing';

export interface RivalCarSnapshot {
  carIndex: number;
  position: number | null;
  stintAge: number;
  tyreCompound: string;
  gapToLeader?: string | null;
}

export interface StrategyEngineInput {
  sessionId: string;
  relayStatus: 'active' | 'stale' | 'closed';
  isStale: boolean;
  syncingCanonicalSession?: boolean;
  syncingUntil?: number | null;
  hasSnapshot: boolean;
  latestSequence: number | null;
  currentLap: number | null;
  totalLaps: number | null;
  position: number | null;
  tyreAgeLaps: number | null;
  fuelRemaining: number | null;
  fuelLapsRemaining: number | null;
  pitStatus: string | null;
  tyreCompound: string | null;
  ersPercent: number | null;
  recentLapTimesMs: number[];
  rivals: RivalCarSnapshot[];
  previousStrategy?: {
    recommendation: StrategyRecommendationLabel;
    secondaryRecommendation?: StrategyRecommendationLabel;
    severity?: StrategySeverity;
    confidenceScore?: number | null;
    stabilityScore?: number | null;
    signals?: Partial<StrategySignals>;
    generatedAt?: number;
  } | null;
  generatedAt: number;
}

export interface StrategySignals {
  currentLap: number | null;
  totalLaps: number | null;
  lapsRemaining: number | null;
  tyreAgeLaps: number | null;
  fuelRemaining: number | null;
  fuelLapsRemaining: number | null;
  position: number | null;
  latestSequence: number | null;
  tyreUrgencyScore: number | null;
  fuelRiskScore: number | null;
  stintProgress: number | null;
  pitWindowHint: 'open_now' | 'open_soon' | 'monitor' | 'too_early' | 'unknown';
  rejoinRiskHint: 'low' | 'medium' | 'high' | 'unknown';

  // v2 comparative strategy layer
  undercutScore: number | null;
  overcutScore: number | null;
  trafficRiskScore: number | null;
  degradationTrend: number | null;
  pitLossHeuristic: number | null;
  compoundStintBias: number | null;
  expectedRejoinBand: StrategyScoreBand;
  cleanAirProbability: number | null;

  // v3 Monte Carlo / advanced metrics
  undercutProbability: number | null;
  overcutProbability: number | null;
  ersEndLapPct: number | null;
}

export interface StrategySimulationMeta {
  optimalPitLap: number;
  confidenceInterval: [number, number];
  iterations: number;
  converged: boolean;
  meanGainSeconds: number;
  stdDevGainSeconds: number;
}

export interface StrategyRecommendationResult {
  strategyUnavailable: false;

  // v1 compatibility field
  recommendation: StrategyRecommendationLabel;

  // v2 comparison-friendly fields
  primaryRecommendation: StrategyRecommendationLabel;
  secondaryRecommendation?: StrategyRecommendationLabel;

  severity: StrategySeverity;
  confidenceScore: number | null;
  stabilityScore: number | null;
  recommendationChanged: boolean;
  trendReason: string | null;
  syncingCanonicalSession: boolean;
  syncingUntil: number | null;
  reasons: string[];
  signals: StrategySignals;
  generatedAt: number;

  // v3 Monte Carlo simulation metadata
  simulationMeta?: StrategySimulationMeta;
}

export interface StrategyUnavailableResult {
  strategyUnavailable: true;
  reason: StrategyUnavailableReason;
  reasons: string[];
  signals: Partial<StrategySignals>;
  generatedAt: number;
}

export type StrategyEvaluationResult =
  | StrategyRecommendationResult
  | StrategyUnavailableResult;

// ─────────────────────────────────────────────────────────────────────────────
// Qualifying Strategy Types
// ─────────────────────────────────────────────────────────────────────────────

export type QualiSessionType = 'Q1' | 'Q2' | 'Q3';
export type QualiOutlapRecommendation = 'GO_NOW' | 'WAIT' | 'PREPARE';
export type TrafficDensity = 'LOW' | 'MEDIUM' | 'HIGH';
export type DriverLapStatus = 'IN_LAP' | 'OUT_LAP' | 'FLYING_LAP' | 'IN_GARAGE';
export type CarPitStatus = 'ON_TRACK' | 'IN_PIT' | 'PIT_ENTRY' | 'PIT_EXIT';

export interface TrackZone {
  start: number; // 0-1 position on track
  end: number;   // 0-1 position on track
  density: number; // number of cars in zone
}

export interface CarTrackPosition {
  carIndex: number;
  driverName: string;
  lapDistance: number; // 0-1 (track progress)
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
  reasonCode: 'TIME_CRITICAL' | 'CLEAR_TRACK' | 'CARS_EXITING_PIT' | 'TRAFFIC_CLEARING' | 'MONITORING' | 'SESSION_END';
  confidence: number; // 0-1
}

export interface QualiSessionContext {
  sessionType: QualiSessionType;
  timeRemaining: number; // seconds
  estimatedLapsRemaining: number;
  cutoffPosition: number; // Q1: 15, Q2: 10, Q3: N/A
  currentPosition: number;
  gapToCutoff: number | null; // seconds (null if in safe zone or Q3)
  isInDanger: boolean;
  isInEliminationZone: boolean;
  playerBestLapTime: number | null;
  cutoffLapTime: number | null;
}

export interface QualiStrategyRecommendation {
  sessionType: QualiSessionType;
  trafficPrediction: QualiTrafficPrediction;
  outlapTiming: QualiOutlapTiming;
  sessionContext: QualiSessionContext;
  carPositions: CarTrackPosition[];
  generatedAt: number;
}

export interface QualiStrategyUnavailable {
  strategyUnavailable: true;
  reason: 'not_qualifying' | 'no_snapshot' | 'session_stale' | 'player_state_missing';
  generatedAt: number;
}

export type QualiStrategyResult = QualiStrategyRecommendation | QualiStrategyUnavailable;
