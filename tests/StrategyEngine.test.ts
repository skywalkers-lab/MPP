import { StrategyEngine } from '../src/relay/strategyEngine';
import { StrategyEngineInput } from '../src/relay/strategy';

function baseInput(overrides: Partial<StrategyEngineInput> = {}): StrategyEngineInput {
  return {
    sessionId: 'S-STRAT',
    relayStatus: 'active',
    isStale: false,
    hasSnapshot: true,
    latestSequence: 10,
    currentLap: 20,
    totalLaps: 58,
    position: 9,
    tyreAgeLaps: 12,
    fuelRemaining: 60,
    fuelLapsRemaining: 70,
    pitStatus: null,
    tyreCompound: 'M',
    ersPercent: null,
    recentLapTimesMs: [],
    rivals: [],
    generatedAt: 1700000000000,
    ...overrides,
  };
}

describe('StrategyEngine v1', () => {
  const engine = new StrategyEngine();

  it('raises pit urgency when tyre age is high', () => {
    const normal = engine.evaluate(baseInput({ tyreAgeLaps: 12 }));
    const high = engine.evaluate(baseInput({ tyreAgeLaps: 28, position: 4 }));

    expect(normal.strategyUnavailable).toBe(false);
    expect(high.strategyUnavailable).toBe(false);

    if (!normal.strategyUnavailable && !high.strategyUnavailable) {
      expect(high.signals.tyreUrgencyScore).toBeGreaterThan(normal.signals.tyreUrgencyScore || 0);
      expect(['PIT NOW', 'TYRE LIFE CRITICAL']).toContain(high.recommendation);
    }
  });

  it('detects high fuel risk when fuel laps remaining is below safe margin', () => {
    const lowFuel = engine.evaluate(
      baseInput({
        currentLap: 53,
        totalLaps: 58,
        fuelLapsRemaining: 2,
      })
    );

    expect(lowFuel.strategyUnavailable).toBe(false);
    if (!lowFuel.strategyUnavailable) {
      expect(lowFuel.recommendation).toBe('FUEL RISK HIGH');
      expect(lowFuel.severity).toBe('critical');
      expect(lowFuel.reasons.some((r) => r.includes('fuel laps remaining'))).toBe(true);
      expect((lowFuel.signals.fuelRiskScore || 0)).toBeGreaterThanOrEqual(85);
    }
  });

  it('returns unavailable when snapshot is missing', () => {
    const result = engine.evaluate(baseInput({ hasSnapshot: false }));

    expect(result.strategyUnavailable).toBe(true);
    if (result.strategyUnavailable) {
      expect(result.reason).toBe('no_snapshot');
    }
  });

  it('returns unavailable when session is stale', () => {
    const result = engine.evaluate(baseInput({ isStale: true, relayStatus: 'stale' }));

    expect(result.strategyUnavailable).toBe(true);
    if (result.strategyUnavailable) {
      expect(result.reason).toBe('session_stale');
    }
  });

  it('includes v2 advanced signals when strategy is available', () => {
    const result = engine.evaluate(baseInput({ tyreAgeLaps: 20, position: 11 }));
    expect(result.strategyUnavailable).toBe(false);

    if (!result.strategyUnavailable) {
      expect(result.primaryRecommendation).toBeDefined();
      expect(result.confidenceScore).not.toBeNull();
      expect(result.stabilityScore).not.toBeNull();
      expect(typeof result.recommendationChanged).toBe('boolean');
      expect(typeof result.trendReason).toBe('string');
      expect(result.signals).toHaveProperty('undercutScore');
      expect(result.signals).toHaveProperty('overcutScore');
      expect(result.signals).toHaveProperty('trafficRiskScore');
      expect(result.signals).toHaveProperty('degradationTrend');
      expect(result.signals).toHaveProperty('pitLossHeuristic');
      expect(result.signals).toHaveProperty('compoundStintBias');
      expect(result.signals).toHaveProperty('expectedRejoinBand');
      expect(result.signals).toHaveProperty('cleanAirProbability');
    }
  });

  it('marks recommendation change and trend when previous strategy context exists', () => {
    const previous = engine.evaluate(baseInput({ tyreAgeLaps: 10, fuelLapsRemaining: 25 }));
    const current = engine.evaluate(
      baseInput({
        tyreAgeLaps: 27,
        fuelLapsRemaining: 8,
        previousStrategy:
          previous.strategyUnavailable
            ? null
            : {
                recommendation: previous.recommendation,
                secondaryRecommendation: previous.secondaryRecommendation,
                severity: previous.severity,
                confidenceScore: previous.confidenceScore,
                stabilityScore: previous.stabilityScore,
                signals: previous.signals,
                generatedAt: previous.generatedAt,
              },
      })
    );

    expect(current.strategyUnavailable).toBe(false);
    if (!current.strategyUnavailable) {
      expect(typeof current.recommendationChanged).toBe('boolean');
      expect(current.trendReason).toBeTruthy();
    }
  });

  it('prefers overcut-style output when traffic risk is high and degradation is still manageable', () => {
    const result = engine.evaluate(
      baseInput({
        tyreAgeLaps: 14,
        position: 16,
        currentLap: 22,
        totalLaps: 58,
        fuelLapsRemaining: 50,
      })
    );

    expect(result.strategyUnavailable).toBe(false);
    if (!result.strategyUnavailable) {
      expect(result.signals.trafficRiskScore == null ? 0 : result.signals.trafficRiskScore).toBeGreaterThanOrEqual(65);
      expect(result.secondaryRecommendation).toBeDefined();
    }
  });

  it('stabilizes recommendation confidence during canonical session sync window', () => {
    const baseline = engine.evaluate(
      baseInput({
        tyreAgeLaps: 26,
        position: 3,
        fuelLapsRemaining: 9,
      })
    );

    expect(baseline.strategyUnavailable).toBe(false);
    if (baseline.strategyUnavailable) {
      return;
    }

    const synced = engine.evaluate(
      baseInput({
        tyreAgeLaps: 27,
        position: 3,
        fuelLapsRemaining: 8,
        previousStrategy: {
          recommendation: 'STAY OUT',
          secondaryRecommendation: undefined,
          severity: 'info',
          confidenceScore: 70,
          stabilityScore: 70,
          signals: {},
          generatedAt: baseInput().generatedAt - 2500,
        },
        syncingCanonicalSession: true,
        syncingUntil: baseInput().generatedAt + 5000,
      })
    );

    expect(synced.strategyUnavailable).toBe(false);
    if (!synced.strategyUnavailable) {
      expect(synced.confidenceScore == null ? 0 : synced.confidenceScore).toBeLessThanOrEqual(55);
      expect(synced.stabilityScore == null ? 0 : synced.stabilityScore).toBeLessThanOrEqual(45);
      expect(synced.recommendationChanged).toBe(false);
      expect(synced.reasons.some((r) => r.includes('canonical session'))).toBe(true);
    }
  });
});

