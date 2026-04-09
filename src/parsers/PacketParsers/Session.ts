import { Buffer } from 'buffer';

// F1 25 UDP Session Packet (after header, offsets are from 29)
// 주요 필드 오프셋 (2025 spec 기준)
const SESSION_TYPE_OFFSET = 0; // uint8
const TRACK_ID_OFFSET = 1; // int8
const FORMULA_OFFSET = 2; // uint8
const WEATHER_OFFSET = 3; // uint8
const TOTAL_LAPS_OFFSET = 4; // uint8
const SESSION_TIME_LEFT_OFFSET = 5; // uint16
const SESSION_DURATION_OFFSET = 7; // uint16
const PIT_SPEED_LIMIT_OFFSET = 9; // uint8
const SAFETY_CAR_STATUS_OFFSET = 10; // uint8
const NETWORK_GAME_OFFSET = 11; // uint8
const TRACK_LENGTH_OFFSET = 164; // uint16 (optional extended payload)
// ... (필요시 추가)

function mapWeatherCode(code: number): string {
  switch (code) {
    case 0: return 'clear';
    case 1: return 'light_cloud';
    case 2: return 'overcast';
    case 3: return 'light_rain';
    case 4:
    case 5:
      return 'heavy_rain';
    default:
      return 'unknown';
  }
}

export function parseSessionPacket(buf: Buffer): any | null {
  // 헤더(29바이트) 이후부터 세션 패킷 시작
  const base = 29;
  if (buf.length < base + 12) return null;
  try {
    const weatherCode = buf.readUInt8(base + WEATHER_OFFSET);
    return {
      sessionType: buf.readUInt8(base + SESSION_TYPE_OFFSET),
      trackId: buf.readInt8(base + TRACK_ID_OFFSET),
      formula: buf.readUInt8(base + FORMULA_OFFSET),
      weather: mapWeatherCode(weatherCode),
      weatherCode,
      totalLaps: buf.readUInt8(base + TOTAL_LAPS_OFFSET),
      sessionTimeLeft: buf.readUInt16LE(base + SESSION_TIME_LEFT_OFFSET),
      sessionDuration: buf.readUInt16LE(base + SESSION_DURATION_OFFSET),
      pitSpeedLimit: buf.readUInt8(base + PIT_SPEED_LIMIT_OFFSET),
      safetyCarStatus: buf.readUInt8(base + SAFETY_CAR_STATUS_OFFSET),
      networkGame: buf.readUInt8(base + NETWORK_GAME_OFFSET),
      trackLength:
        buf.length >= base + TRACK_LENGTH_OFFSET + 2
          ? buf.readUInt16LE(base + TRACK_LENGTH_OFFSET)
          : null,
      // ... (marshal zones, forecast samples 등 필요시 추가)
    };
  } catch (e) {
    return null;
  }
}
