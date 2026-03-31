// 각 패킷별 파서 import (구현은 별도 파일)
import { parseSessionPacket } from './PacketParsers/Session';
import { parseLapDataPacket } from './PacketParsers/LapData';
import { parseParticipantsPacket } from './PacketParsers/Participants';
import { parseCarTelemetryPacket } from './PacketParsers/CarTelemetry';
import { parseCarStatusPacket } from './PacketParsers/CarStatus';
import { parseCarDamagePacket } from './PacketParsers/CarDamage';
import { parseEventPacket } from './PacketParsers/Event';
export function parsePacketById(packetId, buf) {
    switch (packetId) {
        case 1:
            return parseSessionPacket(buf);
        case 2: {
            const arr = parseLapDataPacket(buf);
            if (!arr)
                return null;
            // carIndex별 객체로 변환
            const obj = {};
            for (const c of arr)
                obj[c.carIndex] = c;
            return obj;
        }
        case 4: {
            const arr = parseParticipantsPacket(buf);
            if (!arr)
                return null;
            const obj = {};
            for (const c of arr)
                obj[c.carIndex] = c;
            return obj;
        }
        case 6: {
            const arr = parseCarTelemetryPacket(buf);
            if (!arr)
                return null;
            const obj = {};
            for (const c of arr)
                obj[c.carIndex] = c;
            return obj;
        }
        case 7: {
            const arr = parseCarStatusPacket(buf);
            if (!arr)
                return null;
            const obj = {};
            for (const c of arr)
                obj[c.carIndex] = c;
            return obj;
        }
        case 8: {
            const arr = parseCarDamagePacket(buf);
            if (!arr)
                return null;
            const obj = {};
            for (const c of arr)
                obj[c.carIndex] = c;
            return obj;
        }
        case 3:
            return parseEventPacket(buf);
        // TODO: SessionHistory, TyreSets, LapPositions 등 확장 가능
        default:
            return null;
    }
}
