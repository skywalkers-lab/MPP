import { PacketHeader } from '../parsers/PacketHeaderParser.js';
import { CurrentRaceState, EVENT_LOG_RING_SIZE, EventLogEntry, CarState } from '../model/CurrentRaceState.js';

export class StateReducer {
  private state: CurrentRaceState;
  private eventLog: EventLogEntry[];
  private stateListeners: Array<(state: CurrentRaceState) => void>;

  constructor() {
    this.state = {
      sessionMeta: null,
      playerCarIndex: null,
      spectatorCarIndex: null,
      cars: {},
      drivers: {},
      eventLog: [],
    };
    this.eventLog = [];
    this.stateListeners = [];
  }

  subscribeOnStateChange(listener: (state: CurrentRaceState) => void) {
    this.stateListeners.push(listener);
  }

  getState(): CurrentRaceState {
    return { ...this.state, eventLog: [...this.eventLog] };
  }

  handlePacket(header: PacketHeader, packet: any) {
    // 세션 전환 감지 (sessionUID, sessionType, trackId, frameIdentifier reset 조합)
    let shouldReset = false;
    if (header.sessionUID && this.state.sessionMeta?.sessionUID !== header.sessionUID) {
      shouldReset = true;
    }
    if (
      this.state.sessionMeta &&
      header.sessionUID === this.state.sessionMeta.sessionUID &&
      packet?.sessionType != null &&
      this.state.sessionMeta.sessionType != null &&
      packet.sessionType !== this.state.sessionMeta.sessionType
    ) {
      shouldReset = true;
    }
    if (
      this.state.sessionMeta &&
      header.sessionUID === this.state.sessionMeta.sessionUID &&
      packet?.trackId != null &&
      this.state.sessionMeta.trackId != null &&
      packet.trackId !== this.state.sessionMeta.trackId
    ) {
      shouldReset = true;
    }
    if (shouldReset) {
      this.resetForNewSession(header.sessionUID);
    }
    if (this.state.sessionMeta) {
      (this.state.sessionMeta as any).lastFrameIdentifier = header.frameIdentifier;
    }
    switch (header.packetId) {
      case 1: // Session
        this.state.sessionMeta = {
          sessionUID: header.sessionUID,
          sessionType: packet.sessionType,
          trackId: packet.trackId,
          weather: packet.weather,
          safetyCarStatus: packet.safetyCarStatus,
          totalLaps: packet.totalLaps,
          currentLap: packet.currentLap,
          sessionTime: packet.sessionTime,
          sessionTimeLeft: packet.sessionTimeLeft,
          trackLength: packet.trackLength,
        };
        break;
      case 2: // Lap Data
        for (const car of this.asPacketItems(packet)) {
          this.updateCarState(car.carIndex, {
            position: car.position,
            currentLapNum: car.currentLapNum,
            lastLapTime: car.lastLapTime ?? car.lastLapTimeMs,
            bestLapTime: car.bestLapTime ?? car.bestLapTimeMs,
            gapToLeader: car.gapToLeader,
            gapToFront: car.gapToFront,
            pitStatus: car.pitStatus,
            driverStatus: car.driverStatus,
            lapDistance: car.lapDistance,
          });
        }
        break;
      case 4: // Participants
        for (const p of this.asPacketItems(packet)) {
          this.state.drivers[p.carIndex] = {
            carIndex: p.carIndex,
            driverName: p.driverName,
            teamId: p.teamId,
            teamName: p.teamName,
            nationality: p.nationality,
            aiControlled: p.aiControlled,
            raceNumber: p.raceNumber,
          };
        }
        break;
      case 6: // Car Telemetry
        for (const car of this.asPacketItems(packet)) {
          this.updateCarState(car.carIndex, {
            ersLevel: car.ersLevel,
            tyreTemp: car.tyreTemp,
          });
        }
        break;
      case 7: // Car Status
        for (const car of this.asPacketItems(packet)) {
          this.updateCarState(car.carIndex, {
            fuelRemaining: car.fuelRemaining,
            fuelLapsRemaining: car.fuelLapsRemaining,
            pitStatus: car.pitStatus,
            tyreCompound: car.tyreCompound,
            tyreAgeLaps: car.tyreAgeLaps,
            ersDeployMode: car.ersDeployMode,
          });
        }
        break;
      case 8: // Car Damage
        for (const car of this.asPacketItems(packet)) {
          this.updateCarState(car.carIndex, {
            damage: {
              frontWingLeft: car.frontWingLeft,
              frontWingRight: car.frontWingRight,
              rearWing: car.rearWing,
              floor: car.floor,
              sidepod: car.sidepod,
              engine: car.engine,
              gearbox: car.gearbox,
            },
          });
        }
        break;
      case 3: // Event
        this.pushEvent({
          timestamp: packet.timestamp || Date.now(),
          type: packet.type,
          details: packet.details,
        });
        break;
      default:
        // 무시
        break;
    }
    // 플레이어/스펙테이터 인덱스 갱신
    this.state.playerCarIndex = header.playerCarIndex;
    this.state.spectatorCarIndex = header.secondaryPlayerCarIndex;

    this.notifyStateChange();
  }

  private notifyStateChange() {
    const snapshot = this.getState();
    for (const listener of this.stateListeners) {
      listener(snapshot);
    }
  }

  private asPacketItems(packet: any): any[] {
    if (!packet) {
      return [];
    }
    if (Array.isArray(packet)) {
      return packet.filter(Boolean);
    }
    if (typeof packet === 'object') {
      if ('carIndex' in packet || 'driverName' in packet || 'type' in packet) {
        return [packet];
      }
      return Object.values(packet).filter((value) => value != null);
    }
    return [];
  }

  private updateCarState(carIndex: number, partial: Partial<CarState>) {
    if (!this.state.cars[carIndex]) {
      this.state.cars[carIndex] = {
        carIndex,
        position: null,
        currentLapNum: null,
        lastLapTime: null,
        bestLapTime: null,
        gapToLeader: null,
        gapToFront: null,
        pitStatus: null,
        driverStatus: null,
        lapDistance: null,
        tyreCompound: null,
        tyreAgeLaps: null,
        fuelRemaining: null,
        fuelLapsRemaining: null,
        ersLevel: null,
        ersDeployMode: null,
        tyreWear: null,
        tyreTemp: null,
        damage: null,
      };
    }
    Object.assign(this.state.cars[carIndex], partial);
  }

  private pushEvent(event: EventLogEntry) {
    this.eventLog.push(event);
    if (this.eventLog.length > EVENT_LOG_RING_SIZE) {
      this.eventLog.shift();
    }
  }

  private resetForNewSession(sessionUID: string) {
    this.state.sessionMeta = { sessionUID, sessionType: '', trackId: 0, weather: '', safetyCarStatus: '', totalLaps: 0, currentLap: 0, sessionTime: 0 };
    this.state.cars = {};
    this.state.drivers = {};
    this.eventLog = [];
  }
}
