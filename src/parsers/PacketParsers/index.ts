
import { Buffer } from 'buffer';
// 각 패킷별 파서 import (구현은 별도 파일)
import { parseSessionPacket } from './Session.js';
import { parseLapDataPacket } from './LapData.js';
import { parseParticipantsPacket } from './Participants.js';
import { parseCarTelemetryPacket } from './CarTelemetry.js';
import { parseCarStatusPacket } from './CarStatus.js';
import { parseCarDamagePacket } from './CarDamage.js';
import { parseEventPacket } from './Event.js';

export function parsePacketById(packetId: number, buf: Buffer) {
  switch (packetId) {
    case 1:
      return parseSessionPacket(buf);
    case 2: {
      const arr = parseLapDataPacket(buf);
      if (!arr) return null;
      // carIndex별 객체로 변환
      const obj: Record<number, any> = {};
      for (const c of arr) obj[c.carIndex] = c;
      return obj;
    }
    case 4: {
      const arr = parseParticipantsPacket(buf);
      if (!arr) return null;
      const obj: Record<number, any> = {};
      for (const c of arr) obj[c.carIndex] = c;
      return obj;
    }
    case 6: {
      const arr = parseCarTelemetryPacket(buf);
      if (!arr) return null;
      const obj: Record<number, any> = {};
      for (const c of arr) obj[c.carIndex] = c;
      return obj;
    }
    case 7: {
      const arr = parseCarStatusPacket(buf);
      if (!arr) return null;
      const obj: Record<number, any> = {};
      for (const c of arr) obj[c.carIndex] = c;
      return obj;
    }
    case 8: {
      const arr = parseCarDamagePacket(buf);
      if (!arr) return null;
      const obj: Record<number, any> = {};
      for (const c of arr) obj[c.carIndex] = c;
      return obj;
    }
    case 3:
      return parseEventPacket(buf);
    // TODO: SessionHistory, TyreSets, LapPositions 등 확장 가능
    default:
      return null;
  }
}
