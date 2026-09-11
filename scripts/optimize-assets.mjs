// scripts/optimize-assets.mjs
// Optimiza el logo y genera los iconos de la PWA.

import sharp from 'sharp';
import { mkdir, stat, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pub = resolve(here, '..', 'public');
const source = join(pub, 'logo.png');

const before = await stat(source);
const meta = await sharp(source).metadata();
console.log(`Original: ${meta.width}x${meta.height} · ${(before.size / 1024).toFixed(0)} KB`);

// 1) Logo optimizado (mismo nombre, PNG comprimido y redimensionado)
const temp = join(pub, 'logo.tmp.png');
await sharp(source)
    .resize({ width: Math.min(meta.width, 512), withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true })
    .toFile(temp);
await rename(temp, source);

const after = await stat(source);
console.log(
    `Optimizado: ${(after.size / 1024).toFixed(0)} KB (-${(100 - (after.size / before.size) * 100).toFixed(0)}%)`
);

// 2) Iconos PWA
const iconsDir = join(pub, 'static', 'icons');
await mkdir(iconsDir, { recursive: true });
for (const size of [192, 512]) {
    await sharp(source)
        .resize({ width: size, height: size, fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } })
        .png()
        .toFile(join(iconsDir, `icon-${size}.png`));
}
console.log('Generado: static/icons/icon-192.png y icon-512.png');
