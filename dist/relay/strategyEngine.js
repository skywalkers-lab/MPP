import { fuelRiskScore, getLapsRemaining, pitWindowHint, rejoinRiskHint, stintProgress, tyreUrgencyScore, } from './strategyMetrics';
export class StrategyEngine {
    evaluate(input) {
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
        if (input.currentLap == null &&
            input.tyreAgeLaps == null &&
            input.fuelLapsRemaining == null) {
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
        const reasons = [];
        if (tyreUrgency != null && tyreUrgency >= 75) {
            reasons.push('tyre age above pit threshold');
        }
        if (fuelRisk != null && fuelRisk >= 65) {
            reasons.push('fuel laps remaining below safe margin');
        }
        if (rejoinHint === 'high') {
            reasons.push('rejoin traffic risk estimated high from current position');
        }
        let recommendation = 'STAY OUT';
        let severity = 'info';
        if (fuelRisk != null && fuelRisk >= 85) {
            recommendation = 'FUEL RISK HIGH';
            severity = 'critical';
        }
        else if (tyreUrgency != null && tyreUrgency >= 95) {
            recommendation = 'TYRE LIFE CRITICAL';
            severity = 'critical';
        }
        else if (tyreUrgency != null && tyreUrgency >= 85 && rejoinHint !== 'high') {
            recommendation = 'PIT NOW';
            severity = 'warning';
        }
        else if (tyreUrgency != null && tyreUrgency >= 70) {
            recommendation = 'BOX IN 2 LAPS';
            severity = 'caution';
        }
        else if (rejoinHint === 'high' && tyreUrgency != null && tyreUrgency >= 60) {
            recommendation = 'TRAFFIC RISK HIGH';
            severity = 'caution';
        }
        if (reasons.length === 0) {
            reasons.push('no critical strategy risk signal detected');
        }
        return {
            strategyUnavailable: false,
            recommendation,
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
            },
            generatedAt: input.generatedAt,
        };
    }
}
