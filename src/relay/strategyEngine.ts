import {
  StrategyEngineInput,
  StrategyEvaluationResult,
  StrategyRecommendationResult,
  StrategyRecommendationLabel,
  StrategySignals,
  StrategySeverity,
} from './strategy';
import {
  fuelRiskScore,
  getLapsRemaining,
  pitWindowHint,
  rejoinRiskHint,
  stintProgress,
  tyreUrgencyScore,
} from './strategyMetrics';
import { computeAdvancedStrategyScores } from './strategyAdvancedMetrics';

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function recommendationScore(
  label: StrategyRecommendationLabel,
  signals: {
    tyreUrgency: number | null;
    fuelRisk: number | null;
    undercutScore: number | null;
    overcutScore: number | null;
    trafficRiskScore: number | null;
    degradationTrend: number | null;
    pitLossHeuristic: number | null;
    compoundStintBias: number | null;
  }
): number {
  const tyre = signals.tyreUrgency ?? 50;
  const fuel = signals.fuelRisk ?? 30;
  const undercut = signals.undercutScore ?? 50;
  const overcut = signals.overcutScore ?? 50;
  const traffic = signals.trafficRiskScore ?? 50;
  const degradation = signals.degradationTrend ?? 50;
  const pitLoss = signals.pitLossHeuristic ?? 50;
  const bias = signals.compoundStintBias ?? 50;

  switch (label) {
    case 'PIT NOW':
      return tyre * 0.35 + undercut * 0.25 + (100 - pitLoss) * 0.2 + (100 - fuel) * 0.2;
    case 'BOX IN 2 LAPS':
      return tyre * 0.3 + undercut * 0.2 + (100 - pitLoss) * 0.15 + overcut * 0.1 + (100 - traffic) * 0.25;
    case 'STAY OUT':
      return overcut * 0.28 + traffic * 0.2 + bias * 0.2 + (100 - tyre) * 0.17 + (100 - fuel) * 0.15;
    case 'TRAFFIC RISK HIGH':
      return traffic * 0.35 + overcut * 0.2 + bias * 0.1 + degradation * 0.15 + (100 - undercut) * 0.2;
    case 'TYRE LIFE CRITICAL':
      return tyre * 0.55 + degradation * 0.2 + (100 - pitLoss) * 0.15 + (100 - fuel) * 0.1;
    case 'FUEL RISK HIGH':
      return fuel * 0.65 + (100 - pitLoss) * 0.15 + tyre * 0.1 + degradation * 0.1;
    default:
      return 50;
  }
}

function computeConfidenceScore(scores: Record<StrategyRecommendationLabel, number>): number {
  const values = Object.values(scores).sort((a, b) => b - a);
  if (values.length < 2) return 50;
  const gap = values[0] - values[1];
  return clampScore(55 + gap * 1.2);
}

function nearestThresholdDistance(value: number | null, thresholds: number[]): number {
  if (value == null) return 100;
  let min = 100;
  for (const threshold of thresholds) {
    min = Math.min(min, Math.abs(value - threshold));
  }
  return min;
}

function computeStabilityScore(
  signals: StrategySignals,
  previousSignals?: Partial<StrategySignals>
): number {
  let score = 84;

  const distances = [
    nearestThresholdDistance(signals.tyreUrgencyScore, [70, 85, 95]),
    nearestThresholdDistance(signals.fuelRiskScore, [65, 85]),
    nearestThresholdDistance(signals.undercutScore, [70, 85]),
    nearestThresholdDistance(signals.overcutScore, [70]),
    nearestThresholdDistance(signals.pitLossHeuristic, [70, 82]),
  ];

  const boundaryDistance = Math.min(...distances);
  if (boundaryDistance < 4) score -= 32;
  else if (boundaryDistance < 8) score -= 18;
  else if (boundaryDistance < 14) score -= 10;

  if (previousSignals) {
    const tyreDelta = Math.abs((signals.tyreUrgencyScore ?? 0) - (previousSignals.tyreUrgencyScore ?? signals.tyreUrgencyScore ?? 0));
    const fuelDelta = Math.abs((signals.fuelRiskScore ?? 0) - (previousSignals.fuelRiskScore ?? signals.fuelRiskScore ?? 0));
    const trafficDelta = Math.abs((signals.trafficRiskScore ?? 0) - (previousSignals.trafficRiskScore ?? signals.trafficRiskScore ?? 0));
    const undercutDelta = Math.abs((signals.undercutScore ?? 0) - (previousSignals.undercutScore ?? signals.undercutScore ?? 0));

    const drift = tyreDelta + fuelDelta * 0.8 + trafficDelta * 0.5 + undercutDelta * 0.4;
    if (drift > 28) score -= 28;
    else if (drift > 16) score -= 14;
    else if (drift > 8) score -= 7;
  }

  return clampScore(score);
}

