export type StrategySeverity = 'info' | 'caution' | 'warning' | 'critical';

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

export interface StrategyEngineInput {
  sessionId: string;
  relayStatus: 'active' | 'stale' | 'closed';
  isStale: boolean;
  hasSnapshot: boolean;
  latestSequence: number | null;
  currentLap: number | null;
  totalLaps: number | null;
  position: number | null;
  tyreAgeLaps: number | null;
  fuelRemaining: number | null;
  fuelLapsRemaining: number | null;
  pitStatus: string | null;
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
}

export interface StrategyRecommendationResult {
  strategyUnavailable: false;
  recommendation: StrategyRecommendationLabel;
  severity: StrategySeverity;
  reasons: string[];
  signals: StrategySignals;
  generatedAt: number;
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
