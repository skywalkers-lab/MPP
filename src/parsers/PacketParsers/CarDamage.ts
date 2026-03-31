import { Buffer } from 'buffer';

// F1 25 UDP Car Damage Packet (after header, offsets from 29)
// 차량별 damage는 22개(0~21) 배열, 각 40바이트(예시)
const NUM_CARS = 22;
const CAR_DAMAGE_SIZE = 40; // 실제 스펙에 맞게 조정 필요
const FRONT_WING_LEFT_OFFSET = 0; // uint8
const FRONT_WING_RIGHT_OFFSET = 1; // uint8
const REAR_WING_OFFSET = 2; // uint8
const FLOOR_OFFSET = 3; // uint8
const SIDEPOD_OFFSET = 4; // uint8
const ENGINE_OFFSET = 5; // uint8
const GEARBOX_OFFSET = 6; // uint8

export function parseCarDamagePacket(buf: Buffer): any[] | null {
  const base = 29;
  if (buf.length < base + NUM_CARS * CAR_DAMAGE_SIZE) return null;
  try {
    const cars: any[] = [];
    for (let i = 0; i < NUM_CARS; i++) {
      const off = base + i * CAR_DAMAGE_SIZE;
      cars.push({
        carIndex: i,
        frontWingLeft: buf.readUInt8(off + FRONT_WING_LEFT_OFFSET),
        frontWingRight: buf.readUInt8(off + FRONT_WING_RIGHT_OFFSET),
        rearWing: buf.readUInt8(off + REAR_WING_OFFSET),
        floor: buf.readUInt8(off + FLOOR_OFFSET),
        sidepod: buf.readUInt8(off + SIDEPOD_OFFSET),
        engine: buf.readUInt8(off + ENGINE_OFFSET),
        gearbox: buf.readUInt8(off + GEARBOX_OFFSET),
        // ... (필요시 추가)
      });
    }
    return cars;
  } catch (e) {
    return null;
  }
}
