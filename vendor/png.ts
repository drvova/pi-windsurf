/**
 * Minimal pure-Node PNG decoder — adapted from WindsurfAPI.
 * Built on node:zlib. Decodes 8-bit non-interlaced PNG to RGBA.
 * Throws on unsupported variants; callers fall back to forwarding original.
 */
import * as zlib from "node:zlib";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MAX_DIMENSION = 0x7fff; // 32767 px per side
const MAX_PIXELS = 40 * 1024 * 1024; // ~40M pixels

// Bytes per pixel for each PNG color type at 8-bit depth.
// 0=grayscale 2=RGB 3=palette 4=grayscale+alpha 6=RGBA
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(raw: Buffer, height: number, bytesPerRow: number, bpp: number): Buffer {
  const out = Buffer.alloc(height * bytesPerRow);
  let rawPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawPos++];
    const outRow = y * bytesPerRow;
    const prevRow = outRow - bytesPerRow;
    for (let x = 0; x < bytesPerRow; x++) {
      const rawByte = raw[rawPos++];
      const a = x >= bpp ? out[outRow + x - bpp] : 0;
      const b = y > 0 ? out[prevRow + x] : 0;
      const c = (y > 0 && x >= bpp) ? out[prevRow + x - bpp] : 0;
      let val = 0;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: val = rawByte + paethPredictor(a, b, c); break;
        default: throw new Error(`PNG: unknown filter type ${filter}`);
      }
      out[outRow + x] = val & 0xff;
    }
  }
  return out;
}

function toRGBA(pixels: Buffer, width: number, height: number, colorType: number, palette: Buffer | null, trns: Buffer | null): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  const n = width * height;
  if (colorType === 6) return pixels.subarray(0, n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (colorType === 0) {
      const g = pixels[i];
      rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = 255;
    } else if (colorType === 4) {
      const g = pixels[i * 2];
      rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = pixels[i * 2 + 1];
    } else if (colorType === 2) {
      rgba[o] = pixels[i * 3]; rgba[o + 1] = pixels[i * 3 + 1]; rgba[o + 2] = pixels[i * 3 + 2]; rgba[o + 3] = 255;
    } else if (colorType === 3 && palette) {
      const idx = pixels[i];
      const p = idx * 3;
      rgba[o] = palette[p]; rgba[o + 1] = palette[p + 1]; rgba[o + 2] = palette[p + 2];
      rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return rgba;
}

export interface DecodedPng {
  width: number;
  height: number;
  data: Buffer;
}

export function decodePng(buf: Buffer): DecodedPng {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error("PNG: bad signature");
  }
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos); pos += 4;
    const type = buf.toString("ascii", pos, pos + 4); pos += 4;
    const dataStart = pos;
    if (dataStart + len > buf.length) throw new Error("PNG: truncated chunk");

    if (type === "IHDR") {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      interlace = buf[dataStart + 12];
      if (bitDepth !== 8) throw new Error(`PNG: unsupported bit depth ${bitDepth}`);
      if (interlace !== 0) throw new Error("PNG: interlaced not supported");
      if (!(colorType in CHANNELS)) throw new Error(`PNG: unsupported color type ${colorType}`);
      if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw new Error(`PNG: dimensions ${width}x${height} exceed limit ${MAX_DIMENSION}`);
      }
      if (width * height > MAX_PIXELS) {
        throw new Error(`PNG: pixel count ${width * height} exceeds limit ${MAX_PIXELS}`);
      }
    } else if (type === "PLTE") {
      palette = buf.subarray(dataStart, dataStart + len);
    } else if (type === "tRNS") {
      trns = buf.subarray(dataStart, dataStart + len);
    } else if (type === "IDAT") {
      idat.push(buf.subarray(dataStart, dataStart + len));
    } else if (type === "IEND") {
      break;
    }
    pos = dataStart + len + 4;
  }

  if (idat.length === 0) throw new Error("PNG: no IDAT");
  const compressed = Buffer.concat(idat);
  const bpp = CHANNELS[colorType];
  const bytesPerRow = width * bpp;
  const raw = zlib.gunzipSync(compressed);
  const unfiltered = unfilter(raw, height, bytesPerRow, bpp);
  const rgba = toRGBA(unfiltered, width, height, colorType, palette, trns);
  return { width, height, data: rgba };
}
