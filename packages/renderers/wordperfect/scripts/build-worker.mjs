import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { copyFile, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vendoredRuntime = [
  ['libwpd.mjs', 'ccd3267ce9cac2961bb6a500761753efa05c93563e7a5e46a31594cceb5e3096'],
  ['libwpd.wasm', 'bbfe0c7f712a357e3f9d11f9cf96d931e7cf4b9165d4379af78bf1bcb69333f0'],
]

for (const [filename, expectedHash] of vendoredRuntime) {
  const bytes = await readFile(resolve(packageDir, 'vendor', filename))
  const actualHash = createHash('sha256').update(bytes).digest('hex')
  if (actualHash !== expectedHash) {
    throw new Error(`Vendored ${filename} checksum mismatch: ${actualHash}`)
  }
}

await build({
  entryPoints: [resolve(packageDir, 'src/wordperfect.worker.ts')],
  outfile: resolve(packageDir, 'dist/wordperfect.worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'eof',
})

await Promise.all([
  ...vendoredRuntime.map(([filename]) => (
    copyFile(resolve(packageDir, 'vendor', filename), resolve(packageDir, 'dist', filename))
  )),
])

console.log('[renderer-wordperfect] Built standalone module Worker and staged the libwpd module/WASM runtime.')
