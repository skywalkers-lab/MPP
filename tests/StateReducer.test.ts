import { StateReducer } from '../src/agent/StateReducer';
import { PacketHeader } from '../src/parsers/PacketHeaderParser';

describe('StateReducer', () => {
  it('should not crash on invalid packet', () => {
    const reducer = new StateReducer();
    expect(() => reducer.handlePacket({} as PacketHeader, null)).not.toThrow();
  });

  it('should allow partial state (LapData only)', () => {
    const reducer = new StateReducer();
    // LapData만 먼저 들어와도 상태 생성
    reducer.handlePacket(
      { packetId: 2, sessionUID: 'abc', playerCarIndex: 0, secondaryPlayerCarIndex: 255 } as any,
      { carIndex: 0, position: 1 }
    );
    const state = reducer.getState();
    expect(state.cars[0]).toBeDefined();
    expect(state.cars[0].position).toBe(1);
  });

  it('should merge Participants and LapData (order independent)', () => {
    const reducer = new StateReducer();
    // Participants 먼저
    reducer.handlePacket(
      { packetId: 4, sessionUID: 'abc', playerCarIndex: 0, secondaryPlayerCarIndex: 255 } as any,
      [{ carIndex: 0, driverName: 'Test', teamId: 1, teamName: 'Red Bull', nationality: 'KOR', aiControlled: false, raceNumber: 33 }]
    );
    reducer.handlePacket(
      { packetId: 2, sessionUID: 'abc', playerCarIndex: 0, secondaryPlayerCarIndex: 255 } as any,
      { carIndex: 0, position: 1 }
    );
    let state = reducer.getState();
    expect(state.cars[0]).toBeDefined();
    expect(state.drivers[0].driverName).toBe('Test');
    // LapData 먼저
    const reducer2 = new StateReducer();
    reducer2.handlePacket(
      { packetId: 2, sessionUID: 'abc', playerCarIndex: 0, secondaryPlayerCarIndex: 255 } as any,
      { carIndex: 0, position: 1 }
    );
    reducer2.handlePacket(
      { packetId: 4, sessionUID: 'abc', playerCarIndex: 0, secondaryPlayerCarIndex: 255 } as any,
      [{ carIndex: 0, driverName: 'Test', teamId: 1, teamName: 'Red Bull', nationality: 'KOR', aiControlled: false, raceNumber: 33 }]
    );
    state = reducer2.getState();
    expect(state.cars[0]).toBeDefined();
    expect(state.drivers[0].driverName).toBe('Test');
  });

  it('should keep only N events in ring buffer', () => {
    const reducer = new StateReducer();
    for (let i = 0; i < 100; i++) {
      reducer.handlePacket({ packetId: 3, sessionUID: 'abc', playerCarIndex: 0, secondaryPlayerCarIndex: 255 } as any, { type: 'FastestLap', details: { carIndex: 0 }, timestamp: i });
    }
    const state = reducer.getState();
    expect(state.eventLog.length).toBeLessThanOrEqual(50);
    expect(state.eventLog[state.eventLog.length - 1].timestamp).toBe(99);
  });

  it('should reset state on session change (sessionUID)', () => {
    const reducer = new StateReducer();
    reducer.handlePacket({ packetId: 1, sessionUID: 'abc', playerCarIndex: 0, secondaryPlayerCarIndex: 255 } as any, { sessionType: 'Race' });
    reducer.handlePacket({ packetId: 1, sessionUID: 'def', playerCarIndex: 0, secondaryPlayerCarIndex: 255 } as any, { sessionType: 'Qualifying' });
    const state = reducer.getState();
    expect(state.sessionMeta?.sessionUID).toBe('def');
  });

  it('should keep qualifying telemetry fields from map-shaped packet payloads', () => {
    const reducer = new StateReducer();

    reducer.handlePacket(
      { packetId: 1, sessionUID: 'quali', playerCarIndex: 0, secondaryPlayerCarIndex: 255 } as any,
      { sessionType: 6, trackId: 10, totalLaps: 0, sessionTime: 25, sessionTimeLeft: 480, trackLength: 5412 }
    );

    reducer.handlePacket(
      { packetId: 2, sessionUID: 'quali', playerCarIndex: 0, secondaryPlayerCarIndex: 255 } as any,
      {
        0: {
          carIndex: 0,
          position: 2,
          currentLapNum: 3,
          lastLapTime: 90123,
          bestLapTime: 89456,
          lapDistance: 0.27,
          pitStatus: 'NONE',
          driverStatus: 'OUT_LAP',
        },
      }
    );

    const state = reducer.getState();
    expect(state.sessionMeta?.sessionTimeLeft).toBe(480);
    expect(state.sessionMeta?.trackLength).toBe(5412);
    expect(state.cars[0].lapDistance).toBe(0.27);
    expect(state.cars[0].pitStatus).toBe('NONE');
    expect(state.cars[0].driverStatus).toBe('OUT_LAP');
  });
});
