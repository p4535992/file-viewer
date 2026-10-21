import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadInstalledPackage } from './installed-package-root.mjs'

const fixture = async t => {
  const root = await mkdtemp(join(tmpdir(), 'file-viewer-installed-package-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const relativePath = '.pnpm/example@1.0.0/node_modules/example'
  const directory = join(root, 'node_modules', relativePath)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }))
  return { root, relativePath, directory }
}

test('relative virtual-store and absolute package paths resolve the same original manifest', async t => {
  const { root, relativePath, directory } = await fixture(t)
  for (const path of [relativePath, directory]) {
    const result = loadInstalledPackage({ sourceRoot: root, path, expectedName: 'example', expectedVersion: '1.0.0' })
    assert.equal(result.packageJson.license, 'MIT')
    assert.equal(result.packageRoot, await realpath(directory))
  }
})
test('wrong ownership or version cannot supply license evidence', async t => {
  const { root, relativePath } = await fixture(t)
  assert.throws(() => loadInstalledPackage({ sourceRoot: root, path: relativePath, expectedName: 'other' }), /owner changed/)
  assert.throws(() => loadInstalledPackage({ sourceRoot: root, path: relativePath, expectedVersion: '2.0.0' }), /version differs/)
})
test('traversal, missing packages and linked manifests fail without inferred grants', async t => {
  const { root, relativePath, directory } = await fixture(t)
  assert.throws(() => loadInstalledPackage({ sourceRoot: root, path: '../outside' }), /escapes/)
  assert.throws(() => loadInstalledPackage({ sourceRoot: root, path: '.pnpm/missing/node_modules/missing' }), /ENOENT/)
  const manifest = join(directory, 'package.json')
  await rm(manifest)
  await writeFile(join(directory, 'metadata.json'), '{}')
  await symlink('metadata.json', manifest)
  assert.throws(() => loadInstalledPackage({ sourceRoot: root, path: relativePath }), /regular bounded file/)
})
