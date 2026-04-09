import { StrategyEngineInput } from './strategy';

export function getLapsRemaining(input: StrategyEngineInput): number | null {
  if (input.totalLaps == null || input.currentLap == null) return null;
  const remaining = input.totalLaps - input.currentLap;
  return remaining < 0 ? 0 : remaining;
}

/**
 * Expected tyre life by compound (in laps) - used for dynamic urgency calculation
 * These are baseline values that can be adjusted based on track characteristics
 */
export interface TyreLifeConfig {
  soft: { optimal: number; warning: number; critical: number };
  medium: { optimal: number; warning: number; critical: number };
  hard: { optimal: number; warning: number; critical: number };
  intermediate: { optimal: number; warning: number; critical: number };
  wet: { optimal: number; warning: number; critical: number };
}

const DEFAULT_TYRE_LIFE: TyreLifeConfig = {
  soft: { optimal: 12, warning: 18, critical: 24 },
  medium: { optimal: 18, warning: 26, critical: 34 },
  hard: { optimal: 25, warning: 35, critical: 45 },
  intermediate: { optimal: 20, warning: 28, critical: 38 },
  wet: { optimal: 25, warning: 35, critical: 45 },
};

/**
 * Track-specific tyre wear multipliers (1.0 = baseline)
 * Higher values = faster tyre wear
 */
export const TRACK_WEAR_MULTIPLIERS: Record<number, number> = {
  0: 1.1,   // Melbourne - high degradation
  1: 1.15,  // Paul Ricard
  2: 0.95,  // Shanghai - medium
  3: 1.2,   // Bahrain - high
  4: 1.0,   // Catalunya
  5: 1.25,  // Monaco - high with walls
  6: 0.9,   // Montreal
  7: 1.15,  // Silverstone - high speed
  8: 0.85,  // Hockenheim - low
  9: 1.1,   // Hungaroring - high
  10: 1.0,  // Spa
  11: 1.3,  // Monza - heavy braking zones
  12: 1.15, // Singapore - street circuit
  13: 1.0,  // Suzuka
  14: 1.1,  // Abu Dhabi
  15: 1.2,  // Austin - high
  16: 1.0,  // Brazil
  17: 1.2,  // Austria - short but aggressive
  18: 1.0,  // Sochi
  19: 1.0,  // Mexico
  20: 1.1,  // Baku - street circuit
  21: 1.2,  // Saudi Arabia - high speed street
  22: 1.1,  // Miami
  23: 1.0,  // Las Vegas
  24: 1.1,  // Qatar
};

function parseCompound(tyreCompound: string | null | undefined): keyof TyreLifeConfig {
  if (!tyreCompound) return 'medium';
  const lower = tyreCompound.toLowerCase();
  if (lower.includes('soft') || lower === 's') return 'soft';
  if (lower.includes('hard') || lower === 'h') return 'hard';
  if (lower.includes('inter') || lower === 'i') return 'intermediate';
  if (lower.includes('wet') || lower === 'w') return 'wet';
  return 'medium';
}

/**
 * Enhanced tyre urgency score that considers:
 * - Tyre compound expected life
 * - Track-specific wear characteristics
 * - Actual degradation data if available
 */
export function tyreUrgencyScore(
  tyreAgeLaps: number | null,
  tyreCompound?: string | null,
  trackId?: number | null,
  recentDegradation?: number | null // percentage performance drop from stint start
): number | null {
  if (tyreAgeLaps == null || !Number.isFinite(tyreAgeLaps)) return null;
  
  const compound = parseCompound(tyreCompound);
  const lifeConfig = DEFAULT_TYRE_LIFE[compound];
  const wearMultiplier = (trackId != null && TRACK_WEAR_MULTIPLIERS[trackId]) 
    ? TRACK_WEAR_MULTIPLIERS[trackId] 
    : 1.0;
  
  // Adjust expected life by track wear multiplier
  const adjustedOptimal = lifeConfig.optimal / wearMultiplier;
  const adjustedWarning = lifeConfig.warning / wearMultiplier;
  const adjustedCritical = lifeConfig.critical / wearMultiplier;
  
  // Base score from age vs expected life
  let baseScore: number;
  if (tyreAgeLaps <= adjustedOptimal * 0.6) {
    baseScore = 20 + (tyreAgeLaps / (adjustedOptimal * 0.6)) * 15;
  } else if (tyreAgeLaps <= adjustedOptimal) {
    const ratio = (tyreAgeLaps - adjustedOptimal * 0.6) / (adjustedOptimal * 0.4);
    baseScore = 35 + ratio * 15;
  } else if (tyreAgeLaps <= adjustedWarning) {
    const ratio = (tyreAgeLaps - adjustedOptimal) / (adjustedWarning - adjustedOptimal);
    baseScore = 50 + ratio * 25;
  } else if (tyreAgeLaps <= adjustedCritical) {
    const ratio = (tyreAgeLaps - adjustedWarning) / (adjustedCritical - adjustedWarning);
    baseScore = 75 + ratio * 15;
  } else {
    baseScore = 90 + Math.min(10, (tyreAgeLaps - adjustedCritical) * 2);
  }
  
  // Adjust by actual degradation if available
  if (recentDegradation != null && Number.isFinite(recentDegradation)) {
    // If degradation is higher than expected, increase urgency
    const expectedDegradation = (tyreAgeLaps / adjustedCritical) * 8; // ~8% at critical
    const degradationDelta = recentDegradation - expectedDegradation;
    baseScore += degradationDelta * 3; // Each 1% extra degradation adds 3 points
  }
  
  return Math.max(0, Math.min(100, Math.round(baseScore)));
}

