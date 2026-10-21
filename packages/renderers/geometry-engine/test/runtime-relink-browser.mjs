import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '../../../..')
const require = createRequire(join(root, 'packages/renderers/geometry-engine/package.json'))
const { build } = require('esbuild')
const output = resolve(process.env.OCCT_RELINK_OUTPUT || join(root, '.release/occt-runtime-relink'))
await mkdir(output, { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const original = require.resolve('occt-import-js')
const replacement = join(output, 'replacement-occt.cjs')
await build({ entryPoints: [original], outfile: replacement, bundle: true, platform: 'browser', format: 'cjs',
  target: 'es2018', define: { process: 'undefined' }, legalComments: 'eof',
  alias: { path: require.resolve('path-browserify') },
  banner: { js: 'globalThis.__occtRelinkReplacementLoaded = true;' } })
const entry = join(root, 'packages/renderers/geometry-engine/dist/index.js')
const samples = await readFile(process.env.OCCT_RELINK_SAMPLE)
const wasm = await readFile(join(dirname(original), 'occt-import-js.wasm'))
const host = await build({ stdin: {
  contents: `import { importOcctGeometryFile } from ${JSON.stringify(entry)};
    import { modelRenderer } from ${JSON.stringify(join(root, 'packages/renderers/3d/dist/index.js'))};
    globalThis.relinkedModelRenderer = modelRenderer;
    window.runRelink = async () => {
      const data = await (await fetch('/sample.step')).arrayBuffer();
      const result = await importOcctGeometryFile(data, 'step', { wasmUrl: '/occt.wasm', useWorker: false });
      return { replacementLoaded: !!globalThis.__occtRelinkReplacementLoaded,
        modelRendererPresent: !!globalThis.relinkedModelRenderer,
        meshes: result.meshes.length, requestedFormat: 'step' };
    };`,
  resolveDir: root, sourcefile: 'relink-public-runtime-entry.js' },
  bundle: true, format: 'iife', platform: 'browser', write: false, metafile: true,
  plugins: [{ name: 'replace-library-only', setup(context) {
    context.onResolve({ filter: /occt\.cjs$/ }, () => ({ path: replacement }))
  }}], target: 'es2020', legalComments: 'eof' })
const inputs = Object.keys(host.metafile.inputs)
assert.ok(inputs.some(path => resolve(root, path) === replacement))
assert.ok(inputs.filter(path => path.includes('packages/')).every(path => path.includes('/dist/') && !/\.(?:ts|vue|svelte)$/.test(path)), 'Host relinking may consume only published compiled runtime objects')
const script = host.outputFiles[0].contents
await writeFile(join(output, 'relinked-host.js'), script)
const server = createServer((request, response) => {
  const data = { '/entry.js': ['text/javascript', script], '/sample.step': ['application/octet-stream', samples], '/occt.wasm': ['application/wasm', wasm] }[request.url]
  if (data) response.writeHead(200, { 'Content-Type': data[0] }).end(data[1])
  else response.writeHead(200, { 'Content-Type': 'text/html' }).end('<script src="/entry.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
const report = { scope: 'Separate compiled host objects relinked with a changed public library wrapper; not a byte-identical original IIFE rebuild.',
  sourcePrivateHostFiles: 0, inputs, hostSha256: hash(script), wasmSha256: hash(wasm), sampleSha256: hash(samples), externalRequests: [], errors: [] }
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue()
    report.externalRequests.push(route.request().url()); return route.abort()
  })
  await page.goto(origin)
  const result = await page.evaluate(() => window.runRelink())
  assert.equal(result.replacementLoaded, true)
  assert.equal(result.modelRendererPresent, true)
  assert.ok(result.meshes > 0)
  assert.equal(result.requestedFormat, 'step')
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.externalRequests, [])
  report.result = result; report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.failure = error.stack; throw error
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser?.close(); await new Promise(resolve => server.close(resolve))
}
console.log(JSON.stringify(report))
