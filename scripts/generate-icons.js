#!/usr/bin/env node
// Generates all app icon/logo assets from the single source mark at
// assets/logo.png. Never hand-export sizes individually — re-run this
// script instead. See KVG_Standards app-standards skill, "Logo & branding".

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets', 'logo.png');

// Sampled from the master mark's light field (Gemini export background).
const PAD = { r: 205, g: 205, b: 205, alpha: 1 };

async function squareSource() {
  const trimmed = await sharp(SOURCE).trim({ threshold: 8 }).toBuffer();
  const meta = await sharp(trimmed).metadata();
  const side = Math.max(meta.width ?? 1, meta.height ?? 1);
  return sharp(trimmed)
    .resize(side, side, {
      fit: 'contain',
      background: PAD,
    })
    .png()
    .toBuffer();
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.log('No assets/logo.png — skipping icon generation.');
    process.exit(0);
  }

  const square = await squareSource();

  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true });

  // Packaged binary/installer icon — electron-builder auto-converts a
  // single high-res PNG to .ico/.icns per platform.
  await sharp(square)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(ROOT, 'build', 'icon.png'));

  // In-app window/taskbar icon, set at runtime via BrowserWindow({ icon }).
  await sharp(square)
    .resize(256, 256)
    .png()
    .toFile(path.join(ROOT, 'assets', 'icon.png'));

  // Renderer UI (topbar) + favicon.
  await sharp(square)
    .resize(512, 512)
    .png()
    .toFile(path.join(ROOT, 'public', 'logo.png'));

  console.log('Generated build/icon.png, assets/icon.png, public/logo.png from assets/logo.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
