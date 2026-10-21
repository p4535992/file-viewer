import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = resolve(packageDir, '../../..')
const rendererDir = resolve(sourceRoot, 'packages/renderers/chm')
const packageJson = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8'))
const inventory = JSON.parse(await readFile(resolve(packageDir, 'viewer/THIRD_PARTY_LICENSES.assets.json'), 'utf8'))
const runtimePaths = ['chm.worker.js', 'chm_wasm.js', 'chm_wasm_bg.wasm'].map(name => `vendor/chm/${name}`).sort()
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

const notices = [
  ['LICENSE', 'LICENSE'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
  ['rust/NOTICE.md', 'RUST_NOTICE.md'],
  ['rust/THIRD_PARTY_LICENSES.md', 'RUST_THIRD_PARTY_LICENSES.md'],
]
for (const [source, target] of notices) {
  assert(packageJson.files.includes(target), `${target} is missing from the assets-chm npm files allowlist`)
  const expected = await readFile(resolve(rendererDir, source))
  assert.deepEqual(await readFile(resolve(packageDir, target)), expected, `${target} drifted from renderer source`)
  assert.deepEqual(
    await readFile(resolve(packageDir, 'viewer/vendor/chm', target)),
    expected,
    `installed vendor/chm/${target} drifted from renderer source`
  )
  const material = inventory.materials.find(entry => entry.path === `vendor/chm/${target}`)
  assert(material, `${target} is missing from the staged attribution inventory`)
  assert.equal(material.bytes, expected.length, `${target} inventory size is stale`)
  assert.equal(material.sha256, sha256(expected), `${target} inventory hash is stale`)
  assert.deepEqual([...material.runtimePaths].sort(), runtimePaths, `${target} runtime attribution is incomplete`)
}
assert.equal(inventory.materials.length, notices.length, 'CHM attribution must contain all four license documents')
assert.deepEqual(inventory.runtimeFiles.map(entry => entry.path).sort(), runtimePaths, 'CHM runtime inventory is incomplete')

for (const filename of ['chm.worker.js', 'chm_wasm.js', 'chm_wasm_bg.wasm']) {
  const info = await stat(resolve(packageDir, 'viewer/vendor/chm', filename))
  assert(info.isFile() && info.size > 0, `${filename} is missing from the assets-chm payload`)
  assert(
    (await readFile(resolve(packageDir, 'viewer/vendor/chm', filename))).equals(
      await readFile(resolve(rendererDir, 'dist', filename))
    ),
    `${filename} is stale; rebuild the renderer, sync viewer assets, and stage assets-chm`
  )
  const runtime = inventory.runtimeFiles.find(entry => entry.path === `vendor/chm/${filename}`)
  const expected = await readFile(resolve(rendererDir, 'dist', filename))
  assert.equal(runtime.bytes, expected.length, `${filename} inventory size is stale`)
  assert.equal(runtime.sha256, sha256(expected), `${filename} inventory hash is stale`)
  assert.equal(runtime.sourceSha256, sha256(expected), `${filename} canonical owner hash is stale`)
}
const wasm = await readFile(resolve(packageDir, 'viewer/vendor/chm/chm_wasm_bg.wasm'))
assert.deepEqual([...wasm.subarray(0, 4)], [0, 97, 115, 109], 'assets-chm payload is not WebAssembly')

console.log('[assets-chm] Worker/WASM payload, four license documents and final attribution inventory verified')
