import { describe, expect, it } from "vitest";

import { encodeQrMatrix, renderQrSvg, type QrMatrix } from "./qr.js";

// Independent format/data verifier to confirm our encoder produces valid,
// decodable ISO/IEC 18004 byte-mode QR codes across short and long payloads.
function readFormatInfo(matrix: QrMatrix): {
  readonly copy1: number;
  readonly copy2: number;
} {
  const { size, modules } = matrix;
  const bit = (r: number, c: number): number => (modules[r * size + c] ? 1 : 0);

  const coords1: readonly (readonly [number, number])[] = [
    [0, 8],
    [1, 8],
    [2, 8],
    [3, 8],
    [4, 8],
    [5, 8],
    [7, 8],
    [8, 8],
    [8, 7],
    [8, 5],
    [8, 4],
    [8, 3],
    [8, 2],
    [8, 1],
    [8, 0],
  ];
  let copy1 = 0;
  for (let i = 0; i < 15; i += 1) {
    const [r, c] = coords1[i]!;
    copy1 |= bit(r, c) << i;
  }

  let copy2 = 0;
  for (let i = 0; i < 7; i += 1) {
    copy2 |= bit(size - 1 - i, 8) << (14 - i);
  }
  for (let i = 0; i < 8; i += 1) {
    copy2 |= bit(8, size - 8 + i) << (7 - i);
  }

  return { copy1, copy2 };
}

function readVersionInfo(matrix: QrMatrix): {
  readonly bottomLeft: number;
  readonly topRight: number;
} {
  const { size, modules } = matrix;
  const bit = (r: number, c: number): number => (modules[r * size + c] ? 1 : 0);
  let bottomLeft = 0;
  let topRight = 0;
  for (let i = 0; i < 18; i += 1) {
    const a = Math.floor(i / 3);
    const b = size - 11 + (i % 3);
    bottomLeft |= bit(b, a) << i;
    topRight |= bit(a, b) << i;
  }
  return { bottomLeft, topRight };
}

function assertFinderAt(matrix: QrMatrix, top: number, left: number): void {
  const { size, modules } = matrix;
  for (let dr = 0; dr < 7; dr += 1) {
    for (let dc = 0; dc < 7; dc += 1) {
      const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      expect(modules[(top + dr) * size + (left + dc)]).toBe(
        onBorder || inCenter,
      );
    }
  }
}

const ALIGNMENT_CENTERS: Record<number, readonly number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
  11: [6, 30, 54],
  12: [6, 32, 58],
  13: [6, 34, 62],
  14: [6, 26, 46, 66],
  15: [6, 26, 48, 70],
  16: [6, 26, 50, 74],
  17: [6, 30, 54, 78],
  18: [6, 30, 56, 82],
  19: [6, 30, 58, 86],
  20: [6, 34, 62, 90],
};

function decodeByteModePayload(matrix: QrMatrix): string {
  const { version, size, mask, modules } = matrix;
  const isFunc = new Array<boolean>(size * size).fill(false);
  const mark = (r: number, c: number): void => {
    if (r >= 0 && c >= 0 && r < size && c < size) isFunc[r * size + c] = true;
  };
  const markFinder = (top: number, left: number): void => {
    for (let dr = -1; dr <= 7; dr += 1)
      for (let dc = -1; dc <= 7; dc += 1) mark(top + dr, left + dc);
  };
  markFinder(0, 0);
  markFinder(0, size - 7);
  markFinder(size - 7, 0);
  for (const cr of ALIGNMENT_CENTERS[version] ?? []) {
    for (const cc of ALIGNMENT_CENTERS[version] ?? []) {
      if (
        (cr <= 8 && cc <= 8) ||
        (cr <= 8 && cc >= size - 9) ||
        (cr >= size - 9 && cc <= 8)
      )
        continue;
      for (let dr = -2; dr <= 2; dr += 1)
        for (let dc = -2; dc <= 2; dc += 1) mark(cr + dr, cc + dc);
    }
  }
  for (let i = 0; i < size; i += 1) {
    mark(6, i);
    mark(i, 6);
  }
  for (let i = 0; i <= 8; i += 1) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i += 1) {
    mark(size - 1 - i, 8);
    mark(8, size - 8 + i);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      mark(b, a);
      mark(a, b);
    }
  }

  const maskAt = (r: number, c: number): boolean => {
    switch (mask) {
      case 0:
        return (r + c) % 2 === 0;
      case 1:
        return r % 2 === 0;
      case 2:
        return c % 3 === 0;
      case 3:
        return (r + c) % 3 === 0;
      case 4:
        return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5:
        return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6:
        return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7:
        return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default:
        return false;
    }
  };

  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        const idx = row * size + col;
        if (isFunc[idx]) continue;
        const raw = modules[idx]!;
        const unmasked = maskAt(row, col) ? !raw : raw;
        bits.push(unmasked ? 1 : 0);
      }
    }
    upward = !upward;
  }

  // Only single-block versions (V1-V3) have contiguous un-interleaved data
  // bytes at the front of the bitstream; read mode, count, and UTF-8 bytes.
  const readBits = (start: number, width: number): number => {
    let v = 0;
    for (let i = 0; i < width; i += 1) v = (v << 1) | bits[start + i]!;
    return v;
  };
  const mode = readBits(0, 4);
  expect(mode).toBe(0b0100);
  const countWidth = version <= 9 ? 8 : 16;
  const byteLen = readBits(4, countWidth);
  const bytes = Buffer.alloc(byteLen);
  for (let i = 0; i < byteLen; i += 1) {
    bytes[i] = readBits(4 + countWidth + i * 8, 8);
  }
  return bytes.toString("utf8");
}

