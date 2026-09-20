#!/usr/bin/env node
// Generates build/icon.png, assets/icon.png, and public/logo.png from assets/logo.png.
// Inert until a real assets/logo.png exists — see TODO.md.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets', 'logo.png');

if (!fs.existsSync(SOURCE)) {
  console.log('No assets/logo.png — skipping icon generation.');
  process.exit(0);
}

console.error('assets/logo.png exists but sharp is not wired in this stub yet.');
process.exit(0);
