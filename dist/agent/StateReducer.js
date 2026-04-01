import { EVENT_LOG_RING_SIZE } from '../model/CurrentRaceState';
export class StateReducer {
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
    subscribeOnStateChange(listener) {
        this.stateListeners.push(listener);
    }
    getState() {
        return { ...this.state, eventLog: [...this.eventLog] };
    }
    handlePacket(header, packet) {
        // 세션 전환 감지 (sessionUID, sessionType, trackId, frameIdentifier reset 조합)
        let shouldReset = false;
        if (header.sessionUID && this.state.sessionMeta?.sessionUID !== header.sessionUID) {
            shouldReset = true;
        }
        if (this.state.sessionMeta &&
            header.sessionUID === this.state.sessionMeta.sessionUID &&
            packet?.sessionType != null &&
            this.state.sessionMeta.sessionType != null &&
            packet.sessionType !== this.state.sessionMeta.sessionType) {
            shouldReset = true;
        }
        if (this.state.sessionMeta &&
            header.sessionUID === this.state.sessionMeta.sessionUID &&
            packet?.trackId != null &&
            this.state.sessionMeta.trackId != null &&
            packet.trackId !== this.state.sessionMeta.trackId) {
            shouldReset = true;
        }
        if (shouldReset) {
            this.resetForNewSession(header.sessionUID);
        }
        if (this.state.sessionMeta) {
            this.state.sessionMeta.lastFrameIdentifier = header.frameIdentifier;
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
                };
                break;
            case 2: // Lap Data
                this.updateCarState(packet.carIndex, {
                    position: packet.position,
                    currentLapNum: packet.currentLapNum,
                    lastLapTime: packet.lastLapTime,
                    bestLapTime: packet.bestLapTime,
                    gapToLeader: packet.gapToLeader,
                    gapToFront: packet.gapToFront,
                });
                break;
            case 4: // Participants
                for (const p of packet) {
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
                this.updateCarState(packet.carIndex, {
                    ersLevel: packet.ersLevel,
                    tyreTemp: packet.tyreTemp,
                });
                break;
            case 7: // Car Status
                this.updateCarState(packet.carIndex, {
                    fuelRemaining: packet.fuelRemaining,
                    fuelLapsRemaining: packet.fuelLapsRemaining,
                    tyreCompound: packet.tyreCompound,
                    tyreAgeLaps: packet.tyreAgeLaps,
                    ersDeployMode: packet.ersDeployMode,
                });
                break;
            case 8: // Car Damage
                this.updateCarState(packet.carIndex, {
                    damage: {
                        frontWingLeft: packet.frontWingLeft,
                        frontWingRight: packet.frontWingRight,
                        rearWing: packet.rearWing,
                        floor: packet.floor,
                        sidepod: packet.sidepod,
                        engine: packet.engine,
                        gearbox: packet.gearbox,
                    },
                });
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
    notifyStateChange() {
        const snapshot = this.getState();
        for (const listener of this.stateListeners) {
            listener(snapshot);
        }
    }
    updateCarState(carIndex, partial) {
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
    pushEvent(event) {
        this.eventLog.push(event);
        if (this.eventLog.length > EVENT_LOG_RING_SIZE) {
            this.eventLog.shift();
        }
    }
    resetForNewSession(sessionUID) {
        this.state.sessionMeta = { sessionUID, sessionType: '', trackId: 0, weather: '', safetyCarStatus: '', totalLaps: 0, currentLap: 0, sessionTime: 0 };
        this.state.cars = {};
        this.state.drivers = {};
        this.eventLog = [];
    }
}
