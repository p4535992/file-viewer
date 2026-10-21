import { build as buildBundle } from 'esbuild'
import { captureBundleEvidence } from '../../../build-support/bundle-evidence.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stageDesignLicenseTexts } from '../../../build-support/stage-design-license-texts.mjs'
import { verifyNativeNoticeBook } from '../../../build-support/verify-native-notice-book.mjs'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await stageDesignLicenseTexts({ packageRoot: packageDir })
await verifyNativeNoticeBook({ packageRoot: packageDir, bookPath: 'LICENSES/Stet_NATIVE_THIRD_PARTY_LICENSES.json',
  lockPath: 'source/postscript/Cargo.lock', runtimePath: 'runtime/postscript/stet_wasm_bg.wasm' })
const evidence = captureBundleEvidence(buildBundle, packageDir, 'workers')
const build = options => evidence.build(options)
const workers = [
  { name: 'Illustrator PGF', entry: 'src/illustrator-pgf.worker.ts', output: 'dist/illustrator-pgf.worker.js' },
  { name: 'Photoshop', entry: 'src/photoshop.worker.ts', output: 'dist/photoshop.worker.js' },
  { name: 'IDML', entry: 'src/idml.worker.ts', output: 'dist/idml.worker.js' },
  { name: 'Adobe container', entry: 'src/adobe-container.worker.ts', output: 'dist/adobe-container.worker.js' },
  { name: 'Adobe resource', entry: 'src/adobe-resource.worker.ts', output: 'dist/adobe-resource.worker.js' },
  { name: 'PostScript', entry: 'src/postscript.worker.ts', output: 'dist/postscript.worker.js' },
]

for (const worker of workers) {
  const workerOutput = resolve(packageDir, worker.output)
  await build({
    entryPoints: [resolve(packageDir, worker.entry)],
    outfile: workerOutput,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'eof',
  })
  const source = await readFile(workerOutput, 'utf8')
  await writeFile(workerOutput, source.replace(/[ \t]+$/gm, ''))
  console.log(`[renderer-design] Built standalone ${worker.name} module Worker.`)
}

await evidence.finish()
