import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')

/** Check retained legal text against the exact native bytes being copied. */
export async function verifyNativeRuntimeNotices(bookPath, runtimePaths) {
  const book = JSON.parse(await readFile(bookPath, 'utf8'))
  assert.equal(book.schemaVersion, 1, 'Unknown native notice-book schema')
  assert.ok(Array.isArray(book.packages) && book.packages.length > 0)
  assert.ok(Array.isArray(book.missingMaterials))
  if (book.missingMaterials.length) {
    assert.equal(book.releaseApproval, false, 'Missing native grants cannot approve redistribution')
  }
  for (const [key, material] of Object.entries(book.materials)) {
    const bytes = Buffer.from(material.text, 'utf8')
    assert.equal(digest(bytes), key, 'Native license text changed')
    assert.equal(material.sha256, key)
    assert.equal(material.bytes, bytes.length)
  }
  for (const entry of [...book.packages, book.standardLibrary]) {
    for (const ref of entry.legalFiles) {
      assert.ok(book.materials[ref.sha256], `Missing retained native legal text: ${ref.name}`)
    }
  }
  assert.deepEqual(Object.keys(runtimePaths).sort(), book.runtimeFiles.map(file => file.name).sort())
  for (const file of book.runtimeFiles) {
    const bytes = await readFile(runtimePaths[file.name])
    assert.equal(bytes.length, file.bytes, `Native runtime size changed: ${file.name}`)
    assert.equal(digest(bytes), file.sha256, `Native runtime changed: ${file.name}`)
  }
  return book
}
