function clampScore(v) {
    return Math.max(0, Math.min(100, Math.round(v)));
}
export function scoreBand(score) {
    if (score == null || !Number.isFinite(score))
        return 'unknown';
    if (score >= 85)
        return 'critical';
    if (score >= 65)
        return 'high';
    if (score >= 40)
        return 'medium';
    return 'low';
}
export function trafficRiskScore(position, rejoinRiskHint) {
    if (rejoinRiskHint === 'unknown' || position == null)
        return null;
    let base = 35;
    if (rejoinRiskHint === 'medium')
        base = 55;
    if (rejoinRiskHint === 'high')
        base = 78;
    // Mid-pack and back-pack are more likely to rejoin into clusters.
    if (position >= 8 && position <= 14)
        base += 8;
    if (position > 14)
        base += 12;
    return clampScore(base);
}
export function degradationTrend(tyreUrgencyScore, stintProgress) {
    if (tyreUrgencyScore == null)
        return null;
    const stintFactor = stintProgress == null ? 0.5 : stintProgress;
    const score = tyreUrgencyScore * 0.7 + stintFactor * 30;
    return clampScore(score);
}
export function pitLossHeuristic(input) {
    if (input.position == null || !Number.isFinite(input.position))
        return null;
    let score = 35;
    if (input.position >= 8 && input.position <= 14)
        score += 10;
    if (input.position > 14)
        score += 14;
    if (input.trafficRiskScore != null) {
        score += input.trafficRiskScore * 0.35;
    }
    if (input.pitWindowHint === 'too_early')
        score += 18;
    if (input.pitWindowHint === 'open_now')
        score -= 12;
    if (input.currentLap != null &&
        input.totalLaps != null &&
        input.totalLaps > 0) {
        const progress = input.currentLap / input.totalLaps;
        if (progress > 0.8)
            score -= 12;
        if (progress < 0.25)
            score += 10;
    }
    return clampScore(score);
}
export function compoundStintBias(input) {
    if (!input.tyreCompound)
        return null;
    const compound = input.tyreCompound.toLowerCase();
    let score = 50;
    if (compound.includes('hard') || compound === 'h')
        score += 14;
    if (compound.includes('medium') || compound === 'm')
        score += 5;
    if (compound.includes('soft') || compound === 's')
        score -= 10;
    if (input.tyreUrgencyScore != null) {
        score += Math.max(-20, Math.min(20, 65 - input.tyreUrgencyScore));
    }
    if (input.stintProgress != null) {
        if (input.stintProgress < 0.35)
            score += 10;
        if (input.stintProgress > 0.8)
            score -= 12;
    }
    return clampScore(score);
}
export function undercutScore(input) {
    if (input.tyreUrgencyScore == null)
        return null;
    let score = input.tyreUrgencyScore * 0.55;
    score += (input.stintProgress ?? 0.5) * 20;
    if (input.pitWindowHint === 'open_now')
        score += 18;
    else if (input.pitWindowHint === 'open_soon')
        score += 10;
    else if (input.pitWindowHint === 'too_early')
        score -= 18;
    if (input.trafficRiskScore != null) {
        score -= input.trafficRiskScore * 0.25;
    }
    if (input.fuelRiskScore != null && input.fuelRiskScore >= 80) {
        // Extremely high fuel risk means pit strategy advantage is less meaningful.
        score -= 8;
    }
    return clampScore(score);
}
export function overcutScore(input) {
    const tyre = input.tyreUrgencyScore;
    const deg = input.degradationTrend;
    if (tyre == null || deg == null)
        return null;
    let score = 45;
    // Overcut is stronger when tyre/degradation is still manageable.
    score += Math.max(0, 60 - tyre) * 0.35;
    score += Math.max(0, 65 - deg) * 0.25;
    // If rejoin traffic is risky, staying out a bit can be beneficial.
    if (input.trafficRiskScore != null) {
        score += input.trafficRiskScore * 0.3;
    }
    if (input.pitWindowHint === 'open_now')
        score -= 12;
    if (input.pitWindowHint === 'too_early')
        score += 8;
    if (input.fuelRiskScore != null && input.fuelRiskScore >= 70) {
        score -= 20;
    }
    return clampScore(score);
}
export function cleanAirProbability(trafficRiskScore) {
    if (trafficRiskScore == null)
        return null;
    return clampScore(100 - trafficRiskScore);
}
export function expectedRejoinBand(trafficRiskScore) {
    return scoreBand(trafficRiskScore);
}
export function computeAdvancedStrategyScores(input) {
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
        pitLossHeuristic: pitLoss,
        compoundStintBias: bias,
        expectedRejoinBand: expectedRejoinBand(traffic),
        cleanAirProbability: cleanAirProbability(traffic),
    };
}