// Legacy function for backwards compatibility
export function tyreUrgencyScoreSimple(tyreAgeLaps: number | null): number | null {
  if (tyreAgeLaps == null || !Number.isFinite(tyreAgeLaps)) return null;
  if (tyreAgeLaps <= 10) return 25;
  if (tyreAgeLaps <= 15) return 45;
  if (tyreAgeLaps <= 20) return 65;
  if (tyreAgeLaps <= 25) return 80;
  return 95;
}

/**
 * Fuel consumption trend tracker for more accurate fuel risk prediction
 */
export interface FuelConsumptionTrend {
  avgConsumptionPerLap: number;     // kg per lap
  recentConsumptionPerLap: number;  // last 3 laps average
  trend: 'increasing' | 'stable' | 'decreasing';
  confidenceLevel: number;          // 0-1, higher = more data points
}

export function analyzeFuelConsumptionTrend(
  fuelHistory: Array<{ lap: number; fuel: number }>
): FuelConsumptionTrend | null {
  if (fuelHistory.length < 2) return null;
  
  // Calculate overall average
  const consumptions: number[] = [];
  for (let i = 1; i < fuelHistory.length; i++) {
    const consumption = fuelHistory[i - 1].fuel - fuelHistory[i].fuel;
    if (consumption > 0) consumptions.push(consumption);
  }
  
  if (consumptions.length === 0) return null;
  
  const avgConsumption = consumptions.reduce((a, b) => a + b, 0) / consumptions.length;
  
  // Calculate recent average (last 3 laps)
  const recentConsumptions = consumptions.slice(-3);
  const recentAvg = recentConsumptions.reduce((a, b) => a + b, 0) / recentConsumptions.length;
  
  // Determine trend
  let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
  const delta = recentAvg - avgConsumption;
  if (delta > avgConsumption * 0.1) trend = 'increasing';
  else if (delta < -avgConsumption * 0.1) trend = 'decreasing';
  
  return {
    avgConsumptionPerLap: avgConsumption,
    recentConsumptionPerLap: recentAvg,
    trend,
    confidenceLevel: Math.min(1, consumptions.length / 10),
  };
}

/**
 * Enhanced fuel risk score that considers:
 * - Fuel margin vs laps remaining
 * - Consumption trend (aggressive driving, fuel saving mode)
 * - Safety car impact on fuel saving
 */
export function fuelRiskScore(
  input: StrategyEngineInput,
  fuelTrend?: FuelConsumptionTrend | null,
  isSafetyCarActive?: boolean
): number | null {
  const fuelLapsRemaining = input.fuelLapsRemaining;
  if (fuelLapsRemaining == null || !Number.isFinite(fuelLapsRemaining)) return null;

  const lapsRemaining = getLapsRemaining(input);
  let baseScore: number;
  
  if (lapsRemaining != null) {
    const margin = fuelLapsRemaining - lapsRemaining;
    if (margin < 0) baseScore = 95;
    else if (margin < 1) baseScore = 80;
    else if (margin < 2) baseScore = 65;
    else if (margin < 4) baseScore = 45;
    else baseScore = 20;
  } else {
    if (fuelLapsRemaining <= 2) baseScore = 90;
    else if (fuelLapsRemaining <= 4) baseScore = 70;
    else if (fuelLapsRemaining <= 6) baseScore = 55;
    else baseScore = 30;
  }
  
  // Adjust for fuel consumption trend
  if (fuelTrend) {
    if (fuelTrend.trend === 'increasing') {
      // Aggressive driving - increase risk
      const trendPenalty = 5 + (fuelTrend.confidenceLevel * 10);
      baseScore = Math.min(100, baseScore + trendPenalty);
    } else if (fuelTrend.trend === 'decreasing') {
      // Fuel saving mode - reduce risk
      const trendBonus = 3 + (fuelTrend.confidenceLevel * 7);
      baseScore = Math.max(0, baseScore - trendBonus);
    }
  }
  
  // Safety car reduces fuel consumption significantly
  if (isSafetyCarActive) {
    baseScore = Math.max(0, baseScore - 15);
  }
  
  return Math.max(0, Math.min(100, Math.round(baseScore)));
}

