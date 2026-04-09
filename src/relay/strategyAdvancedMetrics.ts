import { RivalCarSnapshot, StrategyEngineInput, StrategyScoreBand } from './strategy.js';

export interface StrategyAdvancedScores {
  undercutScore: number | null;
  overcutScore: number | null;
  trafficRiskScore: number | null;
  degradationTrend: number | null;
  pitLossHeuristic: number | null;
  compoundStintBias: number | null;
  expectedRejoinBand: StrategyScoreBand;
  cleanAirProbability: number | null;
  undercutProbability: number | null;
  overcutProbability: number | null;
  ersEndLapPct: number | null;
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

export function pitLossHeuristic(input: {
  position: number | null;
  trafficRiskScore: number | null;
  currentLap: number | null;
  totalLaps: number | null;
  pitWindowHint: 'open_now' | 'open_soon' | 'monitor' | 'too_early' | 'unknown';
}): number | null {
  if (input.position == null || !Number.isFinite(input.position)) return null;

  let score = 35;

  if (input.position >= 8 && input.position <= 14) score += 10;
  if (input.position > 14) score += 14;

  if (input.trafficRiskScore != null) {
    score += input.trafficRiskScore * 0.35;
  }

  if (input.pitWindowHint === 'too_early') score += 18;
  if (input.pitWindowHint === 'open_now') score -= 12;

  if (
    input.currentLap != null &&
    input.totalLaps != null &&
    input.totalLaps > 0
  ) {
    const progress = input.currentLap / input.totalLaps;
    if (progress > 0.8) score -= 12;
    if (progress < 0.25) score += 10;
  }

  return clampScore(score);
}

export function compoundStintBias(input: {
  tyreCompound: string | null;
  tyreUrgencyScore: number | null;
  stintProgress: number | null;
}): number | null {
  if (!input.tyreCompound) return null;

  const compound = input.tyreCompound.toLowerCase();
  let score = 50;

  if (compound.includes('hard') || compound === 'h') score += 14;
  if (compound.includes('medium') || compound === 'm') score += 5;
  if (compound.includes('soft') || compound === 's') score -= 10;

  if (input.tyreUrgencyScore != null) {
    score += Math.max(-20, Math.min(20, 65 - input.tyreUrgencyScore));
  }

  if (input.stintProgress != null) {
    if (input.stintProgress < 0.35) score += 10;
    if (input.stintProgress > 0.8) score -= 12;
  }

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

  score += Math.max(0, 60 - tyre) * 0.35;
  score += Math.max(0, 65 - deg) * 0.25;

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

export function undercutSuccessProbability(input: {
  playerTyreAge: number | null;
  playerCompound: string | null;
  playerPosition: number | null;
  rivals: RivalCarSnapshot[];
  pitWindowHint: 'open_now' | 'open_soon' | 'monitor' | 'too_early' | 'unknown';
}): number | null {
  if (input.playerPosition == null || input.playerTyreAge == null) return null;

  let probability = 0.5;

  if (input.pitWindowHint === 'open_now') probability += 0.15;
  else if (input.pitWindowHint === 'open_soon') probability += 0.08;
  else if (input.pitWindowHint === 'too_early') probability -= 0.15;

  const nearRivals = input.rivals.filter(r => r.position != null && Math.abs(r.position - (input.playerPosition ?? 99)) <= 3);
  for (const rival of nearRivals) {
    const agedRival = rival.stintAge > 20;
    const softCompound = rival.tyreCompound.toLowerCase().startsWith('s');
    const medCompound = rival.tyreCompound.toLowerCase().startsWith('m');

    if (agedRival && !softCompound) probability += 0.08;
    else if (agedRival && medCompound) probability += 0.04;
    else if (!agedRival && softCompound) probability -= 0.06;
  }

  const compound = (input.playerCompound || '').toLowerCase();
  if (compound.startsWith('s')) probability += 0.05;
  else if (compound.startsWith('h')) probability -= 0.03;

  return Math.max(0, Math.min(1, probability));
}

export function overcutSuccessProbability(input: {
  playerTyreAge: number | null;
  playerCompound: string | null;
  playerPosition: number | null;
  rivals: RivalCarSnapshot[];
  pitWindowHint: 'open_now' | 'open_soon' | 'monitor' | 'too_early' | 'unknown';
  trafficRiskScore: number | null;
}): number | null {
  if (input.playerPosition == null) return null;

  let probability = 0.45;

  if (input.pitWindowHint === 'too_early') probability += 0.12;
  else if (input.pitWindowHint === 'open_now') probability -= 0.12;

  if (input.trafficRiskScore != null) {
    probability += (input.trafficRiskScore / 100) * 0.2;
  }

  const nearRivals = input.rivals.filter(r => r.position != null && Math.abs(r.position - (input.playerPosition ?? 99)) <= 2);
  for (const rival of nearRivals) {
    const agedRival = rival.stintAge > 18;
    if (agedRival) probability -= 0.05;
    else probability += 0.04;
  }

  const compound = (input.playerCompound || '').toLowerCase();
  if (compound.startsWith('h')) probability += 0.08;
  else if (compound.startsWith('s')) probability -= 0.06;

  return Math.max(0, Math.min(1, probability));
}

export function ersEndLapPrediction(input: {
  currentErsPercent: number | null;
  deploymentPattern: 'aggressive' | 'normal' | 'harvest' | null;
  lapsRemaining: number | null;
}): number | null {
  if (input.currentErsPercent == null) return null;

  let deployPerLap = 1.5;
  if (input.deploymentPattern === 'aggressive') deployPerLap = 3.0;
  else if (input.deploymentPattern === 'harvest') deployPerLap = -1.0;
  else if (input.deploymentPattern === 'normal') deployPerLap = 1.5;

  const regenPerLap = 0.8;
  const netChangePerLap = deployPerLap - regenPerLap;
  const laps = input.lapsRemaining != null && input.lapsRemaining > 0 ? Math.min(input.lapsRemaining, 1) : 1;

  const predicted = input.currentErsPercent - netChangePerLap * laps;
  return Math.max(0, Math.min(100, predicted));
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
  const pitLoss = pitLossHeuristic({
    position: input.base.position,
    trafficRiskScore: traffic,
    currentLap: input.base.currentLap,
    totalLaps: input.base.totalLaps,
    pitWindowHint: input.pitWindowHint,
  });
  const bias = compoundStintBias({
    tyreCompound: input.base.tyreCompound,
    tyreUrgencyScore: input.tyreUrgencyScore,
    stintProgress: input.stintProgress,
  });
  const undercutScoreVal = undercutScore({
    tyreUrgencyScore: input.tyreUrgencyScore,
    stintProgress: input.stintProgress,
    pitWindowHint: input.pitWindowHint,
    trafficRiskScore: traffic,
    fuelRiskScore: input.fuelRiskScore,
  });
  const overcutScoreVal = overcutScore({
    tyreUrgencyScore: input.tyreUrgencyScore,
    degradationTrend: degradation,
    trafficRiskScore: traffic,
    fuelRiskScore: input.fuelRiskScore,
    pitWindowHint: input.pitWindowHint,
  });

  const rivals = input.base.rivals ?? [];

  const undercutProb = undercutSuccessProbability({
    playerTyreAge: input.base.tyreAgeLaps,
    playerCompound: input.base.tyreCompound,
    playerPosition: input.base.position,
    rivals,
    pitWindowHint: input.pitWindowHint,
  });

  const overcutProb = overcutSuccessProbability({
    playerTyreAge: input.base.tyreAgeLaps,
    playerCompound: input.base.tyreCompound,
    playerPosition: input.base.position,
    rivals,
    pitWindowHint: input.pitWindowHint,
    trafficRiskScore: traffic,
  });

  const deploymentPattern: 'aggressive' | 'normal' | 'harvest' = (() => {
    const speed = undercutScoreVal ?? 50;
    if (speed >= 75) return 'aggressive';
    if (overcutScoreVal != null && overcutScoreVal >= 70) return 'harvest';
    return 'normal';
  })();

  const ersEndLap = ersEndLapPrediction({
    currentErsPercent: input.base.ersPercent ?? null,
    deploymentPattern,
    lapsRemaining: input.base.totalLaps != null && input.base.currentLap != null
      ? input.base.totalLaps - input.base.currentLap
      : null,
  });

  return {
    undercutScore: undercutScoreVal,
    overcutScore: overcutScoreVal,
    trafficRiskScore: traffic,
    degradationTrend: degradation,
    pitLossHeuristic: pitLoss,
    compoundStintBias: bias,
    expectedRejoinBand: expectedRejoinBand(traffic),
    cleanAirProbability: cleanAirProbability(traffic),
    undercutProbability: undercutProb,
    overcutProbability: overcutProb,
    ersEndLapPct: ersEndLap,
  };
}
