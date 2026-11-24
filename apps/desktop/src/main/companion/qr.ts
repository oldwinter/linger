// Pure TypeScript ISO/IEC 18004 QR Code encoder (Byte mode, ECC Level M,
// Versions 1..20, all 8 masks with ISO penalty scoring, SVG renderer).

export interface QrMatrix {
  readonly version: number;
  readonly size: number;
  readonly mask: number;
  // Flat row-major boolean array (true = dark module, false = light module).
  readonly modules: readonly boolean[];
}

interface VersionSpec {
  readonly version: number;
  readonly totalCodewords: number;
  readonly ecCodewordsPerBlock: number;
  readonly group1Blocks: number;
  readonly group1DataCodewords: number;
  readonly group2Blocks: number;
  readonly group2DataCodewords: number;
  readonly alignmentCenters: readonly number[];
}

// ISO/IEC 18004 Table 9 (Error Correction Level M) and Annex E alignment tables.
const VERSION_SPECS: readonly VersionSpec[] = [
  {
    version: 1,
    totalCodewords: 26,
    ecCodewordsPerBlock: 10,
    group1Blocks: 1,
    group1DataCodewords: 16,
    group2Blocks: 0,
    group2DataCodewords: 0,
    alignmentCenters: [],
  },
  {
    version: 2,
    totalCodewords: 44,
    ecCodewordsPerBlock: 16,
    group1Blocks: 1,
    group1DataCodewords: 28,
    group2Blocks: 0,
    group2DataCodewords: 0,
    alignmentCenters: [6, 18],
  },
  {
    version: 3,
    totalCodewords: 70,
    ecCodewordsPerBlock: 26,
    group1Blocks: 1,
    group1DataCodewords: 44,
    group2Blocks: 0,
    group2DataCodewords: 0,
    alignmentCenters: [6, 22],
  },
  {
    version: 4,
    totalCodewords: 100,
    ecCodewordsPerBlock: 18,
    group1Blocks: 2,
    group1DataCodewords: 32,
    group2Blocks: 0,
    group2DataCodewords: 0,
    alignmentCenters: [6, 26],
  },
  {
    version: 5,
    totalCodewords: 134,
    ecCodewordsPerBlock: 24,
    group1Blocks: 2,
    group1DataCodewords: 43,
    group2Blocks: 0,
    group2DataCodewords: 0,
    alignmentCenters: [6, 30],
  },
  {
    version: 6,
    totalCodewords: 172,
    ecCodewordsPerBlock: 16,
    group1Blocks: 4,
    group1DataCodewords: 27,
    group2Blocks: 0,
    group2DataCodewords: 0,
    alignmentCenters: [6, 34],
  },
  {
    version: 7,
    totalCodewords: 196,
    ecCodewordsPerBlock: 18,
    group1Blocks: 4,
    group1DataCodewords: 31,
    group2Blocks: 0,
    group2DataCodewords: 0,
    alignmentCenters: [6, 22, 38],
  },
  {
    version: 8,
    totalCodewords: 242,
    ecCodewordsPerBlock: 22,
    group1Blocks: 2,
    group1DataCodewords: 38,
    group2Blocks: 2,
    group2DataCodewords: 39,
    alignmentCenters: [6, 24, 42],
  },
  {
    version: 9,
    totalCodewords: 292,
    ecCodewordsPerBlock: 22,
    group1Blocks: 3,
    group1DataCodewords: 36,
    group2Blocks: 2,
    group2DataCodewords: 37,
    alignmentCenters: [6, 26, 46],
  },
  {
    version: 10,
    totalCodewords: 346,
    ecCodewordsPerBlock: 26,
    group1Blocks: 4,
    group1DataCodewords: 43,
    group2Blocks: 1,
    group2DataCodewords: 44,
    alignmentCenters: [6, 28, 50],
  },
  {
    version: 11,
    totalCodewords: 404,
    ecCodewordsPerBlock: 30,
    group1Blocks: 1,
    group1DataCodewords: 50,
    group2Blocks: 4,
    group2DataCodewords: 51,
    alignmentCenters: [6, 30, 54],
  },
  {
    version: 12,
    totalCodewords: 466,
    ecCodewordsPerBlock: 22,
    group1Blocks: 6,
    group1DataCodewords: 36,
    group2Blocks: 2,
    group2DataCodewords: 37,
    alignmentCenters: [6, 32, 58],
  },
  {
    version: 13,
    totalCodewords: 532,
    ecCodewordsPerBlock: 22,
    group1Blocks: 8,
    group1DataCodewords: 37,
    group2Blocks: 1,
    group2DataCodewords: 38,
    alignmentCenters: [6, 34, 62],
  },
  {
    version: 14,
    totalCodewords: 581,
    ecCodewordsPerBlock: 24,
    group1Blocks: 4,
    group1DataCodewords: 40,
    group2Blocks: 5,
    group2DataCodewords: 41,
    alignmentCenters: [6, 26, 46, 66],
  },
  {
    version: 15,
    totalCodewords: 655,
    ecCodewordsPerBlock: 24,
    group1Blocks: 5,
    group1DataCodewords: 41,
    group2Blocks: 5,
    group2DataCodewords: 42,
    alignmentCenters: [6, 26, 48, 70],
  },
  {
    version: 16,
    totalCodewords: 733,
    ecCodewordsPerBlock: 28,
    group1Blocks: 7,
    group1DataCodewords: 45,
    group2Blocks: 3,
    group2DataCodewords: 46,
    alignmentCenters: [6, 26, 50, 74],
  },
  {
    version: 17,
    totalCodewords: 815,
    ecCodewordsPerBlock: 28,
    group1Blocks: 10,
    group1DataCodewords: 46,
    group2Blocks: 1,
    group2DataCodewords: 47,
    alignmentCenters: [6, 30, 54, 78],
  },
  {
    version: 18,
    totalCodewords: 901,
    ecCodewordsPerBlock: 26,
    group1Blocks: 9,
    group1DataCodewords: 43,
    group2Blocks: 4,
    group2DataCodewords: 44,
    alignmentCenters: [6, 30, 56, 82],
  },
  {
    version: 19,
    totalCodewords: 991,
    ecCodewordsPerBlock: 26,
    group1Blocks: 3,
    group1DataCodewords: 44,
    group2Blocks: 11,
    group2DataCodewords: 45,
    alignmentCenters: [6, 30, 58, 86],
  },
  {
    version: 20,
    totalCodewords: 1085,
    ecCodewordsPerBlock: 26,
    group1Blocks: 3,
    group1DataCodewords: 41,
    group2Blocks: 13,
    group2DataCodewords: 42,
    alignmentCenters: [6, 34, 62, 90],
  },
];

