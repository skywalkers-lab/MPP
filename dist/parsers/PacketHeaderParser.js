export function parsePacketHeader(buf) {
    // F1 25 UDP Header is 29 bytes (as of 2025 spec)
    if (buf.length < 29)
        return null;
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
    }
    catch (e) {
        return null;
    }
}
