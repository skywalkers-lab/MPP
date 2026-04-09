import {
  QualiSessionType,
  QualiStrategyRecommendation,
  QualiStrategyResult,
  QualiTrafficPrediction,
  QualiOutlapTiming,
  QualiSessionContext,
  CarTrackPosition,
  TrackZone,
  TrafficDensity,
  DriverLapStatus,
  CarPitStatus,
} from './strategy';

// Session type mapping from F1 UDP spec
const SESSION_TYPE_MAP: Record<number, QualiSessionType | null> = {
  5: 'Q1',
  6: 'Q2',
  7: 'Q3',
};

// Cutoff positions for each session
const CUTOFF_POSITIONS: Record<QualiSessionType, number> = {
  Q1: 15,
  Q2: 10,
  Q3: 20, // No cutoff in Q3
};

interface QualiEngineInput {
  sessionType: number | string | null;
  sessionTimeLeft: number | null;
  trackLength: number | null;
  playerCarIndex: number | null;
  cars: Record<number, CarData>;
  drivers: Record<number, DriverData>;
  isStale?: boolean;
  hasSnapshot?: boolean;
}

interface CarData {
  carIndex: number;
  position?: number | null;
  currentLapNum?: number | null;
  lastLapTime?: number | null;
  bestLapTime?: number | null;
  pitStatus?: string | null;
  lapDistance?: number | null; // 0-1 or meters
  driverStatus?: number | string | null;
}

interface DriverData {
  carIndex: number;
  driverName: string;
}

function mapSessionType(sessionType: number | string | null): QualiSessionType | null {
  if (sessionType == null) return null;
  const num = typeof sessionType === 'string' ? parseInt(sessionType, 10) : sessionType;
  return SESSION_TYPE_MAP[num] ?? null;
}

function mapPitStatus(pitStatus: string | null | undefined): CarPitStatus {
  if (!pitStatus) return 'ON_TRACK';
  const lower = pitStatus.toLowerCase();
  if (lower.includes('pitting') || lower === 'in_pit' || lower === 'in pit') return 'IN_PIT';
  if (lower.includes('entry')) return 'PIT_ENTRY';
  if (lower.includes('exit')) return 'PIT_EXIT';
  return 'ON_TRACK';
}

function mapDriverStatus(status: number | string | null | undefined, pitStatus: CarPitStatus): DriverLapStatus {
  if (pitStatus === 'IN_PIT') return 'IN_GARAGE';
  
  if (typeof status === 'number') {
    // F1 UDP driver status codes
    switch (status) {
      case 0: return 'IN_GARAGE';
      case 1: return 'FLYING_LAP';
      case 2: return 'IN_LAP';
      case 3: return 'OUT_LAP';
      case 4: return 'IN_GARAGE'; // On track, not special
      default: return 'FLYING_LAP';
    }
  }
  
  if (typeof status === 'string') {
    const lower = status.toLowerCase();
    if (lower.includes('flying')) return 'FLYING_LAP';
    if (lower.includes('out')) return 'OUT_LAP';
    if (lower.includes('in_lap') || lower === 'in lap') return 'IN_LAP';
    if (lower.includes('garage')) return 'IN_GARAGE';
  }
  
  return 'FLYING_LAP';
}

function normalizeDistance(distance: number | null | undefined, trackLength: number | null): number {
  if (distance == null) return 0;
  // If distance > 1, assume it's in meters
  if (distance > 1 && trackLength && trackLength > 0) {
    return Math.min(1, Math.max(0, distance / trackLength));
  }
  return Math.min(1, Math.max(0, distance));
}

function computeCarPositions(
  input: QualiEngineInput,
  playerIndex: number | null
): CarTrackPosition[] {
  const positions: CarTrackPosition[] = [];
  
  for (const [indexStr, car] of Object.entries(input.cars)) {
    const carIndex = parseInt(indexStr, 10);
    const driver = input.drivers[carIndex];
    const pitStatus = mapPitStatus(car.pitStatus);
    const driverStatus = mapDriverStatus(car.driverStatus, pitStatus);
    
    // Skip cars that are truly in garage (not visible)
    if (pitStatus === 'IN_PIT' && driverStatus === 'IN_GARAGE') {
      positions.push({
        carIndex,
        driverName: driver?.driverName || `Car ${carIndex}`,
        lapDistance: 0,
        pitStatus,
        driverStatus,
        isPlayer: carIndex === playerIndex,
        currentLapTime: car.lastLapTime,
        bestLapTime: car.bestLapTime,
      });
      continue;
    }
    
    positions.push({
      carIndex,
      driverName: driver?.driverName || `Car ${carIndex}`,
      lapDistance: normalizeDistance(car.lapDistance, input.trackLength),
      pitStatus,
      driverStatus,
      isPlayer: carIndex === playerIndex,
      currentLapTime: car.lastLapTime,
      bestLapTime: car.bestLapTime,
    });
  }
  
  return positions;
}

