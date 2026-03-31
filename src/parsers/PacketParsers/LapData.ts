import { Buffer } from 'buffer';

// F1 25 UDP Lap Data Packet (after header, offsets from 29)
// 차량별 lap data는 22개(0~21) 배열, 각 60바이트(예시)
const NUM_CARS = 22;
const CAR_LAPDATA_SIZE = 60; // 실제 스펙에 맞게 조정 필요
const POSITION_OFFSET = 0; // uint8
const CURRENT_LAP_NUM_OFFSET = 1; // uint8
const LAST_LAP_TIME_MS_OFFSET = 2; // uint32
const BEST_LAP_TIME_MS_OFFSET = 6; // uint32
// ... (필요시 추가)

export function parseLapDataPacket(buf: Buffer): any[] | null {
  const base = 29;
  if (buf.length < base + NUM_CARS * CAR_LAPDATA_SIZE) return null;
  try {
    const cars: any[] = [];
    for (let i = 0; i < NUM_CARS; i++) {
      const off = base + i * CAR_LAPDATA_SIZE;
      cars.push({
        carIndex: i,
        position: buf.readUInt8(off + POSITION_OFFSET),
        currentLapNum: buf.readUInt8(off + CURRENT_LAP_NUM_OFFSET),
        lastLapTimeMs: buf.readUInt32LE(off + LAST_LAP_TIME_MS_OFFSET),
        bestLapTimeMs: buf.readUInt32LE(off + BEST_LAP_TIME_MS_OFFSET),
        // ... (sector times, pit status 등 필요시 추가)
      });
    }
    return cars;
  } catch (e) {
    return null;
  }
}