// GF(256) with primitive polynomial 0x11d (x^8 + x^4 + x^3 + x^2 + 1).
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) {
    GF_EXP[i] = GF_EXP[i - 255]!;
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i]!;
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, root);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGenerator(ecCount);
  const rem = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i += 1) {
    const factor = data[i]! ^ rem[0]!;
    rem.copyWithin(0, 1);
    rem[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j += 1) {
        rem[j] = rem[j]! ^ gfMul(gen[j + 1]!, factor);
      }
    }
  }
  return rem;
}

function dataCapacityBytes(spec: VersionSpec): number {
  return (
    spec.group1Blocks * spec.group1DataCodewords +
    spec.group2Blocks * spec.group2DataCodewords
  );
}

function selectVersion(payloadLength: number): VersionSpec {
  for (const spec of VERSION_SPECS) {
    const countBits = spec.version <= 9 ? 8 : 16;
    const totalBitsNeeded = 4 + countBits + payloadLength * 8;
    const capacityBits = dataCapacityBytes(spec) * 8;
    if (totalBitsNeeded <= capacityBits) return spec;
  }
  throw new Error(
    `QR payload length ${payloadLength} exceeds maximum supported capacity`,
  );
}

function encodeDataCodewords(
  payload: Uint8Array,
  spec: VersionSpec,
): Uint8Array {
  const dataBytes = dataCapacityBytes(spec);
  const capacityBits = dataBytes * 8;
  const bits: number[] = [];
  const pushBits = (value: number, width: number): void => {
    for (let i = width - 1; i >= 0; i -= 1) {
      bits.push((value >>> i) & 1);
    }
  };

  // Byte mode indicator: 0100.
  pushBits(0b0100, 4);
  pushBits(payload.length, spec.version <= 9 ? 8 : 16);
  for (const byte of payload) {
    pushBits(byte, 8);
  }

  // Terminator: up to 4 zero bits.
  const terminatorLen = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < terminatorLen; i += 1) bits.push(0);

  // Pad to byte boundary.
  while (bits.length % 8 !== 0) bits.push(0);

  const out = new Uint8Array(dataBytes);
  const fullBytes = bits.length / 8;
  for (let i = 0; i < fullBytes; i += 1) {
    let value = 0;
    for (let b = 0; b < 8; b += 1) {
      value = (value << 1) | bits[i * 8 + b]!;
    }
    out[i] = value;
  }

  // Alternating pad codewords 0xEC and 0x11.
  let padIndex = 0;
  for (let i = fullBytes; i < dataBytes; i += 1) {
    out[i] = padIndex % 2 === 0 ? 0xec : 0x11;
    padIndex += 1;
  }
  return out;
}

