
import { Buffer } from 'buffer';

// F1 25 UDP Packet Header (24 bytes)
// See: https://forums.codemasters.com/topic/113948-f1-25-udp-specification/
export interface PacketHeader {
  packetFormat: number;           // 0: uint16
  gameYear: number;              // 2: uint8
  gameMajorVersion: number;      // 3: uint8
  gameMinorVersion: number;      // 4: uint8
  packetVersion: number;         // 5: uint8
  packetId: number;              // 6: uint8
  sessionUID: string;            // 7: uint64 (as string)
  sessionTime: number;           // 15: float32
  frameIdentifier: number;       // 19: uint32
  overallFrameIdentifier: number;// 23: uint32
  playerCarIndex: number;        // 27: uint8
  secondaryPlayerCarIndex: number;// 28: uint8
}

export function parsePacketHeader(buf: Buffer): PacketHeader | null {
  // F1 25 UDP Header is 29 bytes (as of 2025 spec)
  if (buf.length < 29) return null;
  try {
    return {
      packetFormat: buf.readUInt16LE(0),
      gameYear: buf.readUInt8(2),
      gameMajorVersion: buf.readUInt8(3),
      gameMinorVersion: buf.readUInt8(4),
      packetVersion: buf.readUInt8(5),
      packetId: buf.readUInt8(6),
      sessionUID: buf.readBigUInt64LE(7).toString(),
      sessionTime: buf.readFloatLE(15),
      frameIdentifier: buf.readUInt32LE(19),
      overallFrameIdentifier: buf.readUInt32LE(23),
      playerCarIndex: buf.readUInt8(27),
      secondaryPlayerCarIndex: buf.readUInt8(28),
    };
  } catch (e) {
    return null;
  }
}
