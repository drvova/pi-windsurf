/**
 * Image processing for Windsurf provider.
 *
 * Detects real format from magic bytes, reads header dimensions, classifies
 * oversize, and downscales/re-encodes PNG/JPEG to fit upstream limits.
 *
 * Adapted from WindsurfAPI src/image.js with vendored zero-dependency
 * PNG decoder and jpeg-js decode/encode. Falls back to forwarding the
 * original on any decode/encode failure so a bad image never fails a chat.
 */

import { decodePng } from "./vendor/png.ts";
import jpegDecode from "./vendor/jpeg/decoder.js";
import jpegEncode from "./vendor/jpeg/encoder.js";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB source limit
const MAX_BASE64_LEN = Math.ceil(MAX_SIZE * 4 / 3) + 100;
export const MIME_OK = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const IMAGE_MAX_LONG_SIDE = 1568;
const IMAGE_MAX_BYTES = 400_000; // base64 wire budget
const IMAGE_JPEG_QUALITY = 85;
const IMAGE_MAX_DECODE_PIXELS = 40 * 1024 * 1024;

const MIN_LONG_SIDE = 128;
const MIN_JPEG_QUALITY = 60;

const FORMAT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

interface DecodedImage {
  width: number;
  height: number;
  data: Buffer;
}

interface ShrinkResult {
  ok: boolean;
  base64_data?: string;
  mime_type?: string;
  error?: string;
}

interface ImageDecision {
  base64_data: string;
  mime_type: string;
  format: string | null;
  width: number | null;
  height: number | null;
  base64Len: number;
  oversizeBytes: boolean;
  oversizeDimensions: boolean;
  resized: boolean;
  dropped: boolean;
  reason: string | null;
}

// Bilinear downscale of RGBA buffer.
function scaleRGBA(src: Buffer, srcW: number, srcH: number, dstW: number, dstH: number): Buffer {
  const out = Buffer.alloc(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let dy = 0; dy < dstH; dy++) {
    const sy = (dy + 0.5) * yRatio - 0.5;
    let y0 = Math.floor(sy);
    const wy = sy - y0;
    if (y0 < 0) y0 = 0;
    const y1 = Math.min(y0 + 1, srcH - 1);
    for (let dx = 0; dx < dstW; dx++) {
      const sx = (dx + 0.5) * xRatio - 0.5;
      let x0 = Math.floor(sx);
      const wx = sx - x0;
      if (x0 < 0) x0 = 0;
      const x1 = Math.min(x0 + 1, srcW - 1);
      const o = (dy * dstW + dx) * 4;
      const i00 = (y0 * srcW + x0) * 4;
      const i01 = (y0 * srcW + x1) * 4;
      const i10 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - wx) + src[i01 + c] * wx;
        const bot = src[i10 + c] * (1 - wx) + src[i11 + c] * wx;
        out[o + c] = (top * (1 - wy) + bot * wy + 0.5) | 0;
      }
    }
  }
  return out;
}

function decodePixels(buf: Buffer): DecodedImage {
  const b = buf.subarray(0, 4);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return decodePng(buf);
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    const img = jpegDecode(buf, {
      useTArray: false,
      maxResolutionInMP: 200,
      maxMemoryUsageInMB: 512,
      formatAsRGBA: true,
    });
    return { width: img.width, height: img.height, data: img.data as Buffer };
  }
  throw new Error("unsupported image format for re-encode");
}

export function detectImageFormat(base64: string): string | null {
  if (typeof base64 !== "string" || base64.length === 0) return null;
  const b = decodeHead(base64, 16);
  if (b.length < 4) return null;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 &&
      b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null;
}

function decodeHead(base64: string, n: number): Buffer {
  const chars = Math.min(base64.length, Math.ceil(n / 3) * 4) & ~3;
  if (chars <= 0) return Buffer.alloc(0);
  try {
    return Buffer.from(base64.slice(0, chars), "base64");
  } catch {
    return Buffer.alloc(0);
  }
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function readPngDimensions(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24) return null;
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readJpegDimensions(b: Buffer): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 <= b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; continue;
    }
    if (i + 4 > b.length) break;
    const segLen = b.readUInt16BE(i + 2);
    if (segLen < 2) break;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (i + 9 > b.length) break;
      const height = b.readUInt16BE(i + 5);
      const width = b.readUInt16BE(i + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + segLen;
  }
  return null;
}

