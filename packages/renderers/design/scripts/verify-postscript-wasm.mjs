import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const runtimeDir = resolve(root, 'packages/renderers/design/runtime/postscript')
const gluePath = resolve(root, 'packages/renderers/design/src/postscriptRuntime/stet_wasm.js')
const wasmPath = resolve(runtimeDir, 'stet_wasm_bg.wasm')
const wasm = await readFile(wasmPath)
const sha256 = createHash('sha256').update(wasm).digest('hex')
assert.equal(sha256, 'b8d72531ec41ca497d67a79589a1dbb44748a4fefd088aa122007fbb28e06b20')

const searchable = wasm.toString('latin1')
const profile = JSON.parse(await readFile(resolve(root, 'packages/renderers/design/source/postscript/upstream.json'), 'utf8'))
const notices = JSON.parse(await readFile(resolve(root, 'packages/renderers/design/LICENSES/Stet_NATIVE_THIRD_PARTY_LICENSES.json'), 'utf8'))
assert.equal(notices.source.commit, profile.commit)
assert.equal(notices.lockSha256, profile.cargoLockSha256)
assert.equal(notices.runtimeFiles[0].sha256, sha256)
for (const [digest, material] of Object.entries(notices.materials)) {
  assert.equal(createHash('sha256').update(material.text).digest('hex'), digest)
  assert.equal(Buffer.byteLength(material.text), material.bytes)
}
for (const entry of [...notices.packages, notices.standardLibrary]) {
  assert.ok(entry.legalFiles.length > 0)
  for (const file of entry.legalFiles) assert.ok(notices.materials[file.sha256])
}
assert.ok(notices.packages.find(x => x.name === 'jpeg-encoder').legalFiles.some(x => x.name.includes('fdct.rs')))
assert.ok(notices.packages.find(x => x.name === 'unicode-ident').legalFiles.some(x => x.name.includes('UNICODE')))
for (const marker of [/Carlito-Regular\.ttf/, /Tinos-Regular\.ttf/, /Cousine-Regular\.ttf/, /NotoSansSymbols2-Regular\.ttf/, /Artifex CMYK SWOP Profile/]) {
  assert.equal(marker.test(searchable), false, `forbidden redistributed asset marker ${marker}`)
}

const stet = await import(`${pathToFileURL(gluePath).href}?verify=${Date.now()}`)
stet.initSync({ module: wasm })

const fixtures = [
  { filename: 'postscript-vector.eps', expectedPages: 1, minInkPixels: 25_000 },
  { filename: 'postscript-pages.ps', expectedPages: 2, minInkPixels: 30_000 },
]
for (const fixture of fixtures) {
  const source = await readFile(resolve(root, 'apps/viewer-demo/public/example', fixture.filename))
  const interpreter = stet.create_interpreter()
  stet.set_max_vm(interpreter, 256 * 1024 * 1024)
  try {
    stet.render(interpreter, source, 96, fixture.filename)
    let steps = 0
    while (stet.ps_stream_active(interpreter)) {
      assert.ok(++steps <= 100, `${fixture.filename} exceeded the page execution limit`)
      stet.step_ps_page(interpreter)
    }
    const pages = stet.page_count(interpreter)
    assert.equal(pages, fixture.expectedPages, `${fixture.filename} page count`)
    let inkPixels = 0
    for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
      const [sourceWidth, sourceHeight] = stet.page_dimensions(interpreter, pageIndex)
      const width = Math.max(1, Math.min(800, Math.round(sourceWidth)))
      const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth))
      const page = stet.render_viewport(
        interpreter, pageIndex, 0, 0, sourceWidth, sourceHeight, width, height
      )
      try {
        const rgba = page.rgba
        for (let index = 0; index < rgba.length; index += 4) {
          if (
            rgba[index + 3] > 0 &&
            (rgba[index] < 245 || rgba[index + 1] < 245 || rgba[index + 2] < 245)
          ) inkPixels += 1
        }
      } finally {
        page.free()
      }
    }
    assert.ok(inkPixels >= fixture.minInkPixels, `${fixture.filename} produced only ${inkPixels} ink pixels`)
    console.log(`[postscript-wasm] ${fixture.filename}: pages=${pages}, ink=${inkPixels}`)
  } finally {
    interpreter.free()
  }
}

for (const filename of [
  'Stet-Apache-2.0.txt',
  'Stet-MIT.txt',
  'Stet-URW-Fonts-OFL-1.1.txt',
  'Stet-CMYK-Profile.txt',
  'CC0-1.0.txt',
  'Carlito-OFL-1.1.txt',
  'Tinos-OFL-1.1.txt',
  'Cousine-OFL-1.1.txt',
  'NotoSansSymbols2-OFL-1.1.txt',
]) {
  const license = await readFile(resolve(root, 'packages/renderers/design/LICENSES', filename), 'utf8')
  assert.ok(license.length > 900, `${filename} is missing or incomplete`)
}

console.log(`[postscript-wasm] safe runtime sha256=${sha256}, bytes=${wasm.byteLength}`)
await import('./verify-postscript-upstream.mjs')
