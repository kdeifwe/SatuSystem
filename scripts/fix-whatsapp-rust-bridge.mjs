import fs from 'node:fs';
import path from 'node:path';

const pkgDir = path.join(process.cwd(), 'node_modules', 'whatsapp-rust-bridge');
const pkgJsonPath = path.join(pkgDir, 'package.json');

if (!fs.existsSync(pkgJsonPath)) {
  console.log('[fix-whatsapp-rust-bridge] package not installed; skip');
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
const exportsValue = pkg.exports ?? {};
const safeExport = typeof exportsValue === 'object' && exportsValue !== null ? exportsValue : {};

if (safeExport['.'] && safeExport['./package.json']) {
  console.log('[fix-whatsapp-rust-bridge] already fixed');
  process.exit(0);
}

const distIndex = path.join(pkgDir, 'dist', 'index.js');
const updated = {
  ...pkg,
  exports: {
    '.': {
      import: './dist/index.js',
      require: './dist/index.js',
      default: './dist/index.js',
      types: './dist/index.d.ts',
    },
    './package.json': './package.json',
    './dist/index.js': './dist/index.js',
  },
};

if (!fs.existsSync(distIndex)) {
  console.log('[fix-whatsapp-rust-bridge] dist index missing; leaving package metadata unchanged');
  process.exit(0);
}

fs.writeFileSync(pkgJsonPath, `${JSON.stringify(updated, null, 2)}\n`);
console.log('[fix-whatsapp-rust-bridge] repaired exports for ESM/CJS resolution');
