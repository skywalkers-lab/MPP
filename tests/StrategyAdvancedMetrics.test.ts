import {
  computeAdvancedStrategyScores,
  degradationTrend,
  overcutScore,
  trafficRiskScore,
  undercutScore,
} from '../src/relay/strategyAdvancedMetrics';

describe('StrategyAdvancedMetrics v2', () => {
  it('undercutScore rises with high tyre urgency and open pit window', () => {
    const low = undercutScore({
      tyreUrgencyScore: 45,
      stintProgress: 0.3,
      pitWindowHint: 'monitor',
      trafficRiskScore: 40,
      fuelRiskScore: 30,
    });

    const high = undercutScore({
      tyreUrgencyScore: 90,
      stintProgress: 0.7,
      pitWindowHint: 'open_now',
      trafficRiskScore: 35,
      fuelRiskScore: 25,
    });

    expect((high || 0)).toBeGreaterThan(low || 0);
  });

  it('overcutScore is relatively higher when degradation is gentle and traffic risk is high', () => {
    const conservative = overcutScore({
      tyreUrgencyScore: 55,
      degradationTrend: 50,
      trafficRiskScore: 80,
      fuelRiskScore: 20,
      pitWindowHint: 'monitor',
    });

    const aggressivePit = overcutScore({
      tyreUrgencyScore: 88,
      degradationTrend: 82,
      trafficRiskScore: 30,
      fuelRiskScore: 20,
      pitWindowHint: 'open_now',
    });

    expect((conservative || 0)).toBeGreaterThan(aggressivePit || 0);
  });

  it('trafficRiskScore is higher for deeper rejoin band positions', () => {
    const front = trafficRiskScore(4, 'low');
    const back = trafficRiskScore(17, 'high');

    expect((back || 0)).toBeGreaterThan(front || 0);
  });

  it('degradationTrend increases as tyre age pressure proxy rises', () => {
    const mild = degradationTrend(45, 0.4);
    const steep = degradationTrend(90, 0.8);

    expect((steep || 0)).toBeGreaterThan(mild || 0);
  });

  it('computeAdvancedStrategyScores returns coherent composite fields', () => {
    const scores = computeAdvancedStrategyScores({
      base: {
        sessionId: 'S',
        relayStatus: 'active',
        isStale: false,
        hasSnapshot: true,
        latestSequence: 1,
        currentLap: 20,
        totalLaps: 58,
        position: 12,
        tyreAgeLaps: 18,
        fuelRemaining: 20,
        fuelLapsRemaining: 24,
        pitStatus: null,
        generatedAt: Date.now(),
      },
      tyreUrgencyScore: 70,
      fuelRiskScore: 40,
      stintProgress: 0.5,
      pitWindowHint: 'open_soon',
      rejoinRiskHint: 'medium',
    });

    expect(scores.undercutScore).not.toBeNull();
    expect(scores.overcutScore).not.toBeNull();
    expect(scores.expectedRejoinBand).not.toBe('unknown');
    expect(scores.cleanAirProbability).not.toBeNull();
  });
});
