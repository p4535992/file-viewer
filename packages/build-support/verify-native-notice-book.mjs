import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export async function verifyNativeNoticeBook({ packageRoot, bookPath, lockPath, runtimePath, markdown = false }) {
  const bytes = await readFile(join(packageRoot, bookPath))
  const text = bytes.toString('utf8')
  const book = JSON.parse(markdown ? text.split('<!-- complete-original-native-profile -->\n```json\n')[1]?.split('\n```')[0] : text)
  assert.equal(book.lockSha256, hash(await readFile(join(packageRoot, lockPath))), 'Native legal lock changed; regenerate its exact public original profile')
  const runtime = await readFile(join(packageRoot, runtimePath))
  assert.ok(book.runtimeFiles.some(entry => entry.sha256 === hash(runtime) && entry.bytes === runtime.length), 'Native payload differs from its original notice profile')
  assert.ok(book.packages.length > 0)
  for (const packageEntry of [...book.packages, book.standardLibrary]) {
    assert.ok(packageEntry.legalFiles.length > 0, 'Empty original native legal material entry')
    for (const original of packageEntry.legalFiles) {
      const material = book.materials[original.sha256]
      assert.ok(material?.text)
      assert.equal(hash(Buffer.from(material.text)), original.sha256, 'Original native legal material bytes changed')
    }
  }
  return book
}
