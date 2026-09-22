#!/usr/bin/env node
/**
 * Build sample checkout ZIPs:
 *   public/fixtures/sample-checkout.zip
 *   public/fixtures/sample-checkout-image.zip
 *
 * Layout: content.json + meta/checkout-manifest.json (+ media/ for image demo)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'public', 'fixtures');

async function writeZip(outName, files) {
  const zip = new JSZip();
  for (const [entry, abs] of Object.entries(files)) {
    if (!fs.existsSync(abs)) {
      throw new Error(`Missing ${abs}`);
    }
    if (fs.statSync(abs).isDirectory()) {
      const walk = (dir, prefix) => {
        for (const name of fs.readdirSync(dir)) {
          const p = path.join(dir, name);
          const rel = path.join(prefix, name).replace(/\\/g, '/');
          if (fs.statSync(p).isDirectory()) walk(p, rel);
          else zip.file(rel, fs.readFileSync(p));
        }
      };
      walk(abs, entry.replace(/\/$/, ''));
    } else {
      zip.file(entry, fs.readFileSync(abs));
    }
  }
  const outPath = path.join(fixtures, outName);
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outPath, buf);
  console.log('Wrote', outPath, `(${buf.length} bytes)`);
}

await writeZip('sample-checkout.zip', {
  'content.json': path.join(fixtures, 'ufc-1-200-01-content.json'),
  'meta/checkout-manifest.json': path.join(fixtures, 'checkout-manifest.json'),
});

await writeZip('sample-checkout-image.zip', {
  'content.json': path.join(fixtures, 'image-demo-content.json'),
  'meta/checkout-manifest.json': path.join(fixtures, 'checkout-manifest-image.json'),
  'media/': path.join(fixtures, 'image-demo-media'),
});
