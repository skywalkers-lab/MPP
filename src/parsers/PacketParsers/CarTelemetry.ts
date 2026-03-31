import { Buffer } from 'buffer';

// F1 25 UDP Car Telemetry Packet (after header, offsets from 29)
// 차량별 telemetry는 22개(0~21) 배열, 각 60바이트(예시)
const NUM_CARS = 22;
const CAR_TELEMETRY_SIZE = 60; // 실제 스펙에 맞게 조정 필요
const SPEED_OFFSET = 0; // uint16
const THROTTLE_OFFSET = 2; // float
const STEER_OFFSET = 6; // float
const BRAKE_OFFSET = 10; // float
const GEAR_OFFSET = 14; // int8
const ENGINE_RPM_OFFSET = 15; // uint16
const DRS_OFFSET = 17; // uint8
const TYRE_TEMP_OFFSET = 18; // 4*uint16

export function parseCarTelemetryPacket(buf: Buffer): any[] | null {
  const base = 29;
  if (buf.length < base + NUM_CARS * CAR_TELEMETRY_SIZE) return null;
  try {
    const cars: any[] = [];
    for (let i = 0; i < NUM_CARS; i++) {
      const off = base + i * CAR_TELEMETRY_SIZE;
      cars.push({
        carIndex: i,
        speed: buf.readUInt16LE(off + SPEED_OFFSET),
        throttle: buf.readFloatLE(off + THROTTLE_OFFSET),
        steer: buf.readFloatLE(off + STEER_OFFSET),
        brake: buf.readFloatLE(off + BRAKE_OFFSET),
        gear: buf.readInt8(off + GEAR_OFFSET),
        engineRPM: buf.readUInt16LE(off + ENGINE_RPM_OFFSET),
        drs: buf.readUInt8(off + DRS_OFFSET),
        tyreTemp: [
          buf.readUInt16LE(off + TYRE_TEMP_OFFSET + 0),
          buf.readUInt16LE(off + TYRE_TEMP_OFFSET + 2),
          buf.readUInt16LE(off + TYRE_TEMP_OFFSET + 4),
          buf.readUInt16LE(off + TYRE_TEMP_OFFSET + 6),
        ],
        // ... (필요시 추가)
      });
    }
    return cars;
  } catch (e) {
    return null;
  }
}
