import {
  QualifyingReleaseWindow,
  QualifyingSessionPhase,
  QualifyingStrategyInsight,
  StrategyEngineInput,
  StrategyEvaluationResult,
  StrategyRecommendationResult,
  StrategyRecommendationLabel,
  StrategyScoreBand,
  StrategySessionMode,
  StrategySignals,
  StrategySeverity,
  StrategySimulationMeta,
  TrackMapCarSnapshot,
} from './strategy';
import {
  fitPolynomialTyreDegradation,
  fuelRiskScore,
  getLapsRemaining,
  pitWindowHint,
  pitWindowHintFromModel,
  rejoinRiskHint,
  stintProgress,
  tyreUrgencyScore,
} from './strategyMetrics';
import { computeAdvancedStrategyScores } from './strategyAdvancedMetrics';

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sampleGaussian(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(Math.max(1e-10, u1))) * Math.cos(2.0 * Math.PI * u2);
  return mean + stdDev * z;
}

export type MonteCarloResult = StrategySimulationMeta;

export function runMonteCarloSimulation(input: {
  currentLap: number | null;
  totalLaps: number | null;
  tyreAgeLaps: number | null;
  tyreUrgencyScore: number | null;
  fuelRiskScore: number | null;
  undercutScore: number | null;
  safetyCarProbPerLap?: number;
  iterations?: number;
}): MonteCarloResult | null {
  const currentLap = input.currentLap;
  const totalLaps = input.totalLaps;
  if (currentLap == null || totalLaps == null || totalLaps <= 0) return null;

  const N = Math.min(1000, Math.max(500, input.iterations ?? 500));
  const lapsRemaining = totalLaps - currentLap;
  if (lapsRemaining <= 0) return null;

  const tyreUrgency = input.tyreUrgencyScore ?? 50;
  const fuelRisk = input.fuelRiskScore ?? 30;
  const undercutScore = input.undercutScore ?? 50;
  const tyreAge = input.tyreAgeLaps ?? 10;
  const scProbPerLap = input.safetyCarProbPerLap ?? 0.03;

  const pitWindowOpen = Math.max(currentLap + 1, currentLap + Math.round(((100 - tyreUrgency) / 100) * Math.min(lapsRemaining, 15)));
  const rawClose = pitWindowOpen + Math.round(lapsRemaining * 0.4);
  const pitWindowClose = Math.max(pitWindowOpen, Math.min(totalLaps - 1, rawClose));

  if (pitWindowClose < pitWindowOpen) return null;

  const lapGains: number[] = [];
  const sampledPitLaps: number[] = [];

  for (let iter = 0; iter < N; iter++) {
    const noisyUrgency = Math.max(0, Math.min(100, sampleGaussian(tyreUrgency, 8)));
    const noisyUndercutScore = Math.max(0, Math.min(100, sampleGaussian(undercutScore, 10)));
    const noisyFuelRisk = Math.max(0, Math.min(100, sampleGaussian(fuelRisk, 6)));

    const urgencyFactor = noisyUrgency / 100;
    const undercutFactor = noisyUndercutScore / 100;

    let hasSafetyCar = false;
    for (let lap = currentLap; lap < pitWindowClose; lap++) {
      if (Math.random() < scProbPerLap) { hasSafetyCar = true; break; }
    }

    const scBonus = hasSafetyCar ? 0.15 : 0;

    const optLapOffset = Math.round(
      ((1 - urgencyFactor) * 0.4 + (1 - undercutFactor) * 0.3) * Math.min(10, lapsRemaining * 0.3)
    );
    let candidateLap = pitWindowOpen + optLapOffset;
    candidateLap = Math.min(pitWindowClose, Math.max(pitWindowOpen, candidateLap));

    const pitDeltaSeconds = sampleGaussian(22, 1.5);

    const freshTyreGainPerLap = sampleGaussian(0.35 + undercutFactor * 0.2, 0.05);
    const lapsOnFreshTyre = totalLaps - candidateLap;
    const freshTyreGain = freshTyreGainPerLap * lapsOnFreshTyre;

    const deg = (tyreAge + (candidateLap - currentLap)) * 0.05 + noisyUrgency / 100;
    const stayCost = deg * (lapsOnFreshTyre * 0.4);

    const gain = freshTyreGain - pitDeltaSeconds + stayCost + scBonus * pitDeltaSeconds - noisyFuelRisk * 0.05;

    lapGains.push(gain);
    sampledPitLaps.push(candidateLap);
  }

  lapGains.sort((a, b) => a - b);
  sampledPitLaps.sort((a, b) => a - b);

  const p5 = lapGains[Math.floor(N * 0.05)];
  const p95 = lapGains[Math.floor(N * 0.95)];
  const meanGain = lapGains.reduce((s, v) => s + v, 0) / N;
  const stdDev = Math.sqrt(lapGains.reduce((s, v) => s + (v - meanGain) ** 2, 0) / N);

  const p5Lap = sampledPitLaps[Math.floor(N * 0.05)];
  const p95Lap = sampledPitLaps[Math.floor(N * 0.95)];
  const medianLap = sampledPitLaps[Math.floor(N * 0.5)];

  const converged = stdDev < Math.abs(meanGain) * 0.5;

  return {
    optimalPitLap: medianLap,
    confidenceInterval: [p5Lap, p95Lap],
    iterations: N,
    converged,
    meanGainSeconds: meanGain,
    stdDevGainSeconds: stdDev,
  };
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

function computeConfidenceScore(scores: Record<string, number>, mcResult?: MonteCarloResult | null): number {
  const values = Object.values(scores).sort((a, b) => b - a);
  if (values.length < 2) return 50;
  const gap = values[0] - values[1];
  let base = clampScore(55 + gap * 1.2);

  if (mcResult) {
    if (mcResult.converged) {
      base = Math.min(100, base + 5);
    } else {
      base = Math.max(0, base - 8);
    }
    const relStdDev = mcResult.stdDevGainSeconds / Math.max(1, Math.abs(mcResult.meanGainSeconds));
    if (relStdDev > 1.5) base = Math.max(0, base - 10);
    else if (relStdDev < 0.5) base = Math.min(100, base + 5);
  }

  return base;
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
    return current.sessionMode === 'qualifying'
      ? 'initial out-lap release guidance generated from the live traffic map'
      : 'initial recommendation generated from current telemetry signals';
  }

  const tyreDelta = (current.tyreUrgencyScore ?? 0) - (previousSignals.tyreUrgencyScore ?? current.tyreUrgencyScore ?? 0);
  const fuelDelta = (current.fuelRiskScore ?? 0) - (previousSignals.fuelRiskScore ?? current.fuelRiskScore ?? 0);
  const trafficDelta = (current.trafficRiskScore ?? 0) - (previousSignals.trafficRiskScore ?? current.trafficRiskScore ?? 0);
  const pitLossDelta = (current.pitLossHeuristic ?? 0) - (previousSignals.pitLossHeuristic ?? current.pitLossHeuristic ?? 0);
  const clearDelta = (current.clearLapProbability ?? 0) - (previousSignals.clearLapProbability ?? current.clearLapProbability ?? 0);

  if (current.sessionMode === 'qualifying') {
    if (changed) {
      if (trafficDelta >= 10) return 'recommendation changed because sector 1 traffic stacked near pit exit';
      if (clearDelta >= 10) return 'recommendation changed because the clear-lap window improved';
      return 'recommendation changed as the out-lap traffic pattern shifted';
    }

    if (Math.abs(trafficDelta) <= 4 && Math.abs(clearDelta) <= 4) {
      return 'qualifying release guidance remained stable with low traffic drift';
    }

    if (trafficDelta > 0) return 'traffic is building on the out-lap, so the release window remains under watch';
    if (clearDelta > 0) return 'the clear-lap window improved while the field spread out';
    return 'qualifying release guidance remained stable with only minor traffic changes';
  }

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

const QUALIFYING_PHASE_MAP: Record<string, QualifyingSessionPhase> = {
  '5': 'Q1',
  '6': 'Q2',
  '7': 'Q3',
};

function isQualifyingSession(sessionType: unknown): boolean {
  const raw = String(sessionType ?? '').trim().toUpperCase();
  if (!raw) return false;
  return raw === '5' || raw === '6' || raw === '7' || raw.includes('QUAL') || raw.includes('Q1') || raw.includes('Q2') || raw.includes('Q3');
}

function resolveSessionMode(sessionType: unknown): StrategySessionMode {
  return isQualifyingSession(sessionType) ? 'qualifying' : 'race';
}

function resolveQualifyingPhase(sessionType: unknown): QualifyingSessionPhase {
  const raw = String(sessionType ?? '').trim().toUpperCase();
  if (QUALIFYING_PHASE_MAP[raw]) {
    return QUALIFYING_PHASE_MAP[raw];
  }
  if (raw.includes('Q1')) return 'Q1';
  if (raw.includes('Q2')) return 'Q2';
  if (raw.includes('Q3')) return 'Q3';
  return 'QUALI';
}

function normalizePitStatus(value: string | number | null | undefined): string {
  if (value == null) return 'UNKNOWN';
  const raw = String(value).trim().toUpperCase();
  if (raw === '0' || raw === 'NONE' || raw === 'TRACK') return 'TRACK';
  if (raw === '1' || raw.includes('PITTING')) return 'PITTING';
  if (raw === '2' || raw.includes('PIT')) return 'PIT_LANE';
  return raw;
}

function normalizeDriverStatus(value: string | number | null | undefined): string {
  if (value == null) return 'UNKNOWN';
  const raw = String(value).trim().toUpperCase();
  switch (raw) {
    case '0': return 'IN_GARAGE';
    case '1': return 'FLYING_LAP';
    case '2': return 'IN_LAP';
    case '3': return 'OUT_LAP';
    case '4': return 'ON_TRACK';
    default: return raw;
  }
}

function normalizeLapProgress(lapDistance: number | null | undefined, trackLength: number | null | undefined): number | null {
  if (lapDistance == null || !Number.isFinite(lapDistance)) {
    return null;
  }
  if (lapDistance >= 0 && lapDistance <= 1) {
    return lapDistance;
  }
  if (lapDistance >= 0 && lapDistance <= 100) {
    return lapDistance / 100;
  }
  if (trackLength != null && trackLength > 0) {
    return Math.max(0, Math.min(1, lapDistance / trackLength));
  }
  return null;
}

function scoreBandFromProbability(value: number | null): StrategyScoreBand {
  if (value == null) return 'unknown';
  if (value >= 80) return 'critical';
  if (value >= 65) return 'high';
  if (value >= 40) return 'medium';
  return 'low';
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

    const sessionMode = resolveSessionMode(input.sessionType);
    if (sessionMode === 'qualifying') {
      return this.evaluateQualifyingStrategy(input);
    }

    const tyreUrgency = tyreUrgencyScore(input.tyreAgeLaps);
    const fuelRisk = fuelRiskScore(input);
    const stintRatio = stintProgress(input);
    const lapsRemaining = getLapsRemaining(input);
    const rejoinHint = rejoinRiskHint(input.position);

    const tyreModel = input.recentLapTimesMs && input.recentLapTimesMs.length >= 2
      ? fitPolynomialTyreDegradation(
          input.recentLapTimesMs.map(ms => ms / 1000),
          input.tyreAgeLaps
        )
      : null;

    const modelPitHint = tyreModel != null && input.tyreAgeLaps != null
      ? pitWindowHintFromModel(tyreModel, input.tyreAgeLaps)
      : null;

    const heuristicPitHint = pitWindowHint(tyreUrgency, stintRatio);

    const pitHint: typeof heuristicPitHint = (() => {
      if (modelPitHint == null) return heuristicPitHint;
      if (modelPitHint === 'open_now' || heuristicPitHint === 'open_now') return 'open_now';
      if (modelPitHint === 'open_soon' || heuristicPitHint === 'open_soon') return 'open_soon';
      if (modelPitHint === 'unknown' && heuristicPitHint !== 'unknown') return heuristicPitHint;
      return modelPitHint;
    })();

    const advanced = computeAdvancedStrategyScores({
      base: input,
      tyreUrgencyScore: tyreUrgency,
      fuelRiskScore: fuelRisk,
      stintProgress: stintRatio,
      pitWindowHint: pitHint,
      rejoinRiskHint: rejoinHint,
    });

    const mcResult = runMonteCarloSimulation({
      currentLap: input.currentLap,
      totalLaps: input.totalLaps,
      tyreAgeLaps: input.tyreAgeLaps,
      tyreUrgencyScore: tyreUrgency,
      fuelRiskScore: fuelRisk,
      undercutScore: advanced.undercutScore,
      iterations: 500,
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

    if (mcResult) {
      const lapsRem = lapsRemaining ?? 0;
      if (mcResult.optimalPitLap > 0 && lapsRem > 0) {
        const lapsUntilOptimal = mcResult.optimalPitLap - (input.currentLap ?? 0);
        if (lapsUntilOptimal <= 2) {
          reasons.push(`monte carlo simulation (N=${mcResult.iterations}) suggests pit window is now optimal`);
        } else if (lapsUntilOptimal <= 5) {
          reasons.push(`monte carlo simulation (N=${mcResult.iterations}) suggests optimal pit in ${Math.round(lapsUntilOptimal)} laps`);
        }
      }
      if (!mcResult.converged) {
        reasons.push('simulation has high variance — multiple strategies remain viable');
      }
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

    if (mcResult && input.currentLap != null) {
      const lapsUntilOptimal = mcResult.optimalPitLap - input.currentLap;
      if (
        mcResult.converged &&
        lapsUntilOptimal <= 1 &&
        recommendation !== 'FUEL RISK HIGH' &&
        recommendation !== 'TYRE LIFE CRITICAL'
      ) {
        recommendation = 'PIT NOW';
        severity = 'warning';
        secondaryRecommendation = 'BOX IN 2 LAPS';
        reasons.push('monte carlo simulation confirms this lap as the optimal pit window');
      } else if (
        mcResult.converged &&
        lapsUntilOptimal <= 3 &&
        recommendation === 'STAY OUT'
      ) {
        recommendation = 'BOX IN 2 LAPS';
        severity = 'caution';
        secondaryRecommendation = 'STAY OUT';
      }
    }

    if (advanced.undercutScore != null && advanced.overcutScore != null) {
      if (
        advanced.undercutScore >= 70 &&
        (advanced.overcutScore < 60 || advanced.trafficRiskScore == null || advanced.trafficRiskScore < 70) &&
        recommendation !== 'FUEL RISK HIGH'
      ) {
        recommendation = advanced.undercutScore >= 85 ? 'PIT NOW' : 'BOX IN 2 LAPS';
        secondaryRecommendation = 'STAY OUT';
        severity = recommendation === 'PIT NOW' ? 'warning' : 'caution';
        const prob = advanced.undercutProbability;
        reasons.push(
          prob != null
            ? `undercut score indicates a potential gain (est. ${Math.round(prob * 100)}% success probability)`
            : 'undercut score indicates a potential gain in the current pit window'
        );
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
        const prob = advanced.overcutProbability;
        reasons.push(
          prob != null
            ? `overcut score is favorable (est. ${Math.round(prob * 100)}% success probability) while rejoin traffic remains high`
            : 'overcut score is favorable while projected rejoin traffic remains high'
        );
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
      sessionMode: 'race',
      sessionPhase: 'RACE',
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
      outLapTrafficScore: null,
      optimalReleaseInSec: null,
      clearLapProbability: null,
      trackDensityScore: null,
      predictedGapAheadMeters: null,
      predictedGapBehindMeters: null,
      undercutScore: advanced.undercutScore,
      overcutScore: advanced.overcutScore,
      trafficRiskScore: advanced.trafficRiskScore,
      degradationTrend: advanced.degradationTrend,
      pitLossHeuristic: advanced.pitLossHeuristic,
      compoundStintBias: advanced.compoundStintBias,
      expectedRejoinBand: advanced.expectedRejoinBand,
      cleanAirProbability: advanced.cleanAirProbability,
      undercutProbability: advanced.undercutProbability,
      overcutProbability: advanced.overcutProbability,
      ersEndLapPct: advanced.ersEndLapPct,
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

    const confidenceScore = computeConfidenceScore(scoreByRecommendation, mcResult);
    const stabilityScore = computeStabilityScore(signals, input.previousStrategy?.signals);
    const rawRecommendationChanged =
      !!input.previousStrategy && input.previousStrategy.recommendation !== recommendation;
    const syncingCanonicalSession = input.syncingCanonicalSession === true;

    let finalConfidence = confidenceScore;
    let finalStability = stabilityScore;
    let recommendationChanged = rawRecommendationChanged;

    if (syncingCanonicalSession) {
      finalConfidence = Math.min(finalConfidence, 55);
      finalStability = Math.min(finalStability, 45);
      recommendationChanged = false;
      reasons.push('canonical session sync in progress; confidence/stability are temporarily conservative');
    }

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
      sessionMode: 'race',
      recommendation,
      primaryRecommendation: recommendation,
      secondaryRecommendation,
      severity,
      confidenceScore: finalConfidence,
      stabilityScore: finalStability,
      recommendationChanged,
      trendReason,
      syncingCanonicalSession,
      syncingUntil: input.syncingUntil ?? null,
      reasons,
      signals,
      generatedAt: input.generatedAt,
      simulationMeta: mcResult ?? undefined,
    };

    return result;
  }

  private evaluateQualifyingStrategy(input: StrategyEngineInput): StrategyRecommendationResult {
    const phase = resolveQualifyingPhase(input.sessionType);
    const trackLength = input.trackLength ?? 5400;
    const tyreUrgency = tyreUrgencyScore(input.tyreAgeLaps);
    const fuelRisk = fuelRiskScore(input);
    const stintRatio = stintProgress(input);
    const lapsRemaining = getLapsRemaining(input);

    const trackMapCars: TrackMapCarSnapshot[] = (input.trafficCars ?? [])
      .map((car) => {
        const progress = normalizeLapProgress(car.lapDistance ?? null, trackLength);
        return {
          carIndex: car.carIndex,
          position: car.position ?? null,
          lapDistance: car.lapDistance ?? null,
          progressPct: progress != null ? Number((progress * 100).toFixed(1)) : null,
          pitStatus: normalizePitStatus(car.pitStatus),
          driverStatus: normalizeDriverStatus(car.driverStatus),
          tyreCompound: car.tyreCompound ?? null,
          isPlayer:
            car.isPlayer === true ||
            (input.playerCarIndex != null && car.carIndex === input.playerCarIndex),
        };
      })
      .sort((a, b) => {
        if (a.isPlayer && !b.isPlayer) return -1;
        if (!a.isPlayer && b.isPlayer) return 1;
        return (a.position ?? 999) - (b.position ?? 999);
      });

    const onTrackCars = trackMapCars.filter((car) => {
      const pitStatus = car.pitStatus ?? 'UNKNOWN';
      return car.progressPct != null && pitStatus !== 'PIT_LANE' && pitStatus !== 'PITTING';
    });

    const progresses = onTrackCars
      .map((car) => (car.progressPct != null ? car.progressPct / 100 : null))
      .filter((value): value is number => value != null);

    const trafficBands = [
      { key: 'pit_exit', label: 'Pit Exit', startPct: 0, endPct: 18 },
      { key: 'sector_1', label: 'Sector 1', startPct: 18, endPct: 45 },
      { key: 'sector_2', label: 'Sector 2', startPct: 45, endPct: 72 },
      { key: 'sector_3', label: 'Sector 3', startPct: 72, endPct: 100 },
    ].map((band) => {
      const carCount = onTrackCars.filter((car) => {
        const progress = car.progressPct ?? -1;
        return progress >= band.startPct && progress < band.endPct;
      }).length;

      return {
        ...band,
        carCount,
        density: clampScore((carCount / Math.max(1, onTrackCars.length)) * 100),
      };
    });

    const pitExitCars = progresses.filter((value) => value >= 0 && value < 0.18).length;
    const outLapTrafficCars = progresses.filter((value) => value >= 0 && value < 0.35).length;
    const finalCornerCars = progresses.filter((value) => value > 0.82).length;
    const predictedCarsOnOutLap = progresses.filter((value) => value < 0.35 || value > 0.85).length;

    const gapAheadPct = progresses
      .filter((value) => value > 0.02 && value < 0.55)
      .sort((a, b) => a - b)[0] ?? 0.45;

    const latestBehind = progresses
      .filter((value) => value > 0.75)
      .sort((a, b) => b - a)[0];
    const gapBehindPct = latestBehind != null ? Math.max(0.03, 1 - latestBehind) : 0.35;

    const predictedGapAheadMeters = trackLength > 0 ? Math.round(gapAheadPct * trackLength) : null;
    const predictedGapBehindMeters = trackLength > 0 ? Math.round(gapBehindPct * trackLength) : null;

    const trackDensityScore = clampScore(
      trafficBands.reduce((sum, band) => sum + band.density, 0) / Math.max(1, trafficBands.length)
    );

    let trafficScore = clampScore(
      18 +
      pitExitCars * 18 +
      Math.max(0, outLapTrafficCars - pitExitCars) * 10 +
      finalCornerCars * 8 +
      Math.max(0, onTrackCars.length - 8) * 2 -
      Math.min(14, gapAheadPct * 35)
    );

    if (input.sessionTimeLeft != null && input.sessionTimeLeft < 180) {
      trafficScore = clampScore(trafficScore + 6);
    }

    let clearLapProbability = clampScore(
      100 -
      trafficScore +
      Math.min(12, (predictedGapAheadMeters ?? 0) / 80) +
      Math.min(8, (predictedGapBehindMeters ?? 0) / 100)
    );

    if (predictedCarsOnOutLap >= 5) {
      clearLapProbability = clampScore(clearLapProbability - 10);
    }

    let recommendation: StrategyRecommendationLabel = 'RELEASE NOW';
    let secondaryRecommendation: StrategyRecommendationLabel | undefined = 'BUILD TYRES';
    let severity: StrategySeverity = 'info';
    let releaseWindow: QualifyingReleaseWindow = 'release_now';
    let recommendedReleaseInSec = 0;

    if (trafficScore >= 70) {
      recommendation = 'TRAFFIC CLUSTER AHEAD';
      secondaryRecommendation = 'HOLD GAP';
      severity = 'warning';
      releaseWindow = 'wait_for_gap';
      recommendedReleaseInSec = input.sessionTimeLeft != null && input.sessionTimeLeft < 150
        ? 8
        : Math.min(30, 12 + pitExitCars * 4 + finalCornerCars * 2);
    } else if (trafficScore >= 46) {
      recommendation = 'HOLD GAP';
      secondaryRecommendation = 'RELEASE NOW';
      severity = 'caution';
      releaseWindow = 'wait_short';
      recommendedReleaseInSec = Math.min(16, 6 + pitExitCars * 3 + finalCornerCars * 2);
    }

    if (input.sessionTimeLeft != null && input.sessionTimeLeft < 120 && recommendation !== 'RELEASE NOW') {
      recommendation = 'BUILD TYRES';
      secondaryRecommendation = 'RELEASE NOW';
      severity = 'caution';
      releaseWindow = 'queue_reset';
      recommendedReleaseInSec = Math.min(recommendedReleaseInSec || 8, 8);
      clearLapProbability = clampScore(clearLapProbability + 5);
    }

    const releaseLabel = recommendedReleaseInSec <= 0
      ? 'RELEASE NOW'
      : `RELEASE IN ${Math.round(recommendedReleaseInSec)}s`;

    const reasons: string[] = [
      `${predictedCarsOnOutLap} cars projected through pit-exit and sector 1 on the next out-lap`,
      predictedGapAheadMeters != null
        ? `predicted clean gap ahead is ~${predictedGapAheadMeters}m`
        : 'track position gaps are still settling on the out-lap',
    ];

    if (pitExitCars >= 3) {
      reasons.push('sector 1 queue is forming near pit exit');
    }
    if (input.sessionTimeLeft != null && input.sessionTimeLeft < 180) {
      reasons.push('session clock is tight, so only a short hold is recommended');
    }
    if (clearLapProbability >= 75) {
      reasons.push('track map shows a strong chance to secure a clean flyer');
    }

    const qualifying: QualifyingStrategyInsight = {
      active: true,
      sessionPhase: phase,
      releaseWindow,
      releaseLabel,
      trafficSummary: `${pitExitCars} cars near pit exit · ${outLapTrafficCars} cars inside sector 1`,
      outLapSummary: `${releaseLabel} · clear-lap chance ${clearLapProbability}%`,
      trafficScore,
      clearLapProbability,
      recommendedReleaseInSec,
      predictedCarsOnOutLap,
      predictedGapAheadMeters,
      predictedGapBehindMeters,
      rationale: reasons.slice(0, 4),
      trafficBands,
      trackMapCars,
    };

    const signals: StrategySignals = {
      sessionMode: 'qualifying',
      sessionPhase: phase,
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
      pitWindowHint: 'monitor',
      rejoinRiskHint: 'unknown',
      outLapTrafficScore: trafficScore,
      optimalReleaseInSec: recommendedReleaseInSec,
      clearLapProbability,
      trackDensityScore,
      predictedGapAheadMeters,
      predictedGapBehindMeters,
      undercutScore: null,
      overcutScore: null,
      trafficRiskScore: trafficScore,
      degradationTrend: null,
      pitLossHeuristic: null,
      compoundStintBias: null,
      expectedRejoinBand: scoreBandFromProbability(clearLapProbability),
      cleanAirProbability: clearLapProbability,
      undercutProbability: null,
      overcutProbability: null,
      ersEndLapPct: input.ersPercent,
    };

    const scoreByRecommendation = {
      'RELEASE NOW': clampScore((clearLapProbability ?? 50) + Math.min(12, (predictedGapAheadMeters ?? 0) / 70)),
      'HOLD GAP': clampScore(40 + trafficScore * 0.45),
      'BUILD TYRES': clampScore(30 + (input.sessionTimeLeft != null && input.sessionTimeLeft < 120 ? 35 : 10)),
      'TRAFFIC CLUSTER AHEAD': clampScore(trafficScore + Math.max(0, pitExitCars - 1) * 6),
    };

    const confidenceScore = computeConfidenceScore(scoreByRecommendation);
    const stabilityScore = computeStabilityScore(signals, input.previousStrategy?.signals);
    const rawRecommendationChanged =
      !!input.previousStrategy && input.previousStrategy.recommendation !== recommendation;
    const syncingCanonicalSession = input.syncingCanonicalSession === true;

    let finalConfidence = confidenceScore;
    let finalStability = stabilityScore;
    let recommendationChanged = rawRecommendationChanged;

    if (syncingCanonicalSession) {
      finalConfidence = Math.min(finalConfidence, 55);
      finalStability = Math.min(finalStability, 45);
      recommendationChanged = false;
      reasons.push('canonical session sync in progress; release confidence/stability are temporarily conservative');
    }

    const trendReason = buildTrendReason(
      recommendationChanged,
      signals,
      input.previousStrategy?.signals
    );

    if (confidenceScore >= 85) {
      reasons.push('high-confidence release call with a clearly defined traffic gap');
    } else if (confidenceScore <= 55) {
      reasons.push('traffic pattern is unstable, so keep monitoring before release');
    }

    if (stabilityScore <= 45) {
      reasons.push('release timing is volatile as nearby cars bunch up');
    }

    return {
      strategyUnavailable: false,
      sessionMode: 'qualifying',
      recommendation,
      primaryRecommendation: recommendation,
      secondaryRecommendation,
      severity,
      confidenceScore: finalConfidence,
      stabilityScore: finalStability,
      recommendationChanged,
      trendReason,
      syncingCanonicalSession,
      syncingUntil: input.syncingUntil ?? null,
      reasons,
      signals,
      generatedAt: input.generatedAt,
      qualifying,
    };
  }
}
