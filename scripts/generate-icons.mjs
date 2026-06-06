// Generates Lapras application icons from scratch.
// Uses the same cloud design as buildTrayPng() in main.ts.
// Run: node scripts/generate-icons.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(currentDir, "..", "build");
mkdirSync(buildDir, { recursive: true });

function createPngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crcBuf]);
}

function buildLaprasPng(size) {
  const rawRowBytes = size * 4 + 1; // filter byte + RGBA per pixel
  const rawData = Buffer.alloc(rawRowBytes * size);
  const cx = size / 2;
  const cy = size * 0.55;
  const outerR = size * 0.4;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * rawRowBytes;
    rawData[rowOffset] = 0; // filter: none

    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * 4;
      const dx = (x + 0.5 - cx) / outerR;
      const dy = (y + 0.5 - cy) / (outerR * 0.85);
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 1.05) {
        // Cloud body — light blue #60A5FA
        rawData[px] = 96;
        rawData[px + 1] = 165;
        rawData[px + 2] = 250;
        rawData[px + 3] = 255;
      } else {
        rawData[px + 3] = 0; // transparent
      }

      // Left eye
      const leftEyeCx = size * 0.38;
      const leftEyeCy = size * 0.43;
      const eyeR = size * 0.04;
      const ledx = (x + 0.5 - leftEyeCx) / eyeR;
      const ledy = (y + 0.5 - leftEyeCy) / eyeR;
      if (Math.sqrt(ledx * ledx + ledy * ledy) < 1.0) {
        rawData[px] = 15;
        rawData[px + 1] = 23;
        rawData[px + 2] = 42;
        rawData[px + 3] = 255;
      }

      // Right eye
      const rightEyeCx = size * 0.62;
      const rightEyeCy = size * 0.43;
      const redx = (x + 0.5 - rightEyeCx) / eyeR;
      const redy = (y + 0.5 - rightEyeCy) / eyeR;
      if (Math.sqrt(redx * redx + redy * redy) < 1.0) {
        rawData[px] = 15;
        rawData[px + 1] = 23;
        rawData[px + 2] = 42;
        rawData[px + 3] = 255;
      }

      // Smile arc
      const smileCx = size * 0.5;
      const smileCy = size * 0.52;
      const smileRx = size * 0.18;
      const smileRy = size * 0.06;
      const sdx = (x + 0.5 - smileCx) / smileRx;
      const sdy = (y + 0.5 - smileCy) / smileRy;
      const smileDist = Math.sqrt(sdx * sdx + sdy * sdy);
      if (smileDist < 1.15 && smileDist > 0.8 && y > smileCy) {
        rawData[px] = 255;
        rawData[px + 1] = 255;
        rawData[px + 2] = 255;
        rawData[px + 3] = 220;
      }
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const compressed = deflateSync(rawData);

  return Buffer.concat([
    signature,
    createPngChunk("IHDR", ihdrData),
    createPngChunk("IDAT", compressed),
    createPngChunk("IEND", Buffer.alloc(0))
  ]);
}

// Generate 1024x1024 main icon
console.log("Generating icon.png (1024×1024)...");
const png1024 = buildLaprasPng(1024);
writeFileSync(path.join(buildDir, "icon.png"), png1024);
console.log("  ✓ build/icon.png");

// Generate ICO with multiple sizes (16, 32, 48, 256)
console.log("Generating icon.ico...");

function pngToIcoEntry(pngBuffer) {
  // Read dimensions from IHDR
  const ihdrStart = 33; // after signature (8) + chunk len (4) + "IHDR" (4) = 16, plus 8 for sig offset...
  // Actually, let me parse properly:
  const sigLen = 8;
  const chunkLen = pngBuffer.readUInt32BE(sigLen); // first chunk length
  // IHDR is at sigLen+4 to sigLen+4+4 (type), data starts at sigLen+8
  const width = pngBuffer.readUInt32BE(sigLen + 8);
  const height = pngBuffer.readUInt32BE(sigLen + 12);
  return { width, height, data: pngBuffer };
}

// ICO header
const icoEntries = [];

// Generate smaller PNGs for ICO
const sizes = [16, 32, 48, 256];
const pngBuffers = sizes.map((s) => {
  const buf = buildLaprasPng(s);
  const entry = pngToIcoEntry(buf);
  icoEntries.push(entry);
  return buf;
});

// ICO header: reserved(2) + type=1(2) + count(2) = 6 bytes
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0); // reserved
icoHeader.writeUInt16LE(1, 2); // type: ICO
icoHeader.writeUInt16LE(sizes.length, 4); // count

// ICO directory entries: 16 bytes each
let dataOffset = 6 + sizes.length * 16;
const dirEntries = Buffer.alloc(sizes.length * 16);

for (let i = 0; i < sizes.length; i++) {
  const s = sizes[i];
  const entryBase = i * 16;
  dirEntries.writeUInt8(s >= 256 ? 0 : s, entryBase);       // width
  dirEntries.writeUInt8(s >= 256 ? 0 : s, entryBase + 1);   // height
  dirEntries.writeUInt8(0, entryBase + 2);                    // palette
  dirEntries.writeUInt8(0, entryBase + 3);                    // reserved
  dirEntries.writeUInt16LE(1, entryBase + 4);                 // planes
  dirEntries.writeUInt16LE(32, entryBase + 6);                // bpp
  dirEntries.writeUInt32LE(pngBuffers[i].length, entryBase + 8);  // size
  dirEntries.writeUInt32LE(dataOffset, entryBase + 12);       // offset
  dataOffset += pngBuffers[i].length;
}

const icoFile = Buffer.concat([icoHeader, dirEntries, ...pngBuffers]);
writeFileSync(path.join(buildDir, "icon.ico"), icoFile);
console.log("  ✓ build/icon.ico");

// Generate ICNS (simplified — single 1024 icon)
// ICNS format: "icns" magic + entries with OSType + length + data
console.log("Generating icon.icns...");

function icnsEntry(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, "ascii");
  header.writeUInt32BE(8 + data.length, 4);
  return Buffer.concat([header, data]);
}

// For ICNS we need specific types. ic07 = 128x128 PNG, ic08 = 256x256, ic09 = 512x512, ic10 = 1024x1024
// Actually let's use ic07 (128), ic08 (256), ic09 (512), ic10 (1024)
const icnsSizes = [
  { size: 1024, type: "ic10" },
  { size: 512, type: "ic09" },
  { size: 256, type: "ic08" },
  { size: 128, type: "ic07" },
];

const icnsEntries = icnsSizes.map(({ size, type }) => {
  const png = buildLaprasPng(size);
  return icnsEntry(type, png);
});

const icnsMagic = Buffer.from("icns");
const icnsContent = Buffer.concat(icnsEntries);
const icnsTotalSize = Buffer.alloc(4);
icnsTotalSize.writeUInt32BE(8 + icnsContent.length, 0);
const icnsFile = Buffer.concat([icnsMagic, icnsTotalSize, icnsContent]);
writeFileSync(path.join(buildDir, "icon.icns"), icnsFile);
console.log("  ✓ build/icon.icns");

console.log("\nAll icon files generated in build/");
