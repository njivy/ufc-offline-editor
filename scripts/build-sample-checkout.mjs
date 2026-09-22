#!/usr/bin/env node
/**
 * Build public/fixtures/sample-checkout.zip:
 *   content.json
 *   meta/checkout-manifest.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'public', 'fixtures');

const contentPath = path.join(fixtures, 'ufc-1-200-01-content.json');
const manifestPath = path.join(fixtures, 'checkout-manifest.json');
const outPath = path.join(fixtures, 'sample-checkout.zip');

if (!fs.existsSync(contentPath)) {
  console.error('Missing content fixture:', contentPath);
  process.exit(1);
}
if (!fs.existsSync(manifestPath)) {
  console.error('Missing checkout manifest:', manifestPath);
  process.exit(1);
}

const zip = new JSZip();
zip.file('content.json', fs.readFileSync(contentPath));
zip.folder('meta').file('checkout-manifest.json', fs.readFileSync(manifestPath));

const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.writeFileSync(outPath, buf);
console.log('Wrote', outPath, `(${buf.length} bytes)`);
