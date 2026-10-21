import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { writeBundleNotices } from './bundle-notices.mjs'

test('retains the full original MIT grant of a physically bundled workspace dependency', async () => {
  const root = await mkdtemp(join(tmpdir(), 'file-viewer-workspace-notices-'))
  try {
    const packageRoot = join(root, 'doc')
    await mkdir(packageRoot)
    const license = await readFile(new URL('../renderers/doc/LICENSE', import.meta.url), 'utf8')
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@file-viewer/doc', version: '3.2.0', license: 'MIT'
    }))
    await writeFile(join(packageRoot, 'LICENSE'), license)
    const entry = join(packageRoot, 'index.js')
    await writeFile(entry, 'export const doc = true\n')
    const output = join(root, 'THIRD_PARTY_LICENSES.txt')
    await writeBundleNotices({ inputs: { [entry]: {} } }, output, {
      includeWorkspacePackages: ['@file-viewer/doc']
    })
    const notices = await readFile(output, 'utf8')
    assert.ok(notices.includes('@file-viewer/doc@3.2.0'))
    assert.ok(notices.includes(license))
    // A name in the opt-in list is not evidence of physical inclusion.
    await writeBundleNotices({ inputs: {} }, output, {
      includeWorkspacePackages: ['@file-viewer/doc']
    })
    assert.equal((await readFile(output, 'utf8')).trim(), '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('retains the exact complete grants of a physically inlined SDK and rejects byte drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'file-viewer-sdk-notices-'))
  try {
    const packageRoot = join(root, 'sdk')
    const dist = join(packageRoot, 'dist')
    await mkdir(dist, { recursive: true })
    const metadata = { name: '@example/sdk', version: '1.0.0', license: 'Apache-2.0' }
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify(metadata))
    const grant = await readFile(new URL('../renderers/doc/LICENSE', import.meta.url))
    const first = Buffer.from('export const first = true\n')
    const second = Buffer.from('export const second = true\n')
    const files = { 'first.js': first, 'second.js': second, 'THIRD_PARTY_LICENSES.txt': grant }
    for (const [name, bytes] of Object.entries(files)) await writeFile(join(dist, name), bytes)
    const receipt = { schemaVersion: 1, packageName: metadata.name, packageVersion: metadata.version,
      files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, {
        bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')
      }])) }
    await writeFile(join(dist, 'bundled-runtime.json'), JSON.stringify(receipt))
    const output = join(root, 'THIRD_PARTY_LICENSES.txt')
    const options = { includePrebundledSdkPackages: [metadata.name] }
    const inputs = { [join(dist, 'first.js')]: {}, [join(dist, 'second.js')]: {} }
    await writeBundleNotices({ inputs }, output, options)
    const notices = await readFile(output, 'utf8')
    assert.equal(notices.split('Prebundled browser runtime:').length - 1, 1)
    assert.ok(notices.includes(grant.toString('utf8')))
    await writeBundleNotices({ inputs: {} }, output, options)
    assert.equal((await readFile(output, 'utf8')).trim(), '')
    await writeFile(output, 'unchanged on failed verification')
    await writeFile(join(dist, 'first.js'), 'changed SDK bytes\n')
    await assert.rejects(() => writeBundleNotices({ inputs }, output, options), /SDK input (?:size|bytes) changed/)
    assert.equal(await readFile(output, 'utf8'), 'unchanged on failed verification')
    await writeFile(join(dist, 'first.js'), first)
    await writeFile(join(dist, 'THIRD_PARTY_LICENSES.txt'), 'replacement grant')
    await assert.rejects(() => writeBundleNotices({ inputs }, output, options), /SDK (?:notice size|original grants) changed/)
    assert.equal(await readFile(output, 'utf8'), 'unchanged on failed verification')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