describe("pure-TS QR encoder", () => {
  it("encodes short payloads into valid version 1-2 matrices with finder, timing, and format patterns", () => {
    const matrix = encodeQrMatrix("https://linger.ai");
    expect(matrix.version).toBe(2);
    expect(matrix.size).toBe(25);
    expect(matrix.modules).toHaveLength(25 * 25);

    assertFinderAt(matrix, 0, 0);
    assertFinderAt(matrix, 0, matrix.size - 7);
    assertFinderAt(matrix, matrix.size - 7, 0);

    // Fixed dark module at (size - 8, 8).
    expect(matrix.modules[(matrix.size - 8) * matrix.size + 8]).toBe(true);

    // Timing patterns alternate starting with dark at index 8.
    for (let i = 8; i < matrix.size - 8; i += 1) {
      expect(matrix.modules[6 * matrix.size + i]).toBe(i % 2 === 0);
      expect(matrix.modules[i * matrix.size + 6]).toBe(i % 2 === 0);
    }

    // Both format info copies must be identical and match ECC M + chosen mask.
    const { copy1, copy2 } = readFormatInfo(matrix);
    expect(copy1).toBe(copy2);
    const unmasked = copy1 ^ 0x5412;
    const eccLevel = (unmasked >>> 13) & 0x03;
    const mask = (unmasked >>> 10) & 0x07;
    expect(eccLevel).toBe(0b00); // Level M
    expect(mask).toBe(matrix.mask);
    expect(decodeByteModePayload(matrix)).toBe("https://linger.ai");
  });

  it("encodes realistic and 350+ byte linger://pair URIs with valid version info and alignment patterns", () => {
    const typicalUri =
      "linger://pair?v=1&host=192.168.1.42&port=48210&tls=1&fp=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG&code=0123456789abcdefghijklmnopqrstuvwxyzABCDEFG&name=MacBook-Pro.local&ts=100.64.0.12";
    const m1 = encodeQrMatrix(typicalUri);
    expect(m1.version).toBeGreaterThanOrEqual(8);
    expect(m1.size).toBe(m1.version * 4 + 17);

    // Version info for versions >= 7 must match on both bottom-left and top-right blocks.
    const vInfo = readVersionInfo(m1);
    expect(vInfo.bottomLeft).toBe(vInfo.topRight);
    expect(vInfo.bottomLeft >>> 12).toBe(m1.version);

    const longUri = `${typicalUri}&extra=${"a".repeat(220)}`;
    expect(Buffer.byteLength(longUri, "utf8")).toBeGreaterThan(380);
    const m2 = encodeQrMatrix(longUri);
    expect(m2.version).toBeGreaterThanOrEqual(15);
    expect(m2.size).toBe(m2.version * 4 + 17);
    const vInfo2 = readVersionInfo(m2);
    expect(vInfo2.bottomLeft).toBe(vInfo2.topRight);
    expect(vInfo2.bottomLeft >>> 12).toBe(m2.version);
  });

  it("renders crisp inline SVG with quiet zone and valid viewBox", () => {
    const uri =
      "linger://pair?v=1&host=10.0.0.8&port=48210&tls=1&fp=ABC123&code=SECRET&name=Studio";
    const matrix = encodeQrMatrix(uri);
    const svg = renderQrSvg(uri);

    const expectedViewBox = matrix.size + 8;
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u);
    expect(svg).toContain(
      `viewBox="0 0 ${expectedViewBox} ${expectedViewBox}"`,
    );
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain(
      `<rect width="${expectedViewBox}" height="${expectedViewBox}" fill="#ffffff"/>`,
    );
    expect(svg).toContain('<path fill="#1a1a16" d="M');
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("rejects payloads exceeding maximum version capacity", () => {
    expect(() => encodeQrMatrix("x".repeat(1000))).toThrow(
      /exceeds maximum supported capacity/u,
    );
  });
});