function buildFinalCodewords(
  dataCodewords: Uint8Array,
  spec: VersionSpec,
): Uint8Array {
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;

  for (let i = 0; i < spec.group1Blocks; i += 1) {
    const block = dataCodewords.subarray(
      offset,
      offset + spec.group1DataCodewords,
    );
    offset += spec.group1DataCodewords;
    dataBlocks.push(block);
    ecBlocks.push(rsRemainder(block, spec.ecCodewordsPerBlock));
  }
  for (let i = 0; i < spec.group2Blocks; i += 1) {
    const block = dataCodewords.subarray(
      offset,
      offset + spec.group2DataCodewords,
    );
    offset += spec.group2DataCodewords;
    dataBlocks.push(block);
    ecBlocks.push(rsRemainder(block, spec.ecCodewordsPerBlock));
  }

  const out = new Uint8Array(spec.totalCodewords);
  let pos = 0;
  const maxDataLen = Math.max(
    spec.group1DataCodewords,
    spec.group2DataCodewords,
  );
  for (let i = 0; i < maxDataLen; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) {
        out[pos] = block[i]!;
        pos += 1;
      }
    }
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i += 1) {
    for (const ec of ecBlocks) {
      out[pos] = ec[i]!;
      pos += 1;
    }
  }
  return out;
}

function computeFormatBitsM(mask: number): number {
  // Error correction level M has format indicator 0b00.
  const data = (0b00 << 3) | (mask & 0x07);
  let rem = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rem >>> i) & 1) {
      rem ^= 0x537 << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function computeVersionBits(version: number): number {
  let rem = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((rem >>> i) & 1) {
      rem ^= 0x1f25 << (i - 12);
    }
  }
  return (version << 12) | rem;
}

function maskCondition(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return false;
  }
}

interface BaseMatrix {
  readonly size: number;
  readonly modules: boolean[];
  readonly isFunction: boolean[];
}