describe('StrategyEngine qualifying mode', () => {
  const engine = new StrategyEngine();

  it('produces out-lap traffic guidance and track map data in qualifying', () => {
    const result = engine.evaluate(baseInput({
      sessionType: 6,
      sessionTimeLeft: 420,
      trackLength: 5400,
      playerCarIndex: 3,
      trafficCars: [
        { carIndex: 3, position: 8, stintAge: 2, tyreCompound: 'S', lapDistance: 0.01, pitStatus: 'PIT_EXIT', driverStatus: 'OUT_LAP', isPlayer: true },
        { carIndex: 1, position: 1, stintAge: 4, tyreCompound: 'S', lapDistance: 0.18, pitStatus: 'NONE', driverStatus: 'FLYING_LAP' },
        { carIndex: 8, position: 11, stintAge: 5, tyreCompound: 'S', lapDistance: 0.62, pitStatus: 'NONE', driverStatus: 'FLYING_LAP' },
      ],
    }));

    expect(result.strategyUnavailable).toBe(false);
    if (!result.strategyUnavailable) {
      expect(result.sessionMode).toBe('qualifying');
      expect(result.qualifying?.sessionPhase).toBe('Q2');
      expect(result.qualifying?.trackMapCars.length).toBeGreaterThanOrEqual(3);
      expect(result.qualifying?.recommendedReleaseInSec).not.toBeNull();
      expect(result.qualifying?.clearLapProbability == null ? -1 : result.qualifying.clearLapProbability).toBeGreaterThanOrEqual(0);
      expect(result.qualifying?.clearLapProbability == null ? 101 : result.qualifying.clearLapProbability).toBeLessThanOrEqual(100);
      expect(['RELEASE NOW', 'HOLD GAP', 'BUILD TYRES', 'TRAFFIC CLUSTER AHEAD']).toContain(result.primaryRecommendation);
    }
  });

  it('recommends waiting when a sector-one queue is forming in qualifying', () => {
    const result = engine.evaluate(baseInput({
      sessionType: 5,
      sessionTimeLeft: 180,
      trackLength: 5200,
      playerCarIndex: 2,
      trafficCars: [
        { carIndex: 2, position: 10, stintAge: 1, tyreCompound: 'S', lapDistance: 0.0, pitStatus: 'PIT_LANE', driverStatus: 'OUT_LAP', isPlayer: true },
        { carIndex: 4, position: 3, stintAge: 3, tyreCompound: 'S', lapDistance: 0.03, pitStatus: 'NONE', driverStatus: 'OUT_LAP' },
        { carIndex: 5, position: 4, stintAge: 4, tyreCompound: 'S', lapDistance: 0.07, pitStatus: 'NONE', driverStatus: 'OUT_LAP' },
        { carIndex: 6, position: 5, stintAge: 5, tyreCompound: 'S', lapDistance: 0.12, pitStatus: 'NONE', driverStatus: 'FLYING_LAP' },
        { carIndex: 7, position: 6, stintAge: 6, tyreCompound: 'S', lapDistance: 0.16, pitStatus: 'NONE', driverStatus: 'FLYING_LAP' },
      ],
    }));

    expect(result.strategyUnavailable).toBe(false);
    if (!result.strategyUnavailable) {
      expect(result.qualifying?.releaseWindow).toBe('wait_for_gap');
      expect(result.qualifying?.recommendedReleaseInSec == null ? 0 : result.qualifying.recommendedReleaseInSec).toBeGreaterThanOrEqual(10);
      expect(result.qualifying?.clearLapProbability == null ? 100 : result.qualifying.clearLapProbability).toBeLessThan(60);
      expect(result.reasons.some((reason) => reason.toLowerCase().includes('out-lap') || reason.toLowerCase().includes('sector 1'))).toBe(true);
    }
  });
});

