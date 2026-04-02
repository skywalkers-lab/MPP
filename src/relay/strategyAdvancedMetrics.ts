import { StrategyEngineInput, StrategyScoreBand } from './strategy';

export interface StrategyAdvancedScores {
  undercutScore: number | null;
  overcutScore: number | null;
  trafficRiskScore: number | null;
  degradationTrend: number | null;
  expectedRejoinBand: StrategyScoreBand;
  cleanAirProbability: number | null;
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function scoreBand(score: number | null): StrategyScoreBand {
  if (score == null || !Number.isFinite(score)) return 'unknown';
  if (score >= 85) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export function trafficRiskScore(
  position: number | null,
  rejoinRiskHint: 'low' | 'medium' | 'high' | 'unknown'
): number | null {
  if (rejoinRiskHint === 'unknown' || position == null) return null;

  let base = 35;
  if (rejoinRiskHint === 'medium') base = 55;
  if (rejoinRiskHint === 'high') base = 78;

  // Mid-pack and back-pack are more likely to rejoin into clusters.
  if (position >= 8 && position <= 14) base += 8;
  if (position > 14) base += 12;

  return clampScore(base);
}

export function degradationTrend(
  tyreUrgencyScore: number | null,
  stintProgress: number | null
): number | null {
  if (tyreUrgencyScore == null) return null;

  const stintFactor = stintProgress == null ? 0.5 : stintProgress;
  const score = tyreUrgencyScore * 0.7 + stintFactor * 30;
  return clampScore(score);
}

export function undercutScore(input: {
  tyreUrgencyScore: number | null;
  stintProgress: number | null;
  pitWindowHint: 'open_now' | 'open_soon' | 'monitor' | 'too_early' | 'unknown';
  trafficRiskScore: number | null;
  fuelRiskScore: number | null;
}): number | null {
  if (input.tyreUrgencyScore == null) return null;

  let score = input.tyreUrgencyScore * 0.55;
  score += (input.stintProgress ?? 0.5) * 20;

  if (input.pitWindowHint === 'open_now') score += 18;
  else if (input.pitWindowHint === 'open_soon') score += 10;
  else if (input.pitWindowHint === 'too_early') score -= 18;

  if (input.trafficRiskScore != null) {
    score -= input.trafficRiskScore * 0.25;
  }

  if (input.fuelRiskScore != null && input.fuelRiskScore >= 80) {
    // Extremely high fuel risk means pit strategy advantage is less meaningful.
    score -= 8;
  }

  return clampScore(score);
}

export function overcutScore(input: {
  tyreUrgencyScore: number | null;
  degradationTrend: number | null;
  trafficRiskScore: number | null;
  fuelRiskScore: number | null;
  pitWindowHint: 'open_now' | 'open_soon' | 'monitor' | 'too_early' | 'unknown';
}): number | null {
  const tyre = input.tyreUrgencyScore;
  const deg = input.degradationTrend;
  if (tyre == null || deg == null) return null;

  let score = 45;

  // Overcut is stronger when tyre/degradation is still manageable.
  score += Math.max(0, 60 - tyre) * 0.35;
  score += Math.max(0, 65 - deg) * 0.25;

  // If rejoin traffic is risky, staying out a bit can be beneficial.
  if (input.trafficRiskScore != null) {
    score += input.trafficRiskScore * 0.3;
  }

  if (input.pitWindowHint === 'open_now') score -= 12;
  if (input.pitWindowHint === 'too_early') score += 8;

  if (input.fuelRiskScore != null && input.fuelRiskScore >= 70) {
    score -= 20;
  }

  return clampScore(score);
}

export function cleanAirProbability(trafficRiskScore: number | null): number | null {
  if (trafficRiskScore == null) return null;
  return clampScore(100 - trafficRiskScore);
}

export function expectedRejoinBand(trafficRiskScore: number | null): StrategyScoreBand {
  return scoreBand(trafficRiskScore);
}

export function computeAdvancedStrategyScores(input: {
  base: StrategyEngineInput;
  tyreUrgencyScore: number | null;
  fuelRiskScore: number | null;
  stintProgress: number | null;
  pitWindowHint: 'open_now' | 'open_soon' | 'monitor' | 'too_early' | 'unknown';
  rejoinRiskHint: 'low' | 'medium' | 'high' | 'unknown';
}): StrategyAdvancedScores {
  const traffic = trafficRiskScore(input.base.position, input.rejoinRiskHint);
  const degradation = degradationTrend(input.tyreUrgencyScore, input.stintProgress);

  const undercut = undercutScore({
    tyreUrgencyScore: input.tyreUrgencyScore,
    stintProgress: input.stintProgress,
    pitWindowHint: input.pitWindowHint,
    trafficRiskScore: traffic,
    fuelRiskScore: input.fuelRiskScore,
  });

  const overcut = overcutScore({
    tyreUrgencyScore: input.tyreUrgencyScore,
    degradationTrend: degradation,
    trafficRiskScore: traffic,
    fuelRiskScore: input.fuelRiskScore,
    pitWindowHint: input.pitWindowHint,
  });

  return {
    undercutScore: undercut,
    overcutScore: overcut,
    trafficRiskScore: traffic,
    degradationTrend: degradation,
    expectedRejoinBand: expectedRejoinBand(traffic),
    cleanAirProbability: cleanAirProbability(traffic),
  };
}