function analyzeTraffic(
  positions: CarTrackPosition[],
  playerIndex: number | null,
  estimatedLapTime: number
): QualiTrafficPrediction {
  const onTrack = positions.filter(p => p.pitStatus === 'ON_TRACK' || p.pitStatus === 'PIT_EXIT');
  const inPit = positions.filter(p => p.pitStatus === 'IN_PIT' || p.driverStatus === 'IN_GARAGE');
  const onFlyingLap = onTrack.filter(p => p.driverStatus === 'FLYING_LAP');
  const onOutLap = onTrack.filter(p => p.driverStatus === 'OUT_LAP');
  
  const player = positions.find(p => p.isPlayer);
  
  // Compute hot zones (areas with multiple cars)
  const hotZones = computeHotZones(onTrack);
  
  // Compute clear window
  const clearWindowSeconds = computeClearWindow(onTrack, player, estimatedLapTime);
  
  // Classify density
  const density = classifyDensity(onTrack.length, inPit.length);
  
  return {
    clearWindowSeconds,
    carsOnTrack: onTrack.length,
    carsInPit: inPit.length,
    carsOnFlyingLap: onFlyingLap.length,
    carsOnOutLap: onOutLap.length,
    predictedTrafficDensity: density,
    hotZones,
  };
}

function computeHotZones(onTrack: CarTrackPosition[]): TrackZone[] {
  if (onTrack.length < 2) return [];
  
  // Divide track into 10 segments
  const segments = 10;
  const segmentSize = 1 / segments;
  const segmentCounts: number[] = new Array(segments).fill(0);
  
  for (const car of onTrack) {
    const segmentIndex = Math.min(segments - 1, Math.floor(car.lapDistance * segments));
    segmentCounts[segmentIndex]++;
  }
  
  // Find segments with 2+ cars
  const hotZones: TrackZone[] = [];
  for (let i = 0; i < segments; i++) {
    if (segmentCounts[i] >= 2) {
      const start = i * segmentSize;
      const end = (i + 1) * segmentSize;
      
      // Merge with previous zone if adjacent
      if (hotZones.length > 0 && hotZones[hotZones.length - 1].end === start) {
        hotZones[hotZones.length - 1].end = end;
        hotZones[hotZones.length - 1].density += segmentCounts[i];
      } else {
        hotZones.push({ start, end, density: segmentCounts[i] });
      }
    }
  }
  
  return hotZones;
}

function computeClearWindow(
  onTrack: CarTrackPosition[],
  player: CarTrackPosition | undefined,
  estimatedLapTime: number
): number {
  if (onTrack.length === 0) return 120; // Empty track = 2 min window
  if (!player) return 60;
  
  // Find the gap to the nearest car ahead on track
  const playerPos = player.lapDistance;
  let minGap = 1.0; // Full lap gap
  
  for (const car of onTrack) {
    if (car.isPlayer) continue;
    
    // Calculate distance ahead (wrapping around track)
    let distance = car.lapDistance - playerPos;
    if (distance < 0) distance += 1;
    
    // Only consider cars somewhat ahead (within half a lap)
    if (distance > 0 && distance < 0.5) {
      minGap = Math.min(minGap, distance);
    }
  }
  
  // Convert gap to seconds
  return Math.round(minGap * estimatedLapTime);
}

function classifyDensity(onTrack: number, inPit: number): TrafficDensity {
  const total = onTrack + inPit;
  if (total === 0) return 'LOW';
  
  const trackRatio = onTrack / Math.max(1, total);
  
  if (onTrack <= 4) return 'LOW';
  if (onTrack <= 8 || trackRatio < 0.5) return 'MEDIUM';
  return 'HIGH';
}

