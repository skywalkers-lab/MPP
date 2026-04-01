export function getLapsRemaining(input) {
    if (input.totalLaps == null || input.currentLap == null)
        return null;
    const remaining = input.totalLaps - input.currentLap;
    return remaining < 0 ? 0 : remaining;
}
export function tyreUrgencyScore(tyreAgeLaps) {
    if (tyreAgeLaps == null || !Number.isFinite(tyreAgeLaps))
        return null;
    if (tyreAgeLaps <= 10)
        return 25;
    if (tyreAgeLaps <= 15)
        return 45;
    if (tyreAgeLaps <= 20)
        return 65;
    if (tyreAgeLaps <= 25)
        return 80;
    return 95;
}
export function fuelRiskScore(input) {
    const fuelLapsRemaining = input.fuelLapsRemaining;
    if (fuelLapsRemaining == null || !Number.isFinite(fuelLapsRemaining))
        return null;
    const lapsRemaining = getLapsRemaining(input);
    if (lapsRemaining != null) {
        const margin = fuelLapsRemaining - lapsRemaining;
        if (margin < 0)
            return 95;
        if (margin < 1)
            return 80;
        if (margin < 2)
            return 65;
        if (margin < 4)
            return 45;
        return 20;
    }
    if (fuelLapsRemaining <= 2)
        return 90;
    if (fuelLapsRemaining <= 4)
        return 70;
    if (fuelLapsRemaining <= 6)
        return 55;
    return 30;
}
export function stintProgress(input) {
    if (input.currentLap == null || input.totalLaps == null || input.totalLaps <= 0)
        return null;
    const ratio = input.currentLap / input.totalLaps;
    if (!Number.isFinite(ratio))
        return null;
    return Math.max(0, Math.min(1, ratio));
}
export function pitWindowHint(tyreUrgency, stintRatio) {
    if (tyreUrgency == null)
        return 'unknown';
    if (tyreUrgency >= 85)
        return 'open_now';
    if (tyreUrgency >= 70)
        return 'open_soon';
    if (stintRatio != null && stintRatio < 0.3)
        return 'too_early';
    return 'monitor';
}
export function rejoinRiskHint(position) {
    if (position == null || !Number.isFinite(position))
        return 'unknown';
    if (position <= 5)
        return 'low';
    if (position <= 12)
        return 'medium';
    return 'high';
}
