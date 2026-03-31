// F1 25 CurrentRaceState 타입 및 관련 데이터 구조 정의
// "아직 수신되지 않은 값"과 "실제로 0인 값"을 구분할 수 있도록 설계

export type Nullable<T> = T | null | undefined;

export interface SessionMeta {
  sessionUID: string;
  sessionType: string; // Race, Qualifying, Practice 등
  trackId: number;
  weather: string;
  safetyCarStatus: string;
  totalLaps: number;
  currentLap: number;
  sessionTime: number;
}

export interface DriverInfo {
  carIndex: number;
  driverName: string;
  teamId: number;
  teamName: string;
  nationality: string;
  aiControlled: boolean;
  raceNumber: number;
}

export interface CarState {
  carIndex: number;
  position: Nullable<number>;
  currentLapNum: Nullable<number>;
  lastLapTime: Nullable<number>;
  bestLapTime: Nullable<number>;
  gapToLeader: Nullable<number>;
  gapToFront: Nullable<number>;
  pitStatus: Nullable<string>;
  tyreCompound: Nullable<string>;
  tyreAgeLaps: Nullable<number>;
  fuelRemaining: Nullable<number>;
  fuelLapsRemaining: Nullable<number>;
  ersLevel: Nullable<number>;
  ersDeployMode: Nullable<string>;
  tyreWear: Nullable<number[]>; // [FL, FR, RL, RR]
  tyreTemp: Nullable<number[]>; // [FL, FR, RL, RR]
  damage: Nullable<CarDamage>;
}

export interface CarDamage {
  frontWingLeft: Nullable<number>;
  frontWingRight: Nullable<number>;
  rearWing: Nullable<number>;
  floor: Nullable<number>;
  sidepod: Nullable<number>;
  engine: Nullable<number>;
  gearbox: Nullable<number>;
}

export interface EventLogEntry {
  timestamp: number;
  type: string;
  details: any;
}

export interface CurrentRaceState {
  sessionMeta: Nullable<SessionMeta>;
  playerCarIndex: Nullable<number>;
  spectatorCarIndex: Nullable<number>;
  cars: Record<number, CarState>; // carIndex 기반
  drivers: Record<number, DriverInfo>; // carIndex 기반
  eventLog: EventLogEntry[];
}

export const EVENT_LOG_RING_SIZE = 50;
