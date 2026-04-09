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
