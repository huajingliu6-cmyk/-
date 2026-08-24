export function readImageDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (buffer.length < 24) return null;

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (segmentLength < 2) break;
      offset += 2 + segmentLength;
    }
    return null;
  }

  if (
    buffer.length >= 30 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X" && buffer.length >= 30) {
      const width =
        1 +
        buffer.readUIntLE(24, 1) +
        (buffer.readUIntLE(25, 1) << 8) +
        (buffer.readUIntLE(26, 1) << 16);
      const height =
        1 +
        buffer.readUIntLE(27, 1) +
        (buffer.readUIntLE(28, 1) << 8) +
        (buffer.readUIntLE(29, 1) << 16);
      return { width, height };
    }
    if (chunk === "VP8 " && buffer.length >= 30) {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }
    if (chunk === "VP8L" && buffer.length >= 25) {
      const bits =
        buffer[21] |
        (buffer[22] << 8) |
        (buffer[23] << 16) |
        (buffer[24] << 24);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
  }

  return null;
}
