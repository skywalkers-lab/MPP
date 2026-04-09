
import { parsePacketHeader } from '../src/parsers/PacketHeaderParser';
import { parseSessionPacket } from '../src/parsers/PacketParsers/Session';
import { parseLapDataPacket } from '../src/parsers/PacketParsers/LapData';
import { parseParticipantsPacket } from '../src/parsers/PacketParsers/Participants';
import { parseCarTelemetryPacket } from '../src/parsers/PacketParsers/CarTelemetry';
import { parseCarStatusPacket } from '../src/parsers/PacketParsers/CarStatus';
import { parseCarDamagePacket } from '../src/parsers/PacketParsers/CarDamage';
import { parseEventPacket } from '../src/parsers/PacketParsers/Event';

// Buffer fixture 기반 실제 파서 검증

describe('F1 25 UDP Packet Parsers', () => {
  it('parses PacketHeader from buffer', () => {
    const buf = Buffer.alloc(29);
    buf.writeUInt16LE(2025, 0); // packetFormat
    buf.writeUInt8(25, 2); // gameYear
    buf.writeUInt8(1, 3); // gameMajorVersion
    buf.writeUInt8(0, 4); // gameMinorVersion
    buf.writeUInt8(7, 5); // packetVersion
    buf.writeUInt8(1, 6); // packetId
    buf.writeBigUInt64LE(BigInt('1234567890123456789'), 7); // sessionUID
    buf.writeFloatLE(123.45, 15); // sessionTime
    buf.writeUInt32LE(42, 19); // frameIdentifier
    buf.writeUInt32LE(99, 23); // overallFrameIdentifier
    buf.writeUInt8(5, 27); // playerCarIndex
    buf.writeUInt8(255, 28); // secondaryPlayerCarIndex
    const header = parsePacketHeader(buf);
    expect(header?.packetFormat).toBe(2025);
    expect(header?.sessionUID).toBe('1234567890123456789');
    expect(header?.playerCarIndex).toBe(5);
  });

  it('parses Session packet fields', () => {
    const buf = Buffer.alloc(29 + 12);
    buf.writeUInt8(3, 29); // sessionType
    buf.writeInt8(5, 30); // trackId
    buf.writeUInt8(2, 31); // formula
    buf.writeUInt8(1, 32); // weather
    buf.writeUInt8(57, 33); // totalLaps
    buf.writeUInt16LE(1000, 34); // sessionTimeLeft
    buf.writeUInt16LE(2000, 36); // sessionDuration
    buf.writeUInt8(80, 38); // pitSpeedLimit
    buf.writeUInt8(1, 39); // safetyCarStatus
    buf.writeUInt8(1, 40); // networkGame
    const parsed = parseSessionPacket(buf);
    expect(parsed?.sessionType).toBe(3);
    expect(parsed?.trackId).toBe(5);
    expect(parsed?.weather).toBe('light_cloud');
    expect(parsed?.totalLaps).toBe(57);
    expect(parsed?.pitSpeedLimit).toBe(80);
  });

  it('parses Participants packet with driverName', () => {
    const buf = Buffer.alloc(29 + 1 + 56 * 22);
    buf.writeUInt8(22, 29); // numActiveCars
    // 첫 참가자
    buf.writeUInt8(0, 30); // aiControlled
    buf.writeUInt8(1, 31); // driverId
    buf.writeUInt8(2, 32); // networkId
    buf.writeUInt8(3, 33); // teamId
    buf.writeUInt8(1, 34); // myTeam
    buf.writeUInt8(44, 35); // raceNumber
    buf.writeUInt8(7, 36); // nationality
    buf.write('Verstappen', 37, 'utf8');
    const arr = parseParticipantsPacket(buf);
    expect(arr?.[0].driverName.startsWith('Verstappen')).toBe(true);
    expect(arr?.[0].teamId).toBe(3);
  });

  it('parses LapData, CarTelemetry, CarStatus, CarDamage arrays', () => {
    // LapData
    const lapBuf = Buffer.alloc(29 + 60 * 22);
    lapBuf.writeUInt8(1, 29 + 0 * 60 + 0); // position
    lapBuf.writeUInt8(5, 29 + 0 * 60 + 1); // currentLapNum
    lapBuf.writeUInt32LE(90000, 29 + 0 * 60 + 2); // lastLapTimeMs
    lapBuf.writeUInt32LE(88000, 29 + 0 * 60 + 6); // bestLapTimeMs
    const lapArr = parseLapDataPacket(lapBuf);
    expect(lapArr?.[0].position).toBe(1);
    expect(lapArr?.[0].lastLapTimeMs).toBe(90000);
    // CarTelemetry
    const teleBuf = Buffer.alloc(29 + 60 * 22);
    teleBuf.writeUInt16LE(320, 29 + 0 * 60 + 0); // speed
    teleBuf.writeFloatLE(0.99, 29 + 0 * 60 + 2); // throttle
    teleBuf.writeFloatLE(-0.1, 29 + 0 * 60 + 6); // steer
    teleBuf.writeFloatLE(0.0, 29 + 0 * 60 + 10); // brake
    teleBuf.writeInt8(7, 29 + 0 * 60 + 14); // gear
    teleBuf.writeUInt16LE(12000, 29 + 0 * 60 + 15); // engineRPM
    teleBuf.writeUInt8(1, 29 + 0 * 60 + 17); // drs
    teleBuf.writeUInt16LE(90, 29 + 0 * 60 + 18); // tyreTemp[0]
    teleBuf.writeUInt16LE(91, 29 + 0 * 60 + 20); // tyreTemp[1]
    teleBuf.writeUInt16LE(88, 29 + 0 * 60 + 22); // tyreTemp[2]
    teleBuf.writeUInt16LE(89, 29 + 0 * 60 + 24); // tyreTemp[3]
    const teleArr = parseCarTelemetryPacket(teleBuf);
    expect(teleArr?.[0].speed).toBe(320);
    expect(teleArr?.[0].tyreTemp[2]).toBe(88);
    // CarStatus
    const statBuf = Buffer.alloc(29 + 60 * 22);
    statBuf.writeFloatLE(30.5, 29 + 0 * 60 + 0); // fuelRemaining
    statBuf.writeFloatLE(15.2, 29 + 0 * 60 + 4); // fuelLapsRemaining
    statBuf.writeUInt8(7, 29 + 0 * 60 + 8); // tyreCompound
    statBuf.writeUInt8(5, 29 + 0 * 60 + 9); // tyreAgeLaps
    statBuf.writeUInt8(2, 29 + 0 * 60 + 10); // ersDeployMode
    const statArr = parseCarStatusPacket(statBuf);
    expect(statArr?.[0].fuelRemaining).toBeCloseTo(30.5);
    expect(statArr?.[0].tyreAgeLaps).toBe(5);
    // CarDamage
    const dmgBuf = Buffer.alloc(29 + 40 * 22);
    dmgBuf.writeUInt8(10, 29 + 0 * 40 + 0); // frontWingLeft
    dmgBuf.writeUInt8(20, 29 + 0 * 40 + 1); // frontWingRight
    dmgBuf.writeUInt8(30, 29 + 0 * 40 + 2); // rearWing
    dmgBuf.writeUInt8(40, 29 + 0 * 40 + 3); // floor
    dmgBuf.writeUInt8(50, 29 + 0 * 40 + 4); // sidepod
    dmgBuf.writeUInt8(60, 29 + 0 * 40 + 5); // engine
    dmgBuf.writeUInt8(70, 29 + 0 * 40 + 6); // gearbox
    const dmgArr = parseCarDamagePacket(dmgBuf);
    expect(dmgArr?.[0].frontWingLeft).toBe(10);
    expect(dmgArr?.[0].gearbox).toBe(70);
  });

  it('parses Event packet with eventCode', () => {
    const buf = Buffer.alloc(29 + 9);
    buf.write('FTLP', 29, 'ascii');
    buf.writeUInt8(2, 33); // carIndex
    buf.writeFloatLE(88.123, 34); // lapTime
    const parsed = parseEventPacket(buf);
    expect(parsed?.type).toBe('FastestLap');
    expect(parsed?.details.carIndex).toBe(2);
    expect(parsed?.details.lapTime).toBeCloseTo(88.123);
  });
});