export function stintProgress(input: StrategyEngineInput): number | null {
  if (input.currentLap == null || input.totalLaps == null || input.totalLaps <= 0) return null;
  const ratio = input.currentLap / input.totalLaps;
  if (!Number.isFinite(ratio)) return null;
  return Math.max(0, Math.min(1, ratio));
}

export function pitWindowHint(
  tyreUrgency: number | null,
  stintRatio: number | null
): 'open_now' | 'open_soon' | 'monitor' | 'too_early' | 'unknown' {
  if (tyreUrgency == null) return 'unknown';
  if (tyreUrgency >= 85) return 'open_now';
  if (tyreUrgency >= 70) return 'open_soon';
  if (stintRatio != null && stintRatio < 0.3) return 'too_early';
  return 'monitor';
}

export function rejoinRiskHint(position: number | null): 'low' | 'medium' | 'high' | 'unknown' {
  if (position == null || !Number.isFinite(position)) return 'unknown';
  if (position <= 5) return 'low';
  if (position <= 12) return 'medium';
  return 'high';
}

export interface TyreDegradationModel {
  params: { a: number; b: number; c: number };
  predict(lap: number): number;
  residualStintLaps(currentLap: number, threshold?: number): number;
}

export function fitPolynomialTyreDegradation(
  lapTimes: number[],
  tyreAgeLaps: number | null
): TyreDegradationModel {
  const baseAge = tyreAgeLaps ?? 0;
  let a = 0;
  let b = 0.05;
  let c = lapTimes.length > 0 ? lapTimes[0] : 90;

  if (lapTimes.length >= 3) {
    const n = lapTimes.length;
    const xs: number[] = lapTimes.map((_, i) => baseAge + i);
    const ys: number[] = lapTimes;

    let sumX = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0;
    let sumY = 0, sumXY = 0, sumX2Y = 0;

    for (let i = 0; i < n; i++) {
      const x = xs[i];
      const y = ys[i];
      sumX += x; sumX2 += x * x; sumX3 += x * x * x; sumX4 += x * x * x * x;
      sumY += y; sumXY += x * y; sumX2Y += x * x * y;
    }

    const det = n * (sumX2 * sumX4 - sumX3 * sumX3)
      - sumX * (sumX * sumX4 - sumX3 * sumX2)
      + sumX2 * (sumX * sumX3 - sumX2 * sumX2);

    if (Math.abs(det) > 1e-10) {
      c = (sumY * (sumX2 * sumX4 - sumX3 * sumX3)
        - sumX * (sumXY * sumX4 - sumX2Y * sumX3)
        + sumX2 * (sumXY * sumX3 - sumX2Y * sumX2)) / det;
      b = (n * (sumXY * sumX4 - sumX2Y * sumX3)
        - sumY * (sumX * sumX4 - sumX3 * sumX2)
        + sumX2 * (sumX * sumX2Y - sumXY * sumX2)) / det;
      a = (n * (sumX2 * sumX2Y - sumX3 * sumXY)
        - sumX * (sumX * sumX2Y - sumXY * sumX2)
        + sumY * (sumX * sumX3 - sumX2 * sumX2)) / det;
    }
  } else if (lapTimes.length === 2) {
    const x0 = baseAge, x1 = baseAge + 1;
    b = Math.max(0, lapTimes[1] - lapTimes[0]);
    c = lapTimes[0] - b * x0;
    a = 0;
  }

  const params = { a, b, c };

  function predict(lap: number): number {
    return params.a * lap * lap + params.b * lap + params.c;
  }

  function residualStintLaps(currentLap: number, threshold = 7): number {
    const baseline = predict(currentLap);
    const degradeLimit = baseline * (1 + threshold / 100);
    for (let extra = 1; extra <= 50; extra++) {
      if (predict(currentLap + extra) >= degradeLimit) return extra - 1;
    }
    return 50;
  }

  return { params, predict, residualStintLaps };
}

export function pitWindowHintFromModel(
  model: TyreDegradationModel,
  currentTyreLap: number,
  threshold = 7
): 'open_now' | 'open_soon' | 'monitor' | 'too_early' | 'unknown' {
  const remaining = model.residualStintLaps(currentTyreLap, threshold);
  if (remaining <= 1) return 'open_now';
  if (remaining <= 3) return 'open_soon';
  if (remaining <= 8) return 'monitor';
  return 'too_early';
}
