import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertReviewedCodecWasmSet, collectInstalledCodecWasmHashes } from './verify-packed-browser.mjs'

const first = 'a'.repeat(64)
const second = 'b'.repeat(64)
const provenance = { wrapperArtifacts: [
  { name: 'first', files: [{ path: 'first_decode.wasm', sha256: first }] },
  { name: 'second', files: [{ path: 'second_encode.wasm', sha256: 'c'.repeat(64) }, { path: 'second_decode.wasm', sha256: second }] },
] }
const bundled = { reviewedWasmHashes: [second, first], files: {
  'first.wasm': { sha256: first }, 'second.wasm': { sha256: second },
} }

test('decoder acceptance checks the complete reviewed hash set rather than a fixed historical count', () => {
  assertReviewedCodecWasmSet(bundled, provenance, [second, first])
  for (const hashes of [[first], [first, first], [first, second, 'c'.repeat(64)]])
    assert.throws(() => assertReviewedCodecWasmSet({ ...bundled, reviewedWasmHashes: hashes }, provenance, [first, second]), /claims differ/)
})

test('missing, replaced or extra installed decoder bytes fail even when the claims look correct', () => {
  for (const hashes of [[first], [first, 'c'.repeat(64)], [first, second, 'c'.repeat(64)]])
    assert.throws(() => assertReviewedCodecWasmSet(bundled, provenance, hashes), /Installed decoder bytes differ/)
  assert.throws(() => assertReviewedCodecWasmSet(bundled, { wrapperArtifacts: [] }, []), /must not be empty/)
})

test('the installed-byte probe verifies both external and inlined WASM with actual payload hashes', () => {
  const root = mkdtempSync(join(tmpdir(), 'file-viewer-codec-byte-probe-'))
  const bytes = Buffer.from('0061736d01000000', 'hex')
  try {
    writeFileSync(join(root, 'codec.wasm'), bytes)
    writeFileSync(join(root, 'worker.js'), `const url = "data:application/wasm;base64,${bytes.toString('base64')}"`)
    assert.deepEqual(collectInstalledCodecWasmHashes(root, { 'codec.wasm': {}, 'worker.js': {} }),
      [createHash('sha256').update(bytes).digest('hex')])
    writeFileSync(join(root, 'worker.js'), 'const url = "data:application/wasm;base64,YmFk"')
    assert.throws(() => collectInstalledCodecWasmHashes(root, { 'worker.js': {} }), /not valid WebAssembly/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
