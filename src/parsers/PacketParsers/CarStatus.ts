import { Buffer } from 'buffer';

// F1 25 UDP Car Status Packet (after header, offsets from 29)
// 차량별 status는 22개(0~21) 배열, 각 60바이트(예시)
const NUM_CARS = 22;
const CAR_STATUS_SIZE = 60; // 실제 스펙에 맞게 조정 필요
const FUEL_REMAINING_OFFSET = 0; // float
const FUEL_LAPS_REMAINING_OFFSET = 4; // float
const TYRE_COMPOUND_OFFSET = 8; // uint8
const TYRE_AGE_LAPS_OFFSET = 9; // uint8
const ERS_DEPLOY_MODE_OFFSET = 10; // uint8

export function parseCarStatusPacket(buf: Buffer): any[] | null {
  const base = 29;
  if (buf.length < base + NUM_CARS * CAR_STATUS_SIZE) return null;
  try {
    const cars: any[] = [];
    for (let i = 0; i < NUM_CARS; i++) {
      const off = base + i * CAR_STATUS_SIZE;
      cars.push({
        carIndex: i,
        fuelRemaining: buf.readFloatLE(off + FUEL_REMAINING_OFFSET),
        fuelLapsRemaining: buf.readFloatLE(off + FUEL_LAPS_REMAINING_OFFSET),
        tyreCompound: buf.readUInt8(off + TYRE_COMPOUND_OFFSET),
        tyreAgeLaps: buf.readUInt8(off + TYRE_AGE_LAPS_OFFSET),
        ersDeployMode: buf.readUInt8(off + ERS_DEPLOY_MODE_OFFSET),
        // ... (필요시 추가)
      });
    }
    return cars;
  } catch (e) {
    return null;
  }
}
