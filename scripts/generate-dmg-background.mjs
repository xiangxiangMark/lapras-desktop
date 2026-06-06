// Generates DMG background image for macOS installer.
// Layout: dark gradient background with icon placement guides and arrow.
// Run: node scripts/generate-dmg-background.mjs
//
// Output: build/dmg-background.png (1024×640)

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(currentDir, "..", "build");
mkdirSync(buildDir, { recursive: true });

// ---- PNG helpers ----

function createPngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crcBuf]);
}

// ---- Geometry helpers ----

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function dist(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---- Canvas ----

const W = 1024;
const H = 640;
const rawRowBytes = W * 4 + 1;
const raw = Buffer.alloc(rawRowBytes * H);

// ---- Background: dark gradient matching Lapras theme ----

const bgTop = [15, 18, 30];    // #0f121e
const bgBot = [22, 26, 44];    // #161a2c

for (let y = 0; y < H; y++) {
  const t = y / H;
  const r = Math.round(lerp(bgTop[0], bgBot[0], t));
  const g = Math.round(lerp(bgTop[1], bgBot[1], t));
  const b = Math.round(lerp(bgTop[2], bgBot[2], t));
  const row = y * rawRowBytes;
  raw[row] = 0; // filter byte
  for (let x = 0; x < W; x++) {
    const px = row + 1 + x * 4;
    raw[px] = r;
    raw[px + 1] = g;
    raw[px + 2] = b;
    raw[px + 3] = 255;
  }
}

// ---- Glow circles for icon placement areas ----

function drawGlow(cx, cy, radius, intensity) {
  for (let y = Math.max(0, cy - radius); y < Math.min(H, cy + radius); y++) {
    const row = y * rawRowBytes;
    for (let x = Math.max(0, cx - radius); x < Math.min(W, cx + radius); x++) {
      const d = dist(x, y, cx, cy);
      if (d > radius) continue;
      const alpha = Math.max(0, (1 - d / radius) * intensity);
      const px = row + 1 + x * 4;
      raw[px] = Math.min(255, raw[px] + Math.round(alpha * 40));
      raw[px + 1] = Math.min(255, raw[px + 1] + Math.round(alpha * 50));
      raw[px + 2] = Math.min(255, raw[px + 2] + Math.round(alpha * 80));
    }
  }
}

// Icon positions — must match dmg.contents in electron-builder.yml
const laprasCX = 190;
const laprasCY = 280;
const appsCX = 572;
const appsCY = 280;

drawGlow(laprasCX, laprasCY, 120, 0.7);
drawGlow(appsCX, appsCY, 120, 0.7);

// ---- Arrow pointing from lapras to Applications ----

function drawArrow() {
  const arrowY = appsCY;
  const startX = laprasCX + 110;
  const endX = appsCX - 80;
  const shaftThick = 5;
  const headSize = 20;

  // Shaft
  const shaftTop = arrowY - shaftThick;
  const shaftBot = arrowY + shaftThick;
  for (let y = shaftTop; y <= shaftBot; y++) {
    const row = y * rawRowBytes;
    for (let x = startX; x <= endX; x++) {
      const px = row + 1 + x * 4;
      const t = (x - startX) / (endX - startX); // 0 at start, 1 at head
      const alpha = Math.round(180 + t * 60);
      raw[px] = alpha;
      raw[px + 1] = alpha;
      raw[px + 2] = alpha;
    }
  }

  // Arrowhead (triangle pointing right)
  const headBase = endX;
  for (let y = arrowY - headSize; y <= arrowY + headSize; y++) {
    const dy = Math.abs(y - arrowY);
    const headWidth = Math.round(headSize * (1 - dy / headSize));
    if (headWidth <= 0) continue;
    const row = y * rawRowBytes;
    for (let x = headBase; x < headBase + headWidth; x++) {
      if (x >= W) continue;
      const px = row + 1 + x * 4;
      raw[px] = 220;
      raw[px + 1] = 220;
      raw[px + 2] = 220;
    }
  }
}

drawArrow();

// ---- Simple bitmap text at bottom ----

// Minimal 5x7 bitmap font (digits and basic letters only)
const font = {
  L: [0x1F, 0x04, 0x04, 0x04, 0x04],
  a: [0x0E, 0x11, 0x1F, 0x11, 0x11],
  p: [0x1E, 0x11, 0x1E, 0x10, 0x10],
  r: [0x16, 0x19, 0x10, 0x10, 0x10],
  s: [0x0E, 0x10, 0x0E, 0x01, 0x1E],
  A: [0x0E, 0x11, 0x1F, 0x11, 0x11],
  i: [0x04, 0x00, 0x04, 0x04, 0x04],
  c: [0x0E, 0x10, 0x10, 0x10, 0x0E],
  t: [0x08, 0x1E, 0x08, 0x08, 0x06],
  o: [0x0E, 0x11, 0x11, 0x11, 0x0E],
  n: [0x1E, 0x11, 0x11, 0x11, 0x11],
  " ": [0x00, 0x00, 0x00, 0x00, 0x00],
  "将": null, // Skip CJK — too complex for bitmap
  "拖": null,
  "入": null,
  "文": null,
  "件": null,
  "夹": null,
};

function charWidth(ch) {
  return 6; // 5px char + 1px gap
}

const text = "Lapras";
const textY = H - 60;
let cursorX = W / 2 - (text.length * charWidth('L')) / 2;

for (let i = 0; i < text.length; i++) {
  const ch = text[i];
  const glyph = font[ch];
  if (!glyph) {
    cursorX += charWidth(ch);
    continue;
  }

  for (let row = 0; row < 5; row++) {
    const bits = glyph[row];
    const y = textY + row;
    if (y < 0 || y >= H) continue;
    const scanRow = y * rawRowBytes;
    for (let col = 0; col < 5; col++) {
      if (bits & (1 << (4 - col))) {
        const x = cursorX + col;
        if (x >= 0 && x < W) {
          const px = scanRow + 1 + x * 4;
          raw[px] = 160;
          raw[px + 1] = 170;
          raw[px + 2] = 200;
        }
      }
    }
  }
  cursorX += charWidth(ch);
}

// ---- Export PNG ----

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(W, 0);
ihdrData.writeUInt32BE(H, 4);
ihdrData[8] = 8;  // bit depth
ihdrData[9] = 6;  // RGBA
ihdrData[10] = 0;
ihdrData[11] = 0;
ihdrData[12] = 0;

const compressed = deflateSync(raw);

const png = Buffer.concat([
  signature,
  createPngChunk("IHDR", ihdrData),
  createPngChunk("IDAT", compressed),
  createPngChunk("IEND", Buffer.alloc(0)),
]);

const outPath = path.join(buildDir, "dmg-background.png");
writeFileSync(outPath, png);
console.log(`✓ ${outPath} (${W}×${H})`);
console.log("  DMG background generated — dark gradient + icon guides + arrow");
