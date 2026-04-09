import {
  StrategyEngineInput,
  StrategyEvaluationResult,
  StrategyRecommendationResult,
  StrategyRecommendationLabel,
  StrategySignals,
  StrategySeverity,
  StrategySimulationMeta,
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

/**
 * Historical Safety Car probability by track (per lap)
 * Based on historical incident rates
 */
export const TRACK_SC_PROBABILITY: Record<number, number> = {
  0: 0.025,   // Melbourne - medium
  1: 0.02,    // Paul Ricard - low (runoff)
  2: 0.025,   // Shanghai
  3: 0.02,    // Bahrain - low
  4: 0.025,   // Catalunya
  5: 0.08,    // Monaco - very high (walls)
  6: 0.04,    // Montreal - high (walls)
  7: 0.03,    // Silverstone
  8: 0.025,   // Hockenheim
  9: 0.03,    // Hungaroring
  10: 0.035,  // Spa - longer track, more incidents
  11: 0.025,  // Monza
  12: 0.06,   // Singapore - street circuit
  13: 0.03,   // Suzuka
  14: 0.025,  // Abu Dhabi
  15: 0.03,   // Austin
  16: 0.035,  // Brazil - tricky conditions
  17: 0.035,  // Austria
  18: 0.025,  // Sochi
  19: 0.03,   // Mexico
  20: 0.07,   // Baku - very high (walls)
  21: 0.065,  // Saudi Arabia - walls
  22: 0.035,  // Miami
  23: 0.04,   // Las Vegas - street
  24: 0.03,   // Qatar
};

/**
 * Calculate dynamic SC probability based on session context
 */
export function calculateDynamicSCProbability(input: {
  trackId?: number | null;
  incidentCountThisSession?: number;
  lapsCompleted?: number;
  weatherCondition?: 'dry' | 'wet' | 'mixed' | null;
  sessionType?: string | null;
}): number {
  // Base probability from track history
  let baseProbability = (input.trackId != null && TRACK_SC_PROBABILITY[input.trackId])
    ? TRACK_SC_PROBABILITY[input.trackId]
    : 0.03;
  
  // Adjust for weather - wet conditions increase SC probability significantly
  if (input.weatherCondition === 'wet') {
    baseProbability *= 2.0;
  } else if (input.weatherCondition === 'mixed') {
    baseProbability *= 1.5;
  }
  
  // Adjust based on session incident rate
  if (input.incidentCountThisSession != null && input.lapsCompleted != null && input.lapsCompleted > 5) {
    const sessionIncidentRate = input.incidentCountThisSession / input.lapsCompleted;
    const expectedRate = baseProbability;
    
    // If session has more incidents than expected, increase probability
    if (sessionIncidentRate > expectedRate * 1.5) {
      baseProbability *= 1.3;
    } else if (sessionIncidentRate < expectedRate * 0.5) {
      baseProbability *= 0.8;
    }
  }
  
  // Race sessions have higher SC probability than practice/quali
  if (input.sessionType) {
    const sessionLower = input.sessionType.toLowerCase();
    if (sessionLower.includes('practice') || sessionLower.includes('quali')) {
      baseProbability *= 0.6;
    }
  }
  
  return Math.max(0.01, Math.min(0.15, baseProbability));
}

export type MonteCarloResult = StrategySimulationMeta;

export interface MonteCarloInputExtended {
  currentLap: number | null;
  totalLaps: number | null;
  tyreAgeLaps: number | null;
  tyreUrgencyScore: number | null;
  fuelRiskScore: number | null;
  undercutScore: number | null;
  safetyCarProbPerLap?: number;
  iterations?: number;
  trackId?: number | null;
  pitLaneTimeLoss?: number; // Track-specific pit lane time loss in seconds
  convergenceThreshold?: number; // stdDev/mean ratio for convergence
  adaptiveIterations?: boolean; // Enable adaptive iteration count
}

export function runMonteCarloSimulation(input: MonteCarloInputExtended): MonteCarloResult | null {
  const currentLap = input.currentLap;
  const totalLaps = input.totalLaps;
  if (currentLap == null || totalLaps == null || totalLaps <= 0) return null;

  const lapsRemaining = totalLaps - currentLap;
  if (lapsRemaining <= 0) return null;

  const tyreUrgency = input.tyreUrgencyScore ?? 50;
  const fuelRisk = input.fuelRiskScore ?? 30;
  const undercutScore = input.undercutScore ?? 50;
  const tyreAge = input.tyreAgeLaps ?? 10;
  
  // Use dynamic SC probability if trackId provided, else use provided or default
  const scProbPerLap = input.safetyCarProbPerLap 
    ?? (input.trackId != null ? (TRACK_SC_PROBABILITY[input.trackId] ?? 0.03) : 0.03);
  
  // Track-specific pit lane time loss (default 22 seconds)
  const pitLaneTimeLoss = input.pitLaneTimeLoss ?? 22;
  
  // Convergence settings
  const convergenceThreshold = input.convergenceThreshold ?? 0.5;
  const adaptiveIterations = input.adaptiveIterations ?? false;
  
  // Start with base iterations, increase if not converging and adaptive is enabled
  let N = Math.min(2000, Math.max(500, input.iterations ?? 800));
  const maxIterations = adaptiveIterations ? 3000 : N;

  const pitWindowOpen = Math.max(currentLap + 1, currentLap + Math.round(((100 - tyreUrgency) / 100) * Math.min(lapsRemaining, 15)));
  const rawClose = pitWindowOpen + Math.round(lapsRemaining * 0.4);
  const pitWindowClose = Math.max(pitWindowOpen, Math.min(totalLaps - 1, rawClose));

  if (pitWindowClose < pitWindowOpen) return null;

  let lapGains: number[] = [];
  let sampledPitLaps: number[] = [];
  let converged = false;
  let totalIterations = 0;
  
  // Run simulation with adaptive iteration count
  while (totalIterations < maxIterations && !converged) {
    const batchSize = Math.min(N, maxIterations - totalIterations);
    
    for (let iter = 0; iter < batchSize; iter++) {
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

      // Use track-specific pit lane time with variation
      const pitDeltaSeconds = sampleGaussian(pitLaneTimeLoss, 1.5);

      const freshTyreGainPerLap = sampleGaussian(0.35 + undercutFactor * 0.2, 0.05);
      const lapsOnFreshTyre = totalLaps - candidateLap;
      const freshTyreGain = freshTyreGainPerLap * lapsOnFreshTyre;

      const deg = (tyreAge + (candidateLap - currentLap)) * 0.05 + noisyUrgency / 100;
      const stayCost = deg * (lapsOnFreshTyre * 0.4);

      const gain = freshTyreGain - pitDeltaSeconds + stayCost + scBonus * pitDeltaSeconds - noisyFuelRisk * 0.05;

      lapGains.push(gain);
      sampledPitLaps.push(candidateLap);
    }
    
    totalIterations += batchSize;
    
    // Check convergence
    if (lapGains.length >= 500) {
      const currentMean = lapGains.reduce((s, v) => s + v, 0) / lapGains.length;
      const currentStdDev = Math.sqrt(lapGains.reduce((s, v) => s + (v - currentMean) ** 2, 0) / lapGains.length);
      converged = currentStdDev < Math.abs(currentMean) * convergenceThreshold;
      
      // If converged or not using adaptive, break
      if (converged || !adaptiveIterations) break;
    }
  }

  lapGains.sort((a, b) => a - b);
  sampledPitLaps.sort((a, b) => a - b);

  const finalN = lapGains.length;
  const p5 = lapGains[Math.floor(finalN * 0.05)];
  const p95 = lapGains[Math.floor(finalN * 0.95)];
  const meanGain = lapGains.reduce((s, v) => s + v, 0) / finalN;
  const stdDev = Math.sqrt(lapGains.reduce((s, v) => s + (v - meanGain) ** 2, 0) / finalN);

  const p5Lap = sampledPitLaps[Math.floor(finalN * 0.05)];
  const p95Lap = sampledPitLaps[Math.floor(finalN * 0.95)];
  const medianLap = sampledPitLaps[Math.floor(finalN * 0.5)];

  // Final convergence check
  converged = stdDev < Math.abs(meanGain) * convergenceThreshold;

  return {
    optimalPitLap: medianLap,
    confidenceInterval: [p5Lap, p95Lap],
    iterations: totalIterations,
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

function computeConfidenceScore(scores: Record<StrategyRecommendationLabel, number>, mcResult?: MonteCarloResult | null): number {
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

    // Enhanced tyre urgency with compound and track info
    const tyreUrgency = tyreUrgencyScore(
      input.tyreAgeLaps,
      input.tyreCompound,
      input.trackId ?? null
    );
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

    // Enhanced Monte Carlo with track-specific data
    const mcResult = runMonteCarloSimulation({
      currentLap: input.currentLap,
      totalLaps: input.totalLaps,
      tyreAgeLaps: input.tyreAgeLaps,
      tyreUrgencyScore: tyreUrgency,
      fuelRiskScore: fuelRisk,
      undercutScore: advanced.undercutScore,
      trackId: input.trackId,
      iterations: 800,
      adaptiveIterations: true,
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
}