function buildTrendReason(
  changed: boolean,
  current: StrategySignals,
  previousSignals?: Partial<StrategySignals>
): string {
  if (!previousSignals) {
    return 'initial recommendation generated from current telemetry signals';
  }

  const tyreDelta = (current.tyreUrgencyScore ?? 0) - (previousSignals.tyreUrgencyScore ?? current.tyreUrgencyScore ?? 0);
  const fuelDelta = (current.fuelRiskScore ?? 0) - (previousSignals.fuelRiskScore ?? current.fuelRiskScore ?? 0);
  const trafficDelta = (current.trafficRiskScore ?? 0) - (previousSignals.trafficRiskScore ?? current.trafficRiskScore ?? 0);
  const pitLossDelta = (current.pitLossHeuristic ?? 0) - (previousSignals.pitLossHeuristic ?? current.pitLossHeuristic ?? 0);

  if (changed) {
    if (fuelDelta >= 10) return 'recommendation changed because fuel margin dropped faster than expected';
    if (tyreDelta >= 10) return 'recommendation changed because tyre degradation accelerated';
    if (trafficDelta >= 10) return 'recommendation changed because projected rejoin traffic increased';
    if (pitLossDelta >= 10) return 'recommendation changed because pit loss estimate increased';
    return 'recommendation changed due to combined strategy signal shift';
  }

  if (Math.abs(tyreDelta) <= 4 && Math.abs(fuelDelta) <= 4 && Math.abs(trafficDelta) <= 4) {
    return 'recommendation remained stable with low signal drift';
  }

  if (tyreDelta > 0) return 'recommendation held while tyre pressure increased toward pit window';
  if (fuelDelta > 0) return 'recommendation held while fuel risk increased but stayed manageable';
  if (trafficDelta > 0) return 'recommendation held while traffic risk increased, requiring close monitoring';
  return 'recommendation remained stable with no dominant risk change';
}

