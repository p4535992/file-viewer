import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { resolveFileViewerRendererSelection } from '../dist/index.js'

const root = resolve(import.meta.dirname, '../../../..')
const text = JSON.parse(
  await readFile(resolve(root, 'packages/renderers/text/file-viewer.capability.json'))
)

test('every declared text format selects its owning renderer', () => {
  for (const format of text.formats) {
    const selected = resolveFileViewerRendererSelection(
      { formats: [format], autoPresets: false },
      root
    )
    assert.deepEqual(selected.packages, [text.packageName], format)
  }
})

test('LRC selection normalizes extension punctuation and case', () => {
  for (const format of ['lrc', 'LRC', '.lrc', ' .LrC ']) {
    const selected = resolveFileViewerRendererSelection(
      { formats: [format], autoPresets: false },
      root
    )
    assert.deepEqual(selected.packages, [text.packageName], format)
  }
})
