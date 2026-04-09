export type StrategySeverity = 'info' | 'caution' | 'warning' | 'critical';
export type StrategyScoreBand = 'low' | 'medium' | 'high' | 'critical' | 'unknown';
export type StrategySessionMode = 'race' | 'qualifying';
export type QualifyingSessionPhase = 'Q1' | 'Q2' | 'Q3' | 'QUALI';
export type QualifyingReleaseWindow = 'release_now' | 'wait_short' | 'wait_for_gap' | 'queue_reset';

export type StrategyRecommendationLabel =
  | 'PIT NOW'
  | 'BOX IN 2 LAPS'
  | 'STAY OUT'
  | 'TRAFFIC RISK HIGH'
  | 'TYRE LIFE CRITICAL'
  | 'FUEL RISK HIGH'
  | 'RELEASE NOW'
  | 'HOLD GAP'
  | 'BUILD TYRES'
  | 'TRAFFIC CLUSTER AHEAD';

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
  lapDistance?: number | null;
  pitStatus?: string | number | null;
  driverStatus?: string | number | null;
  isPlayer?: boolean;
}

export interface QualifyingTrafficBand {
  key: string;
  label: string;
  startPct: number;
  endPct: number;
  carCount: number;
  density: number;
}

export interface TrackMapCarSnapshot {
  carIndex: number;
  position: number | null;
  lapDistance: number | null;
  progressPct: number | null;
  pitStatus: string | null;
  driverStatus: string | null;
  tyreCompound?: string | null;
  isPlayer: boolean;
}

export interface QualifyingStrategyInsight {
  active: true;
  sessionPhase: QualifyingSessionPhase;
  releaseWindow: QualifyingReleaseWindow;
  releaseLabel: string;
  trafficSummary: string;
  outLapSummary: string;
  trafficScore: number | null;
  clearLapProbability: number | null;
  recommendedReleaseInSec: number | null;
  predictedCarsOnOutLap: number;
  predictedGapAheadMeters: number | null;
  predictedGapBehindMeters: number | null;
  rationale: string[];
  trafficBands: QualifyingTrafficBand[];
  trackMapCars: TrackMapCarSnapshot[];
}

export interface StrategyEngineInput {
  sessionId: string;
  relayStatus: 'active' | 'stale' | 'closed';
  isStale: boolean;
  syncingCanonicalSession?: boolean;
  syncingUntil?: number | null;
  hasSnapshot: boolean;
  latestSequence: number | null;
  sessionType?: string | number | null;
  sessionTimeLeft?: number | null;
  trackLength?: number | null;
  playerCarIndex?: number | null;
  currentLap: number | null;
  totalLaps: number | null;
  position: number | null;
  tyreAgeLaps: number | null;
  fuelRemaining: number | null;
  fuelLapsRemaining: number | null;
  pitStatus: string | number | null;
  tyreCompound: string | null;
  ersPercent: number | null;
  recentLapTimesMs: number[];
  rivals: RivalCarSnapshot[];
  trafficCars?: RivalCarSnapshot[];
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
  sessionMode: StrategySessionMode;
  sessionPhase: QualifyingSessionPhase | 'RACE';
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
  outLapTrafficScore: number | null;
  optimalReleaseInSec: number | null;
  clearLapProbability: number | null;
  trackDensityScore: number | null;
  predictedGapAheadMeters: number | null;
  predictedGapBehindMeters: number | null;

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
  sessionMode: StrategySessionMode;

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
  qualifying?: QualifyingStrategyInsight;
}

export interface StrategyUnavailableResult {
  strategyUnavailable: true;
  sessionMode?: StrategySessionMode;
  reason: StrategyUnavailableReason;
  reasons: string[];
  signals: Partial<StrategySignals>;
  generatedAt: number;
}

export type StrategyEvaluationResult =
  | StrategyRecommendationResult
  | StrategyUnavailableResult;
