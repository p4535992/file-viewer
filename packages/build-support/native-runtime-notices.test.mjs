import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { verifyNativeRuntimeNotices } from './native-runtime-notices.mjs'

const root = resolve(import.meta.dirname, '../..')
const bookPath = join(root, 'packages/renderers/typst/assets/NATIVE_THIRD_PARTY_LICENSES.json')
const runtimePaths = {
  'typst_ts_renderer_bg.wasm': join(root, 'packages/renderers/typst/node_modules/@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm'),
  'typst_ts_web_compiler_bg.wasm': join(root, 'packages/renderers/typst/node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm'),
}

test('matches retained legal texts to unchanged public Typst native bytes, including the resolved seahash grant', async () => {
  const book = await verifyNativeRuntimeNotices(bookPath, runtimePaths)
  assert.equal(book.releaseApproval, false)
  assert.deepEqual(book.missingMaterials, [])
  const seahash = book.packages.find(entry => entry.name === 'seahash' && entry.version === '4.1.0')
  assert.ok(seahash?.legalFiles.length > 0, 'The resolved authentic seahash grant must be retained')
})

test('rejects replacing a native binary without matching provenance', async () => {
  await assert.rejects(() => verifyNativeRuntimeNotices(bookPath, {
    ...runtimePaths,
    'typst_ts_renderer_bg.wasm': runtimePaths['typst_ts_web_compiler_bg.wasm'],
  }), /Native runtime size changed/)
})

test('rejects altered legal text and approval while a native grant is missing', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'file-viewer-native-notices-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const source = JSON.parse(await readFile(bookPath, 'utf8'))
  const target = join(temp, 'NATIVE_THIRD_PARTY_LICENSES.json')
  const changed = structuredClone(source)
  const first = Object.values(changed.materials)[0]
  first.text += '\nAltered legal material\n'
  await writeFile(target, JSON.stringify(changed))
  await assert.rejects(() => verifyNativeRuntimeNotices(target, runtimePaths), /Native license text changed/)
  const approval = structuredClone(source)
  approval.missingMaterials = [{ name: 'seahash', version: '4.1.0', required: 'Complete original license grant' }]
  approval.releaseApproval = true
  await writeFile(target, JSON.stringify(approval))
  await assert.rejects(() => verifyNativeRuntimeNotices(target, runtimePaths), /Missing native grants cannot approve redistribution/)
})
