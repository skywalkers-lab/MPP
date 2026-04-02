import {
  StrategyEngineInput,
  StrategyEvaluationResult,
  StrategyRecommendationResult,
  StrategyRecommendationLabel,
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
      reasons.push('tyre age above pit threshold');
    }

    if (fuelRisk != null && fuelRisk >= 65) {
      reasons.push('fuel laps remaining below safe margin');
    }

    if (rejoinHint === 'high') {
      reasons.push('rejoin traffic risk estimated high from current position');
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
        reasons.push('undercut score indicates pit gain potential in current window');
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
        reasons.push('overcut score is favorable while rejoin traffic risk remains high');
      }
    }

    if (reasons.length === 0) {
      reasons.push('no critical strategy risk signal detected');
    }

    const result: StrategyRecommendationResult = {
      strategyUnavailable: false,
      recommendation,
      primaryRecommendation: recommendation,
      secondaryRecommendation,
      severity,
      reasons,
      signals: {
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
        expectedRejoinBand: advanced.expectedRejoinBand,
        cleanAirProbability: advanced.cleanAirProbability,
      },
      generatedAt: input.generatedAt,
    };

    return result;
  }
}
