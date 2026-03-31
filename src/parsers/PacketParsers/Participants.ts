import { Buffer } from 'buffer';

// F1 25 UDP Participants Packet (after header, offsets from 29)
// 차량별 participants는 22개(0~21) 배열, 각 56바이트(예시)
const NUM_CARS = 22;
const PARTICIPANT_SIZE = 56; // 실제 스펙에 맞게 조정 필요
const AI_CONTROLLED_OFFSET = 0; // uint8
const DRIVER_ID_OFFSET = 1; // uint8
const NETWORK_ID_OFFSET = 2; // uint8
const TEAM_ID_OFFSET = 3; // uint8
const MY_TEAM_OFFSET = 4; // uint8
const RACE_NUMBER_OFFSET = 5; // uint8
const NATIONALITY_OFFSET = 6; // uint8
const NAME_OFFSET = 7; // 48 bytes, null-terminated string

function readName(buf: Buffer, offset: number, length: number): string {
  const raw = buf.slice(offset, offset + length);
  const zeroIdx = raw.indexOf(0);
  return raw.slice(0, zeroIdx >= 0 ? zeroIdx : length).toString('utf8');
}

export function parseParticipantsPacket(buf: Buffer): any[] | null {
  const base = 29 + 1; // 1바이트 numActiveCars 스킵
  if (buf.length < base + NUM_CARS * PARTICIPANT_SIZE) return null;
  try {
    const participants: any[] = [];
    for (let i = 0; i < NUM_CARS; i++) {
      const off = base + i * PARTICIPANT_SIZE;
      participants.push({
        carIndex: i,
        aiControlled: buf.readUInt8(off + AI_CONTROLLED_OFFSET) === 1,
        driverId: buf.readUInt8(off + DRIVER_ID_OFFSET),
        networkId: buf.readUInt8(off + NETWORK_ID_OFFSET),
        teamId: buf.readUInt8(off + TEAM_ID_OFFSET),
        myTeam: buf.readUInt8(off + MY_TEAM_OFFSET) === 1,
        raceNumber: buf.readUInt8(off + RACE_NUMBER_OFFSET),
        nationality: buf.readUInt8(off + NATIONALITY_OFFSET),
        driverName: readName(buf, off + NAME_OFFSET, 48),
      });
    }
    return participants;
  } catch (e) {
    return null;
  }
}