function readGifDimensions(b: Buffer): { width: number; height: number } | null {
  if (b.length < 10) return null;
  const width = b.readUInt16LE(6);
  const height = b.readUInt16LE(8);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readWebpDimensions(b: Buffer): { width: number; height: number } | null {
  if (b.length < 16) return null;
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    if (b.length < 30) return null;
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    const width = b.readUInt16LE(26) & 0x3fff;
    const height = b.readUInt16LE(28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8L") {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | (b1 >> 6));
    return { width, height };
  }
  if (chunk === "VP8X") {
    if (b.length < 30) return null;
    const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { width, height };
  }
  return null;
}

export function readImageDimensions(base64: string, format?: string | null): { width: number; height: number } | null {
  if (typeof base64 !== "string" || base64.length === 0) return null;
  const fmt = detectImageFormat(base64) || (format && FORMAT_TO_MIME[format] ? format : null);
  if (!fmt) return null;
  const headBytes = fmt === "jpeg" ? 256 * 1024 : 64;
  const b = decodeHead(base64, headBytes);
  switch (fmt) {
    case "png": return readPngDimensions(b);
    case "jpeg": return readJpegDimensions(b);
    case "gif": return readGifDimensions(b);
    case "webp": return readWebpDimensions(b);
    default: return null;
  }
}

export async function shrinkPixels(base64: string, opts?: { maxLongSide?: number; maxBytes?: number; quality?: number }): Promise<ShrinkResult> {
  const maxLongSide = opts?.maxLongSide ?? IMAGE_MAX_LONG_SIDE;
  const maxBytes = opts?.maxBytes ?? IMAGE_MAX_BYTES;
  const startQuality = opts?.quality ?? IMAGE_JPEG_QUALITY;
  try {
    const buf = Buffer.from(base64, "base64");
    const headerDims = readImageDimensions(base64);
    if (headerDims && headerDims.width * headerDims.height > IMAGE_MAX_DECODE_PIXELS) {
      return { ok: false, error: `image ${headerDims.width}x${headerDims.height} exceeds decode pixel budget` };
    }
    const original = decodePixels(buf);
    const srcW = original.width;
    const srcH = original.height;
    if (!srcW || !srcH) return { ok: false, error: "decoded image has no dimensions" };

    let curLong = Math.min(maxLongSide, Math.max(srcW, srcH));
    let outBase64 = "";
    for (;;) {
      let w = srcW, h = srcH, data = original.data;
      if (Math.max(srcW, srcH) > curLong) {
        const scale = curLong / Math.max(srcW, srcH);
        w = Math.max(1, Math.round(srcW * scale));
        h = Math.max(1, Math.round(srcH * scale));
        data = scaleRGBA(original.data, srcW, srcH, w, h);
      }
      let quality = startQuality;
      for (;;) {
        const jpg = jpegEncode({ data, width: w, height: h }, quality);
        outBase64 = jpg.data.toString("base64");
        if (outBase64.length <= maxBytes || quality <= MIN_JPEG_QUALITY) break;
        quality = Math.max(MIN_JPEG_QUALITY, quality - 10);
      }
      if (outBase64.length <= maxBytes || curLong <= MIN_LONG_SIDE) break;
      curLong = Math.max(MIN_LONG_SIDE, Math.round(curLong * 0.8));
    }
    return { ok: true, base64_data: outBase64, mime_type: "image/jpeg" };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) };
  }
}

function mimeToFormat(mime: string): string | null {
  const [, sub] = String(mime || "").toLowerCase().split("/") as [string, string | undefined];
  if (!sub) return null;
  if (sub === "jpg" || sub === "jpeg") return "jpeg";
  if (sub === "png") return "png";
  if (sub === "gif") return "gif";
  if (sub === "webp") return "webp";
  return null;
}

