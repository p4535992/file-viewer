import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { writeBundleNotices } from '../../../build-support/bundle-notices.mjs'
import { writeBundleInventory } from '../../../build-support/bundle-inventory.mjs'
import { browserRuntimeOptions } from '../../../build-support/browser-runtime-options.mjs'

const require = createRequire(import.meta.url)
const output = new URL('../dist/vendor/', import.meta.url)
const entry = require.resolve('occt-import-js')
await mkdir(output, { recursive: true })
// Seal the Emscripten Node-only path resolver inside its browser distribution.
const result = await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2018',
  define: { process: 'undefined' },
  alias: { path: require.resolve('path-browserify') },
  metafile: true,
  ...browserRuntimeOptions(),
  outfile: fileURLToPath(new URL('occt.cjs', output))
})
await writeBundleNotices(result.metafile, new URL('occt.NOTICE.txt', output))
await writeBundleInventory(Object.keys(result.metafile.inputs), fileURLToPath(new URL('../.build/occt-inputs.json', import.meta.url)))
for (const name of ['license.occt.txt', 'license.occt-import-js.txt']) {
  await writeFile(new URL(name, output), await readFile(join(dirname(entry), name)))
}
await writeFile(new URL('OCCT_LGPL_EXCEPTION.txt', output), await readFile(new URL('../../../build-support/licenses/native/OCCT_LGPL_EXCEPTION.txt', import.meta.url)))