function buildBaseMatrix(spec: VersionSpec): BaseMatrix {
  const size = spec.version * 4 + 17;
  const modules = new Array<boolean>(size * size).fill(false);
  const isFunction = new Array<boolean>(size * size).fill(false);

  const setFunction = (r: number, c: number, dark: boolean): void => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    const idx = r * size + c;
    modules[idx] = dark;
    isFunction[idx] = true;
  };

  // Finder patterns (7x7) plus 1-module white separator border.
  const placeFinder = (top: number, left: number): void => {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        const dark = inOuter && (onBorder || inCenter);
        setFunction(top + dr, left + dc, dark);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Alignment patterns (5x5).
  const centers = spec.alignmentCenters;
  for (const cr of centers) {
    for (const cc of centers) {
      const overlapsTopLeft = cr <= 8 && cc <= 8;
      const overlapsTopRight = cr <= 8 && cc >= size - 9;
      const overlapsBottomLeft = cr >= size - 9 && cc <= 8;
      if (overlapsTopLeft || overlapsTopRight || overlapsBottomLeft) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFunction(cr + dr, cc + dc, dist !== 1);
        }
      }
    }
  }

  // Timing patterns along row 6 and column 6.
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    if (!isFunction[6 * size + i]) setFunction(6, i, dark);
    if (!isFunction[i * size + 6]) setFunction(i, 6, dark);
  }

  // Fixed dark module.
  setFunction(size - 8, 8, true);

  // Reserve format info modules (written per mask later).
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      setFunction(8, i, false);
      setFunction(i, 8, false);
    }
  }
  for (let i = 0; i < 7; i += 1) {
    setFunction(size - 1 - i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    setFunction(8, size - 8 + i, false);
  }

  // Version information for versions >= 7.
  if (spec.version >= 7) {
    const vBits = computeVersionBits(spec.version);
    for (let i = 0; i < 18; i += 1) {
      const bit = ((vBits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFunction(b, a, bit);
      setFunction(a, b, bit);
    }
  }

  return { size, modules, isFunction };
}

function writeFormatInfo(modules: boolean[], size: number, mask: number): void {
  const bits = computeFormatBitsM(mask);
  const bitAt = (index: number): boolean => ((bits >>> index) & 1) === 1;

  // Copy 1: around top-left finder pattern.
  const copy1: readonly (readonly [number, number])[] = [
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
  for (let i = 0; i < 15; i += 1) {
    const [r, c] = copy1[i]!;
    modules[r * size + c] = bitAt(i);
  }

  // Copy 2: bottom-left (bits 14..8) and top-right (bits 7..0).
  for (let i = 0; i < 7; i += 1) {
    modules[(size - 1 - i) * size + 8] = bitAt(14 - i);
  }
  for (let i = 0; i < 8; i += 1) {
    modules[8 * size + (size - 8 + i)] = bitAt(7 - i);
  }
}

function placeDataCodewords(base: BaseMatrix, codewords: Uint8Array): void {
  const { size, modules, isFunction } = base;
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        const idx = row * size + col;
        if (isFunction[idx]) continue;
        let dark = false;
        if (bitIndex < totalBits) {
          const byte = codewords[bitIndex >>> 3]!;
          dark = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex += 1;
        }
        modules[idx] = dark;
      }
    }
    upward = !upward;
  }
}

function applyMask(base: BaseMatrix, mask: number): boolean[] {
  const { size, modules, isFunction } = base;
  const out = modules.slice();
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const idx = row * size + col;
      if (!isFunction[idx] && maskCondition(mask, row, col)) {
        out[idx] = !out[idx];
      }
    }
  }
  writeFormatInfo(out, size, mask);
  return out;
}

