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
    fuelRemaining: 14,
    fuelLapsRemaining: 22,
    pitStatus: null,
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
});
