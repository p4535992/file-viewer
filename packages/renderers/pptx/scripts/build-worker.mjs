import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBundleInventory } from '../../../build-support/bundle-inventory.mjs';
import { writeBundleNotices } from '../../../build-support/bundle-notices.mjs';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const result = await build({
  bundle: true,
  entryPoints: [resolve(packageDir, 'src/worker-entry.ts')],
  format: 'esm',
  minify: true,
  metafile: true,
  outfile: resolve(packageDir, 'dist/worker/pptx.worker.js'),
  platform: 'browser',
  target: ['es2019'],
});
await writeBundleInventory(Object.keys(result.metafile.inputs), resolve(packageDir, '.build/worker-inputs.json'));
await writeBundleNotices(result.metafile, resolve(packageDir, 'dist/worker.THIRD_PARTY_LICENSES.txt'));
