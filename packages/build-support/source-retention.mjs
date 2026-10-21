import assert from 'node:assert/strict'
import { lstat } from 'node:fs/promises'
import { join, posix } from 'node:path'

const safePath = value => typeof value === 'string' && value.length > 0 &&
  !value.includes('\\') && !value.includes('\0') && !posix.isAbsolute(value) &&
  value === posix.normalize(value) && !value.startsWith('../') && value !== '..'

/** Check the complete reviewed source inventory against both index and disk. */
export async function verifySourceRetention({ root, tracked, policy }) {
  const files = policy.files
  assert.ok(Array.isArray(files) && files.length > 0, 'Empty source retention inventory')
  assert.ok(files.every(safePath), 'Unsafe source retention path')
  const baseline = new Set(files)
  assert.equal(baseline.size, files.length, 'Duplicate source retention path')
  const empty = new Set(policy.emptyFiles || [])
  const symlinks = new Set(policy.symlinkFiles || [])
  const removed = new Map()
  for (const item of policy.allowedRemovals || []) {
    assert.ok(baseline.has(item.path) && safePath(item.replacement), 'Unreviewed source removal')
    assert.ok(typeof item.reason === 'string' && item.reason.trim(), 'Source removal needs a reason')
    assert.ok(!removed.has(item.path), 'Duplicate source removal')
    removed.set(item.path, item.replacement)
  }
  const index = new Set(tracked)
  let retained = 0
  let reviewedRemovals = 0
  for (const path of files) {
    if (removed.has(path) && !index.has(path)) {
      const replacement = removed.get(path)
      assert.ok(index.has(replacement), `Source removal lacks tracked replacement: ${path}`)
      const stat = await lstat(join(root, replacement))
      assert.ok(stat.isFile() && stat.size > 0, `Source removal lacks regular replacement: ${path}`)
      reviewedRemovals += 1
      continue
    }
    assert.ok(index.has(path), `Maintained source removed from Git: ${path}`)
    const stat = await lstat(join(root, path)).catch(error => {
      throw new Error(`Maintained source missing from checkout: ${path}`, { cause: error })
    })
    if (symlinks.has(path)) assert.ok(stat.isSymbolicLink(), `Source symlink kind changed: ${path}`)
    else {
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Source replaced by a non-file: ${path}`)
      assert.ok(empty.has(path) || stat.size > 0, `Maintained source emptied: ${path}`)
    }
    retained += 1
  }
  return { baselineFiles: files.length, retainedFiles: retained, reviewedRemovals }
}