describe('StrategyEngine Monte Carlo late-race edge cases', () => {
  const engine = new StrategyEngine();

  it('does not produce invalid recommendations in the final 3 laps', () => {
    const lateRace = engine.evaluate(baseInput({
      currentLap: 56,
      totalLaps: 58,
      tyreAgeLaps: 28,
      fuelLapsRemaining: 4,
    }));

    expect(lateRace.strategyUnavailable).toBe(false);
    if (!lateRace.strategyUnavailable) {
      expect(['PIT NOW', 'BOX IN 2 LAPS', 'STAY OUT', 'TYRE LIFE CRITICAL', 'FUEL RISK HIGH', 'TRAFFIC RISK HIGH']).toContain(lateRace.recommendation);
      const simMeta = (lateRace as { simulationMeta?: { optimalPitLap?: number } }).simulationMeta;
      if (simMeta?.optimalPitLap != null) {
        expect(simMeta.optimalPitLap).toBeGreaterThanOrEqual(56);
        expect(simMeta.optimalPitLap).toBeLessThanOrEqual(58);
      }
    }
  });

  it('does not produce negative lapsUntilOptimal in final lap', () => {
    const finalLap = engine.evaluate(baseInput({
      currentLap: 58,
      totalLaps: 58,
      tyreAgeLaps: 32,
      fuelLapsRemaining: 1,
    }));

    expect(finalLap.strategyUnavailable).toBe(false);
    if (!finalLap.strategyUnavailable) {
      const simMeta = (finalLap as { simulationMeta?: { optimalPitLap?: number } }).simulationMeta;
      if (simMeta?.optimalPitLap != null) {
        expect(simMeta.optimalPitLap).toBeGreaterThanOrEqual(58);
      }
    }
  });

  it('handles edge case where pit window open >= totalLaps gracefully', () => {
    const veryLate = engine.evaluate(baseInput({
      currentLap: 57,
      totalLaps: 57,
      tyreAgeLaps: 5,
      fuelLapsRemaining: 1,
    }));

    expect(veryLate.strategyUnavailable).toBe(false);
  });
});