export async function maybeShrinkImage(image: { base64_data: string; mime_type?: string }): Promise<ImageDecision> {
  const base64 = image?.base64_data || "";
  const declaredMime = (image?.mime_type || "image/png").toLowerCase();
  const detected = detectImageFormat(base64);
  const declaredFormat = mimeToFormat(declaredMime);
  const format = detected || declaredFormat || null;
  const mime_type = (detected && FORMAT_TO_MIME[detected]) || declaredMime;
  const dims = readImageDimensions(base64, format);
  const width = dims?.width ?? null;
  const height = dims?.height ?? null;
  const base64Len = base64.length;
  const oversizeDimensions = dims ? Math.max(width || 0, height || 0) > IMAGE_MAX_LONG_SIDE : false;
  const oversizeBytes = base64Len > MAX_BASE64_LEN;

  if (oversizeBytes) {
    if (format !== "gif") {
      const shrunk = await shrinkPixels(base64);
      if (shrunk.ok && (shrunk.base64_data?.length || 0) <= MAX_BASE64_LEN) {
        return {
          base64_data: shrunk.base64_data as string,
          mime_type: shrunk.mime_type as string,
          format: "jpeg",
          width, height, base64Len: (shrunk.base64_data as string).length,
          oversizeBytes: false, oversizeDimensions: false, resized: true, dropped: false,
          reason: `re-encoded ${base64Len}B -> ${(shrunk.base64_data as string).length}B JPEG (was byte-oversized)`,
        };
      }
      return {
        base64_data: base64, mime_type, format, width, height, base64Len,
        oversizeBytes: true, oversizeDimensions, resized: false, dropped: true,
        reason: shrunk.ok
          ? `base64 length ${base64Len} exceeds limit ${MAX_BASE64_LEN}; re-encode reached ${shrunk.base64_data?.length} but still over limit`
          : `base64 length ${base64Len} exceeds limit ${MAX_BASE64_LEN} and re-encode failed: ${shrunk.error}`,
      };
    }
    return {
      base64_data: base64, mime_type, format, width, height, base64Len,
      oversizeBytes: true, oversizeDimensions, resized: false, dropped: true,
      reason: `base64 length ${base64Len} exceeds limit ${MAX_BASE64_LEN} and GIF is not re-encoded (may be animated)`,
    };
  }

  if (oversizeDimensions && format !== "gif") {
    const shrunk = await shrinkPixels(base64);
    if (shrunk.ok && (shrunk.base64_data?.length || 0) <= MAX_BASE64_LEN) {
      return {
        base64_data: shrunk.base64_data as string,
        mime_type: shrunk.mime_type as string,
        format: "jpeg",
        width, height, base64Len: (shrunk.base64_data as string).length,
        oversizeBytes: false, oversizeDimensions: false, resized: true, dropped: false,
        reason: `re-encoded long side ${Math.max(width || 0, height || 0)}px -> <=${IMAGE_MAX_LONG_SIDE}px JPEG`,
      };
    }
    return {
      base64_data: base64, mime_type, format, width, height, base64Len,
      oversizeBytes: false, oversizeDimensions: true, resized: false, dropped: false,
      reason: `long side ${Math.max(width || 0, height || 0)}px exceeds ${IMAGE_MAX_LONG_SIDE}px (forwarded as-is; re-encode unavailable)`,
    };
  }

  return {
    base64_data: base64, mime_type, format, width, height, base64Len,
    oversizeBytes: false, oversizeDimensions: false, resized: false, dropped: false,
    reason: oversizeDimensions ? `long side ${Math.max(width || 0, height || 0)}px exceeds ${IMAGE_MAX_LONG_SIDE}px (GIF forwarded as-is)` : null,
  };
}

export async function normalizeImagePart(part: { type?: string; mimeType?: string; base64Data?: string; caption?: string }): Promise<{ type: "image"; mimeType: string; base64Data: string; caption?: string } | null> {
  if (!part || typeof part !== "object") return null;
  const base64Data = typeof part.base64Data === "string" ? part.base64Data : "";
  if (!base64Data) return null;
  const decision = await maybeShrinkImage({ base64_data: base64Data, mime_type: part.mimeType });
  if (decision.dropped) return null;
  return { type: "image", mimeType: decision.mime_type, base64Data: decision.base64_data, caption: typeof part.caption === "string" ? part.caption : undefined };
}