export class StrategyEngine {
  evaluate(input: StrategyEngineInput): StrategyEvaluationResult {
    if (!input.hasSnapshot) {
      return {
        strategyUnavailable: true,
        reason: 'no_snapshot',
        reasons: ['latest snapshot is not available'],
        signals: {
          latestSequence: input.latestSequence,
        },
        generatedAt: input.generatedAt,
      };
    }

    if (input.isStale || input.relayStatus === 'stale') {
      return {
        strategyUnavailable: true,
        reason: 'session_stale',
        reasons: ['relay session is stale and recommendations are paused'],
        signals: {
          latestSequence: input.latestSequence,
        },
        generatedAt: input.generatedAt,
      };
    }

    if (
      input.currentLap == null &&
      input.tyreAgeLaps == null &&
      input.fuelLapsRemaining == null
    ) {
      return {
        strategyUnavailable: true,
        reason: 'player_state_missing',
        reasons: ['player-centric telemetry fields are missing'],
        signals: {
          latestSequence: input.latestSequence,
        },
        generatedAt: input.generatedAt,
      };
    }

    const tyreUrgency = tyreUrgencyScore(input.tyreAgeLaps);
    const fuelRisk = fuelRiskScore(input);
    const stintRatio = stintProgress(input);
    const lapsRemaining = getLapsRemaining(input);
    const pitHint = pitWindowHint(tyreUrgency, stintRatio);
    const rejoinHint = rejoinRiskHint(input.position);

    const advanced = computeAdvancedStrategyScores({
      base: input,
      tyreUrgencyScore: tyreUrgency,
      fuelRiskScore: fuelRisk,
      stintProgress: stintRatio,
      pitWindowHint: pitHint,
      rejoinRiskHint: rejoinHint,
    });

    const reasons: string[] = [];

    if (tyreUrgency != null && tyreUrgency >= 75) {
      reasons.push('tyre wear trend is approaching the pit threshold window');
    }

    if (fuelRisk != null && fuelRisk >= 65) {
      reasons.push('fuel laps remaining are inside the risk margin');
    }

    if (rejoinHint === 'high') {
      reasons.push('rejoin traffic risk is high for the current running position');
    }

    let recommendation: StrategyRecommendationLabel = 'STAY OUT';
    let secondaryRecommendation: StrategyRecommendationLabel | undefined;
    let severity: StrategySeverity = 'info';

    if (fuelRisk != null && fuelRisk >= 85) {
      recommendation = 'FUEL RISK HIGH';
      severity = 'critical';
      secondaryRecommendation = 'STAY OUT';
    } else if (tyreUrgency != null && tyreUrgency >= 95) {
      recommendation = 'TYRE LIFE CRITICAL';
      severity = 'critical';
      secondaryRecommendation = 'PIT NOW';
    } else if (tyreUrgency != null && tyreUrgency >= 85 && rejoinHint !== 'high') {
      recommendation = 'PIT NOW';
      severity = 'warning';
      secondaryRecommendation = 'BOX IN 2 LAPS';
    } else if (tyreUrgency != null && tyreUrgency >= 70) {
      recommendation = 'BOX IN 2 LAPS';
      severity = 'caution';
      secondaryRecommendation = 'STAY OUT';
    } else if (rejoinHint === 'high' && tyreUrgency != null && tyreUrgency >= 60) {
      recommendation = 'TRAFFIC RISK HIGH';
      severity = 'caution';
      secondaryRecommendation = 'STAY OUT';
    }

    // v2 refinement: comparative undercut/overcut/traffic/degradation evaluation.
    if (advanced.undercutScore != null && advanced.overcutScore != null) {
      if (
        advanced.undercutScore >= 70 &&
        (advanced.overcutScore < 60 || advanced.trafficRiskScore == null || advanced.trafficRiskScore < 70) &&
        recommendation !== 'FUEL RISK HIGH'
      ) {
        recommendation = advanced.undercutScore >= 85 ? 'PIT NOW' : 'BOX IN 2 LAPS';
        secondaryRecommendation = 'STAY OUT';
        severity = recommendation === 'PIT NOW' ? 'warning' : 'caution';
        reasons.push('undercut score indicates a potential gain in the current pit window');
      } else if (
        advanced.overcutScore >= 70 &&
        advanced.trafficRiskScore != null &&
        advanced.trafficRiskScore >= 65 &&
        (advanced.degradationTrend == null || advanced.degradationTrend < 70) &&
        recommendation !== 'FUEL RISK HIGH' &&
        recommendation !== 'TYRE LIFE CRITICAL'
      ) {
        recommendation = 'STAY OUT';
        secondaryRecommendation = 'BOX IN 2 LAPS';
        severity = 'caution';
        reasons.push('overcut score is favorable while projected rejoin traffic remains high');
      }
    }

    if (
      advanced.pitLossHeuristic != null &&
      advanced.pitLossHeuristic >= 82 &&
      recommendation === 'PIT NOW'
    ) {
      recommendation = 'BOX IN 2 LAPS';
      secondaryRecommendation = 'STAY OUT';
      severity = 'caution';
      reasons.push('pit loss heuristic is high, so immediate stop was deferred');
    }

    if (
      advanced.compoundStintBias != null &&
      advanced.compoundStintBias >= 72 &&
      recommendation === 'BOX IN 2 LAPS' &&
      (fuelRisk == null || fuelRisk < 80)
    ) {
      secondaryRecommendation = 'PIT NOW';
      reasons.push('current compound and stint profile support one extra lap before boxing');
    }

    if (reasons.length === 0) {
      reasons.push('no critical strategy risk signal detected in the latest snapshot');
    }

    const signals: StrategySignals = {
      currentLap: input.currentLap,
      totalLaps: input.totalLaps,
      lapsRemaining,
      tyreAgeLaps: input.tyreAgeLaps,
      fuelRemaining: input.fuelRemaining,
      fuelLapsRemaining: input.fuelLapsRemaining,
      position: input.position,
      latestSequence: input.latestSequence,
      tyreUrgencyScore: tyreUrgency,
      fuelRiskScore: fuelRisk,
      stintProgress: stintRatio,
      pitWindowHint: pitHint,
      rejoinRiskHint: rejoinHint,
      undercutScore: advanced.undercutScore,
      overcutScore: advanced.overcutScore,
      trafficRiskScore: advanced.trafficRiskScore,
      degradationTrend: advanced.degradationTrend,
      pitLossHeuristic: advanced.pitLossHeuristic,
      compoundStintBias: advanced.compoundStintBias,
      expectedRejoinBand: advanced.expectedRejoinBand,
      cleanAirProbability: advanced.cleanAirProbability,
    };

    const scoreByRecommendation: Record<StrategyRecommendationLabel, number> = {
      'PIT NOW': recommendationScore('PIT NOW', {
        tyreUrgency,
        fuelRisk,
        undercutScore: advanced.undercutScore,
        overcutScore: advanced.overcutScore,
        trafficRiskScore: advanced.trafficRiskScore,
        degradationTrend: advanced.degradationTrend,
        pitLossHeuristic: advanced.pitLossHeuristic,
        compoundStintBias: advanced.compoundStintBias,
      }),
      'BOX IN 2 LAPS': recommendationScore('BOX IN 2 LAPS', {
        tyreUrgency,
        fuelRisk,
        undercutScore: advanced.undercutScore,
        overcutScore: advanced.overcutScore,
        trafficRiskScore: advanced.trafficRiskScore,
        degradationTrend: advanced.degradationTrend,
        pitLossHeuristic: advanced.pitLossHeuristic,
        compoundStintBias: advanced.compoundStintBias,
      }),
      'STAY OUT': recommendationScore('STAY OUT', {
        tyreUrgency,
        fuelRisk,
        undercutScore: advanced.undercutScore,
        overcutScore: advanced.overcutScore,
        trafficRiskScore: advanced.trafficRiskScore,
        degradationTrend: advanced.degradationTrend,
        pitLossHeuristic: advanced.pitLossHeuristic,
        compoundStintBias: advanced.compoundStintBias,
      }),
      'TRAFFIC RISK HIGH': recommendationScore('TRAFFIC RISK HIGH', {
        tyreUrgency,
        fuelRisk,
        undercutScore: advanced.undercutScore,
        overcutScore: advanced.overcutScore,
        trafficRiskScore: advanced.trafficRiskScore,
        degradationTrend: advanced.degradationTrend,
        pitLossHeuristic: advanced.pitLossHeuristic,
        compoundStintBias: advanced.compoundStintBias,
      }),
      'TYRE LIFE CRITICAL': recommendationScore('TYRE LIFE CRITICAL', {
        tyreUrgency,
        fuelRisk,
        undercutScore: advanced.undercutScore,
        overcutScore: advanced.overcutScore,
        trafficRiskScore: advanced.trafficRiskScore,
        degradationTrend: advanced.degradationTrend,
        pitLossHeuristic: advanced.pitLossHeuristic,
        compoundStintBias: advanced.compoundStintBias,
      }),
      'FUEL RISK HIGH': recommendationScore('FUEL RISK HIGH', {
        tyreUrgency,
        fuelRisk,
        undercutScore: advanced.undercutScore,
        overcutScore: advanced.overcutScore,
        trafficRiskScore: advanced.trafficRiskScore,
        degradationTrend: advanced.degradationTrend,
        pitLossHeuristic: advanced.pitLossHeuristic,
        compoundStintBias: advanced.compoundStintBias,
      }),
    };

    const confidenceScore = computeConfidenceScore(scoreByRecommendation);
    const stabilityScore = computeStabilityScore(signals, input.previousStrategy?.signals);
    const recommendationChanged =
      !!input.previousStrategy && input.previousStrategy.recommendation !== recommendation;
    const trendReason = buildTrendReason(
      recommendationChanged,
      signals,
      input.previousStrategy?.signals
    );

    if (confidenceScore >= 85) {
      reasons.push('high-confidence recommendation with aligned strategy signals');
    } else if (confidenceScore <= 55) {
      reasons.push('signal conflict detected, keep monitoring before committing');
    }

    if (stabilityScore <= 45) {
      reasons.push('recommendation is volatile near decision boundaries');
    }

    const result: StrategyRecommendationResult = {
      strategyUnavailable: false,
      recommendation,
      primaryRecommendation: recommendation,
      secondaryRecommendation,
      severity,
      confidenceScore,
      stabilityScore,
      recommendationChanged,
      trendReason,
      reasons,
      signals,
      generatedAt: input.generatedAt,
    };

    return result;
  }
}
