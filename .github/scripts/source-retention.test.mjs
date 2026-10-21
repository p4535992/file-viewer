import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { verifySourceRetention } from '../../packages/build-support/source-retention.mjs'

const fixture = async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'file-viewer-source-retention-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src/entry.ts'), 'export const viewer = true\n')
  await writeFile(join(root, 'src/renderer.ts'), 'export const renderer = true\n')
  const policy = {
    files: ['src/entry.ts', 'src/renderer.ts'],
    emptyFiles: [],
    symlinkFiles: [],
    allowedRemovals: []
  }
  return { root, policy, tracked: [...policy.files] }
}

test('retains every baseline source file, beyond entry-point sentinels', async (t) => {
  const input = await fixture(t)
  assert.deepEqual(await verifySourceRetention(input), {
    baselineFiles: 2,
    retainedFiles: 2,
    reviewedRemovals: 0
  })
  await rm(join(input.root, 'src/renderer.ts'))
  await assert.rejects(verifySourceRetention(input), /missing from checkout/)
})
test('untracked surviving bytes cannot hide a source deletion in Git', async (t) => {
  const input = await fixture(t)
  input.tracked.pop()
  await assert.rejects(verifySourceRetention(input), /removed from Git/)
})
test('empty files and symlink substitutions cannot replace maintained source', async (t) => {
  const input = await fixture(t)
  await writeFile(join(input.root, 'src/renderer.ts'), '')
  await assert.rejects(verifySourceRetention(input), /source emptied/)
  await rm(join(input.root, 'src/renderer.ts'))
  await symlink('entry.ts', join(input.root, 'src/renderer.ts'))
  await assert.rejects(verifySourceRetention(input), /non-file/)
})
test('reviewed removal requires a tracked, nonempty regular replacement', async (t) => {
  const input = await fixture(t)
  input.policy.allowedRemovals.push({
    path: 'src/renderer.ts',
    replacement: 'src/upstream.json',
    reason: 'Unpatched upstream supersedes the patch'
  })
  input.tracked.pop()
  await assert.rejects(verifySourceRetention(input), /tracked replacement/)
  input.tracked.push('src/upstream.json')
  await writeFile(join(input.root, 'src/upstream.json'), '{}\n')
  assert.equal((await verifySourceRetention(input)).reviewedRemovals, 1)
})
test('inventory and removal paths cannot escape the checkout', async (t) => {
  const input = await fixture(t)
  input.policy.files.push('../outside.ts')
  await assert.rejects(verifySourceRetention(input), /Unsafe source retention path/)
})
