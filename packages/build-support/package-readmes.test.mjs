import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertMaintainedReadme, readmeContract, readPackageReadmes, verifyPackageReadmes } from './package-readmes.mjs'

const readmes = () => Object.fromEntries(['README.md', 'README.en.md'].map(name => [name,
  Buffer.from(`# @example/viewer\n\nMaintained ${name} documentation.\n\n## Usage\n\n\`\`\`js\nimport { createViewer } from '@example/viewer'\n\`\`\`\n`)]))

test('both packed READMEs bind to their maintained source bytes', () => {
  const source = readmes()
  verifyPackageReadmes(source, readmeContract(source), source)
  const changed = { ...source, 'README.md': Buffer.from(source['README.md'].toString().replace('createViewer', 'createOther')) }
  assert.throws(() => verifyPackageReadmes(changed, readmeContract(source), source), /README (hash|size) differs/)
  assert.throws(() => verifyPackageReadmes(changed, readmeContract(changed), source), /differs from maintained source/)
})

test('missing, empty, placeholder and unbound READMEs cannot qualify', () => {
  const source = readmes(), contract = readmeContract(source)
  for (const value of [undefined, Buffer.alloc(0), Buffer.from('placeholder'),
    Buffer.from('# @example/viewer\n\nRuntime package version 3.2.1.\n\nUsage and API documentation: https://example.test/\n')]) {
    assert.throws(() => verifyPackageReadmes({ ...source, 'README.md': value }, contract))
  }
  assert.throws(() => verifyPackageReadmes(source, {}), /bind both/)
  assert.throws(() => assertMaintainedReadme(Buffer.from([0xff, 0xfe])), /encoded data/)
})

test('source lookup rejects links and paths outside the checkout', async t => {
  const root = await mkdtemp(join(tmpdir(), 'package-readmes-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'packages/example')
  await mkdir(directory, { recursive: true })
  for (const [name, bytes] of Object.entries(readmes())) await writeFile(join(directory, name), bytes)
  assert.deepEqual(await readPackageReadmes(root, 'packages/example'), readmes())
  await rm(join(directory, 'README.md'))
  await symlink(join(directory, 'README.en.md'), join(directory, 'README.md'))
  await assert.rejects(readPackageReadmes(root, 'packages/example'), /regular file/)
  await assert.rejects(readPackageReadmes(root, '../outside'), /normalized relative path/)
})