// ISO/IEC 18004 Section 7.8.3.1 penalty score across all 4 rules.
function penaltyScore(modules: readonly boolean[], size: number): number {
  let score = 0;

  // Rule 1: 5+ consecutive same-colored modules in row or column.
  for (let r = 0; r < size; r += 1) {
    let runColor = modules[r * size]!;
    let runLen = 1;
    for (let c = 1; c < size; c += 1) {
      const color = modules[r * size + c]!;
      if (color === runColor) {
        runLen += 1;
      } else {
        if (runLen >= 5) score += 3 + (runLen - 5);
        runColor = color;
        runLen = 1;
      }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);
  }
  for (let c = 0; c < size; c += 1) {
    let runColor = modules[c]!;
    let runLen = 1;
    for (let r = 1; r < size; r += 1) {
      const color = modules[r * size + c]!;
      if (color === runColor) {
        runLen += 1;
      } else {
        if (runLen >= 5) score += 3 + (runLen - 5);
        runColor = color;
        runLen = 1;
      }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);
  }

  // Rule 2: 2x2 blocks of same color.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const a = modules[r * size + c]!;
      if (
        a === modules[r * size + c + 1]! &&
        a === modules[(r + 1) * size + c]! &&
        a === modules[(r + 1) * size + c + 1]!
      ) {
        score += 3;
      }
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns with 4 light modules on either side.
  const matchFinderPattern = (
    get: (i: number) => boolean,
    start: number,
  ): boolean => {
    // 10111010000 or 00001011101
    const a =
      get(start) &&
      !get(start + 1) &&
      get(start + 2) &&
      get(start + 3) &&
      get(start + 4) &&
      !get(start + 5) &&
      get(start + 6) &&
      !get(start + 7) &&
      !get(start + 8) &&
      !get(start + 9) &&
      !get(start + 10);
    if (a) return true;
    return (
      !get(start) &&
      !get(start + 1) &&
      !get(start + 2) &&
      !get(start + 3) &&
      get(start + 4) &&
      !get(start + 5) &&
      get(start + 6) &&
      get(start + 7) &&
      get(start + 8) &&
      !get(start + 9) &&
      get(start + 10)
    );
  };
  for (let r = 0; r < size; r += 1) {
    const get = (c: number): boolean => modules[r * size + c]!;
    for (let c = 0; c <= size - 11; c += 1) {
      if (matchFinderPattern(get, c)) score += 40;
    }
  }
  for (let c = 0; c < size; c += 1) {
    const get = (r: number): boolean => modules[r * size + c]!;
    for (let r = 0; r <= size - 11; r += 1) {
      if (matchFinderPattern(get, r)) score += 40;
    }
  }

  // Rule 4: balance of dark vs light modules.
  let darkCount = 0;
  for (const mod of modules) {
    if (mod) darkCount += 1;
  }
  const total = size * size;
  const k = Math.floor(Math.abs(darkCount * 20 - total * 10) / total);
  score += k * 10;

  return score;
}

export function encodeQrMatrix(text: string): QrMatrix {
  const payload = Buffer.from(text, "utf8");
  const spec = selectVersion(payload.length);
  const dataCodewords = encodeDataCodewords(payload, spec);
  const finalCodewords = buildFinalCodewords(dataCodewords, spec);
  const base = buildBaseMatrix(spec);
  placeDataCodewords(base, finalCodewords);

  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestModules: boolean[] = [];

  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = applyMask(base, mask);
    const score = penaltyScore(candidate, base.size);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      bestModules = candidate;
    }
  }

  return {
    version: spec.version,
    size: base.size,
    mask: bestMask,
    modules: bestModules,
  };
}

export interface RenderQrSvgOptions {
  readonly quietZone?: number;
  readonly foreground?: string;
  readonly background?: string;
}

export function renderQrSvg(
  text: string,
  options: RenderQrSvgOptions = {},
): string {
  const matrix = encodeQrMatrix(text);
  const quietZone = options.quietZone ?? 4;
  const foreground = options.foreground ?? "#1a1a16";
  const background = options.background ?? "#ffffff";
  const total = matrix.size + quietZone * 2;

  const segments: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.modules[row * matrix.size + col]) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < matrix.size && matrix.modules[row * matrix.size + col]) {
        col += 1;
      }
      const runWidth = col - start;
      segments.push(
        `M${start + quietZone} ${row + quietZone}h${runWidth}v1h-${runWidth}z`,
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="Pairing QR code">`,
    `<rect width="${total}" height="${total}" fill="${background}"/>`,
    `<path fill="${foreground}" d="${segments.join("")}"/>`,
    `</svg>`,
  ].join("");
}
