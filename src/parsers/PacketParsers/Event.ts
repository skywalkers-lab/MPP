import { Buffer } from 'buffer';

// F1 25 UDP Event Packet (after header, offsets from 29)
// eventCode: 4 bytes ASCII
const EVENT_CODE_OFFSET = 0;
const EVENT_CODE_LENGTH = 4;

export function parseEventPacket(buf: Buffer): any | null {
  const base = 29;
  if (buf.length < base + 4) return null;
  try {
    const eventCode = buf.slice(base + EVENT_CODE_OFFSET, base + EVENT_CODE_OFFSET + EVENT_CODE_LENGTH).toString('ascii');
    let details = {};
    let type = eventCode;
    // 주요 이벤트 분기 (예시)
    switch (eventCode) {
      case 'FTLP': // Fastest Lap
        type = 'FastestLap';
        details = {
          carIndex: buf.readUInt8(base + 4),
          lapTime: buf.readFloatLE(base + 5),
        };
        break;
      case 'RTMT': // Retirement
        type = 'Retirement';
        details = { carIndex: buf.readUInt8(base + 4) };
        break;
      // ... (필요시 추가)
      default:
        type = eventCode;
        details = {};
        break;
    }
    return {
      type,
      details,
      timestamp: Date.now(),
    };
  } catch (e) {
    return null;
  }
}
