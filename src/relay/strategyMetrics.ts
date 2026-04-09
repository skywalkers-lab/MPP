import { StrategyEngineInput } from './strategy.js';

export function getLapsRemaining(input: StrategyEngineInput): number | null {
  if (input.totalLaps == null || input.currentLap == null) return null;
  const remaining = input.totalLaps - input.currentLap;
  return remaining < 0 ? 0 : remaining;
}

export function tyreUrgencyScore(tyreAgeLaps: number | null): number | null {
  if (tyreAgeLaps == null || !Number.isFinite(tyreAgeLaps)) return null;
  if (tyreAgeLaps <= 10) return 25;
  if (tyreAgeLaps <= 15) return 45;
  if (tyreAgeLaps <= 20) return 65;
  if (tyreAgeLaps <= 25) return 80;
  return 95;
}

export function fuelRiskScore(input: StrategyEngineInput): number | null {
  const fuelLapsRemaining = input.fuelLapsRemaining;
  if (fuelLapsRemaining == null || !Number.isFinite(fuelLapsRemaining)) return null;

  const lapsRemaining = getLapsRemaining(input);
  if (lapsRemaining != null) {
    const margin = fuelLapsRemaining - lapsRemaining;
    if (margin < 0) return 95;
    if (margin < 1) return 80;
    if (margin < 2) return 65;
    if (margin < 4) return 45;
    return 20;
  }

  if (fuelLapsRemaining <= 2) return 90;
  if (fuelLapsRemaining <= 4) return 70;
  if (fuelLapsRemaining <= 6) return 55;
  return 30;
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
