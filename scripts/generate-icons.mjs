#!/usr/bin/env node
/**
 * Generates the SellFlow app icons as real PNGs with no image dependencies.
 *
 * The mark is the brand green tile with three ascending bars (trade growing),
 * drawn with 4x4 supersampling so the curves are clean at 180–512px.
 *
 *   node scripts/generate-icons.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BG = [0x0f, 0x6b, 0x4f]; // --accent
const INK = [0xff, 0xff, 0xff];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle, in pixels. */
function insideRoundedRect(x, y, left, top, width, height, radius) {
  const cx = left + width / 2;
  const cy = top + height / 2;
  const qx = Math.abs(x - cx) - (width / 2 - radius);
  const qy = Math.abs(y - cy) - (height / 2 - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius <= 0;
}

function draw({ size, radius, inset, bleed }) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 4;
  const pad = bleed ? 0 : inset * size;
  const tile = size - pad * 2;

  // Bars sit inside the safe zone for maskable icons too.
  const barWidth = tile * 0.115;
  const gap = tile * 0.062;
  const totalWidth = barWidth * 3 + gap * 2;
  const startX = pad + (tile - totalWidth) / 2;
  const baseline = pad + tile * 0.735;
  const heights = [0.255, 0.365, 0.475].map((fraction) => tile * fraction);
  const barRadius = Math.max(2, tile * 0.022);

  const bars = heights.map((height, index) => ({
    left: startX + index * (barWidth + gap),
    top: baseline - height,
    width: barWidth,
    height,
  }));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bgHits = 0;
      let inkHits = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;

          const inTile = bleed
            ? true
            : insideRoundedRect(px, py, pad, pad, tile, tile, radius * size);
          if (!inTile) continue;
          bgHits += 1;

          for (const bar of bars) {
            if (
              insideRoundedRect(
                px,
                py,
                bar.left,
                bar.top,
                bar.width,
                bar.height,
                barRadius,
              )
            ) {
              inkHits += 1;
              break;
            }
          }
        }
      }

      const total = samples * samples;
      const alpha = bgHits / total;
      const inkMix = bgHits === 0 ? 0 : inkHits / bgHits;
      const offset = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        rgba[offset + c] = Math.round(BG[c] * (1 - inkMix) + INK[c] * inkMix);
      }
      rgba[offset + 3] = Math.round(alpha * 255);
    }
  }

  return encodePng(size, size, rgba);
}

/** Full-bleed variant: the tile covers the canvas and content stays in the safe zone. */
function drawBleed(size) {
  return draw({ size, radius: 0, inset: 0.18, bleed: true });
}

const outDir = path.join(process.cwd(), "public", "icons");
mkdirSync(outDir, { recursive: true });

const targets = [
  { file: path.join(outDir, "icon-192.png"), data: draw({ size: 192, radius: 0.22, inset: 0, bleed: false }) },
  { file: path.join(outDir, "icon-512.png"), data: draw({ size: 512, radius: 0.22, inset: 0, bleed: false }) },
  { file: path.join(outDir, "icon-maskable-512.png"), data: drawBleed(512) },
  { file: path.join(outDir, "apple-touch-icon.png"), data: drawBleed(180) },
  { file: path.join(process.cwd(), "src", "app", "icon.png"), data: draw({ size: 192, radius: 0.22, inset: 0, bleed: false }) },
  { file: path.join(process.cwd(), "src", "app", "apple-icon.png"), data: drawBleed(180) },
];

for (const target of targets) {
  writeFileSync(target.file, target.data);
  console.log(`  ${path.relative(process.cwd(), target.file)} — ${(target.data.length / 1024).toFixed(1)} kB`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="SellFlow">
  <rect width="512" height="512" rx="112" fill="#0f6b4f"/>
  <g fill="#ffffff">
    <rect x="162" y="252" width="52" height="150" rx="12"/>
    <rect x="230" y="196" width="52" height="206" rx="12"/>
    <rect x="298" y="140" width="52" height="262" rx="12"/>
  </g>
</svg>
`;
writeFileSync(path.join(outDir, "icon.svg"), svg);
console.log("  public/icons/icon.svg");
