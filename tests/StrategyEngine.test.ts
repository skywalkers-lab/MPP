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
});