function estimateAverageLapTime(input: QualiEngineInput): number {
  // Collect all best lap times
  const times: number[] = [];
  for (const car of Object.values(input.cars)) {
    if (car.bestLapTime && car.bestLapTime > 0) {
      times.push(car.bestLapTime);
    }
  }
  
  if (times.length === 0) return 90; // Default 90 seconds
  
  // Return median
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

function computeOutlapTiming(
  input: QualiEngineInput,
  traffic: QualiTrafficPrediction,
  sessionContext: QualiSessionContext,
  estimatedLapTime: number
): QualiOutlapTiming {
  const { carsOnTrack, carsInPit, clearWindowSeconds } = traffic;
  const timeLeft = sessionContext.timeRemaining;
  const outlapTime = estimatedLapTime * 1.15; // Outlap is ~15% slower
  const minTimeNeeded = outlapTime + estimatedLapTime; // Outlap + flying lap
  
  // Critical: Not enough time
  if (timeLeft < minTimeNeeded + 15) {
    return {
      recommendation: 'GO_NOW',
      reason: 'Time running out - must leave now for final attempt',
      reasonCode: 'TIME_CRITICAL',
      confidence: 0.95,
    };
  }
  
  // Session about to end (< 2 laps worth of time)
  if (timeLeft < minTimeNeeded * 1.5) {
    return {
      recommendation: 'GO_NOW',
      reason: 'Final window approaching - leave soon',
      reasonCode: 'SESSION_END',
      confidence: 0.85,
    };
  }
  
  // Track is clear - good time to go
  if (carsOnTrack <= 3 && clearWindowSeconds > 45) {
    return {
      recommendation: 'GO_NOW',
      reason: 'Track is clear - optimal window',
      reasonCode: 'CLEAR_TRACK',
      confidence: 0.85,
    };
  }
  
  // Many cars in pit about to exit - wait
  if (carsInPit >= 8) {
    const waitTime = Math.min(30, Math.round(carsInPit * 2));
    return {
      recommendation: 'WAIT',
      waitSeconds: waitTime,
      reason: `${carsInPit} cars in pit - wait for them to clear`,
      reasonCode: 'CARS_EXITING_PIT',
      confidence: 0.75,
    };
  }
  
  // Traffic is clearing
  if (traffic.carsOnFlyingLap >= 5 && carsOnTrack > 6) {
    return {
      recommendation: 'WAIT',
      waitSeconds: 20,
      reason: 'Multiple cars on flying laps - traffic clearing soon',
      reasonCode: 'TRAFFIC_CLEARING',
      confidence: 0.7,
    };
  }
  
  // Moderate traffic
  if (carsOnTrack >= 5 && clearWindowSeconds < 30) {
    return {
      recommendation: 'PREPARE',
      reason: 'Track busy - monitor for gap',
      reasonCode: 'MONITORING',
      confidence: 0.6,
    };
  }
  
  // Default: Ready to go
  return {
    recommendation: 'PREPARE',
    reason: 'Monitoring traffic - prepare for outlap',
    reasonCode: 'MONITORING',
    confidence: 0.65,
  };
}

function computeSessionContext(
  input: QualiEngineInput,
  sessionType: QualiSessionType,
  playerIndex: number | null,
  estimatedLapTime: number
): QualiSessionContext {
  const timeRemaining = input.sessionTimeLeft ?? 0;
  const estimatedLapsRemaining = Math.floor(timeRemaining / (estimatedLapTime * 1.1)); // Account for outlap
  const cutoffPosition = CUTOFF_POSITIONS[sessionType];
  
  // Get player data
  const playerCar = playerIndex != null ? input.cars[playerIndex] : null;
  const currentPosition = playerCar?.position ?? 20;
  const playerBestLapTime = playerCar?.bestLapTime ?? null;
  
  // Calculate cutoff lap time and gap
  let cutoffLapTime: number | null = null;
  let gapToCutoff: number | null = null;
  
  // Find the car at cutoff position
  const sortedCars = Object.values(input.cars)
    .filter(c => c.bestLapTime && c.bestLapTime > 0)
    .sort((a, b) => (a.bestLapTime ?? Infinity) - (b.bestLapTime ?? Infinity));
  
  if (sortedCars.length >= cutoffPosition && sessionType !== 'Q3') {
    const cutoffCar = sortedCars[cutoffPosition - 1];
    cutoffLapTime = cutoffCar?.bestLapTime ?? null;
    
    if (playerBestLapTime && cutoffLapTime) {
      gapToCutoff = playerBestLapTime - cutoffLapTime;
    }
  }
  
  const isInDanger = sessionType !== 'Q3' && currentPosition > cutoffPosition - 3 && currentPosition <= cutoffPosition + 2;
  const isInEliminationZone = sessionType !== 'Q3' && currentPosition > cutoffPosition;
  
  return {
    sessionType,
    timeRemaining,
    estimatedLapsRemaining,
    cutoffPosition,
    currentPosition,
    gapToCutoff,
    isInDanger,
    isInEliminationZone,
    playerBestLapTime,
    cutoffLapTime,
  };
}

export class QualiStrategyEngine {
  evaluate(input: QualiEngineInput): QualiStrategyResult {
    const now = Date.now();
    
    // Check if qualifying session
    const sessionType = mapSessionType(input.sessionType);
    if (!sessionType) {
      return {
        strategyUnavailable: true,
        reason: 'not_qualifying',
        generatedAt: now,
      };
    }
    
    // Check for snapshot
    if (input.hasSnapshot === false) {
      return {
        strategyUnavailable: true,
        reason: 'no_snapshot',
        generatedAt: now,
      };
    }
    
    // Check for stale data
    if (input.isStale) {
      return {
        strategyUnavailable: true,
        reason: 'session_stale',
        generatedAt: now,
      };
    }
    
    // Check for player
    const playerIndex = input.playerCarIndex;
    if (playerIndex == null) {
      return {
        strategyUnavailable: true,
        reason: 'player_state_missing',
        generatedAt: now,
      };
    }
    
    // Compute data
    const estimatedLapTime = estimateAverageLapTime(input);
    const carPositions = computeCarPositions(input, playerIndex);
    const trafficPrediction = analyzeTraffic(carPositions, playerIndex, estimatedLapTime);
    const sessionContext = computeSessionContext(input, sessionType, playerIndex, estimatedLapTime);
    const outlapTiming = computeOutlapTiming(input, trafficPrediction, sessionContext, estimatedLapTime);
    
    return {
      sessionType,
      trafficPrediction,
      outlapTiming,
      sessionContext,
      carPositions,
      generatedAt: now,
    };
  }
}

// Singleton export for convenience
export const qualiStrategyEngine = new QualiStrategyEngine();
