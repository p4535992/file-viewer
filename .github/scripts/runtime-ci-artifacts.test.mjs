import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { readmeContract } from '../../packages/build-support/package-readmes.mjs'
import {
  downloadRegistrySupport,
  inspectFrozenTarball,
  verifyFrozenArtifacts
} from './runtime-ci-artifacts.mjs'

const hash = (algorithm, bytes) =>
  createHash(algorithm)
    .update(bytes)
    .digest(algorithm === 'sha256' ? 'hex' : 'base64')
const defaultPackage = {
  name: '@example/runtime',
  version: '1.0.0',
  license: 'MIT',
  main: './dist/index.js'
}
const maintainedReadmes = () =>
  Object.fromEntries(
    ['README.md', 'README.en.md'].map((path) => [
      path,
      Buffer.from(
        `# @example/runtime\n\nMaintained ${path} documentation.\n\n## Install\n\nnpm install @example/runtime\n\n## Usage\n\nUse the documented runtime API.\n`
      )
    ])
  )
const entries = () => [
  ['package/package.json', JSON.stringify(defaultPackage)],
  ['package/LICENSE', 'MIT license text retained with attribution.'],
  ...Object.entries(maintainedReadmes()).map(([path, bytes]) => ['package/' + path, bytes]),
  ['package/dist/index.js', 'export const value = 42;'],
  ['package/dist/index.d.ts', 'export declare const value: number;']
]
function tar(members) {
  const blocks = []
  for (const [name, content, type = '0', mode = 0o644] of members) {
    const bytes = Buffer.from(content)
    const header = Buffer.alloc(512)
    header.write(name, 0, 100)
    for (const [offset, length, number] of [
      [100, 8, mode],
      [108, 8, 0],
      [116, 8, 0],
      [124, 12, bytes.length],
      [136, 12, 0]
    ]) {
      header.write(number.toString(8).padStart(length - 1, '0') + '\0', offset, length)
    }
    header.fill(32, 148, 156)
    header.write(type, 156, 1)
    header.write('ustar\0', 257, 6)
    header.write('00', 263, 2)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
    blocks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}
async function fixture(t, members = entries(), bytes = tar(members)) {
  const root = await mkdtemp(join(tmpdir(), 'runtime-archive-check-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'example-runtime-1.0.0.tgz')
  await writeFile(path, bytes)
  const packageDir = 'packages/example'
  await mkdir(join(root, packageDir), { recursive: true })
  await writeFile(join(root, packageDir, 'package.json'), JSON.stringify(defaultPackage))
  for (const [name, content] of Object.entries(maintainedReadmes()))
    await writeFile(join(root, packageDir, name), content)
  const expected = {
    packageDir,
    readmes: readmeContract(maintainedReadmes()),
    packageName: defaultPackage.name,
    version: defaultPackage.version,
    license: defaultPackage.license,
    tarball: 'example-runtime-1.0.0.tgz',
    tarballSize: bytes.length,
    sha256: hash('sha256', bytes),
    integrity: `sha512-${hash('sha512', bytes)}`,
    fileCount: members.length
  }
  return { root, path, expected }
}

test('bounded runtime archive check accepts runtime JavaScript and declaration files', async (t) => {
  const { path, expected } = await fixture(t)
  const result = await inspectFrozenTarball(path, expected)
  assert.equal(result.files.length, 6)
  assert.equal(result.packageJson.name, defaultPackage.name)
})

test('archive size, digest, integrity, identity and file count are all binding', async (t) => {
  const { path, expected } = await fixture(t)
  for (const changed of [
    { tarballSize: expected.tarballSize + 1 },
    { sha256: '0'.repeat(64) },
    { integrity: 'sha512-' + Buffer.alloc(64).toString('base64') },
    { version: '2.0.0' },
    { fileCount: 7 }
  ]) {
    await assert.rejects(() => inspectFrozenTarball(path, { ...expected, ...changed }))
  }
})

for (const member of [
  ['package/../outside.js', 'export {}'],
  ['package/src/hidden.js', 'export {}'],
  ['package/dist/hidden.ts', 'export {}'],
  ['package/dist/hidden.js.map', '{}'],
  ['package/dist/index.js', 'duplicate'],
  ['package/dist/link', 'dist/index.js', '2'],
  ['package/dist/privileged.js', 'export {}', '0', 0o4644],
  ['package/dist/leak.js', 'const path = "/Users/example/private";'],
  ['package/dist/map.js', '//# sourceMappingURL=hidden.map']
]) {
  test(`runtime archive rejects unsafe member ${member[0]}`, async (t) => {
    const { path, expected } = await fixture(t, [...entries(), member])
    await assert.rejects(() => inspectFrozenTarball(path, expected))
  })
}

test('missing license, absent export and maintenance scripts do not satisfy the runtime check', async (t) => {
  for (const members of [
    entries().filter(([name]) => name !== 'package/LICENSE'),
    entries().map(([name, bytes]) => [
      name,
      name === 'package/package.json'
        ? JSON.stringify({ ...defaultPackage, main: './dist/absent.js' })
        : bytes
    ]),
    entries().map(([name, bytes]) => [
      name,
      name === 'package/package.json'
        ? JSON.stringify({ ...defaultPackage, scripts: { build: 'private-build' } })
        : bytes
    ])
  ]) {
    const { path, expected } = await fixture(t, members)
    await assert.rejects(() => inspectFrozenTarball(path, expected))
  }
})

test('truncated TAR and duplicate release identities cannot be treated as verified', async (t) => {
  const members = entries()
  const bytes = gzipSync(Buffer.from('not a complete tar'))
  const broken = await fixture(t, members, bytes)
  await assert.rejects(() => inspectFrozenTarball(broken.path, broken.expected), /Truncated/)
  const { root, expected } = await fixture(t)
  await assert.rejects(
    () =>
      verifyFrozenArtifacts(
        root,
        {
          mode: 'runtime-only',
          packageCount: 2,
          packages: [expected, expected]
        },
        { sourceRoot: root }
      ),
    /Duplicate/
  )
})

test('upstream support download does not replace or delete an existing frozen asset', async (t) => {
  const { root, path, expected } = await fixture(t)
  const bytes = await readFile(path),
    originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = async (url) =>
    String(url).endsWith('.tgz')
      ? new Response(bytes)
      : new Response(
          JSON.stringify({
            name: expected.packageName,
            version: expected.version,
            dist: {
              integrity: expected.integrity,
              tarball: 'https://registry.npmjs.org/example-runtime-1.0.0.tgz'
            }
          })
        )
  const { packageName, version, tarball, tarballSize, sha256, integrity } = expected
  const item = { packageName, version, tarball, tarballSize, sha256, integrity }
  await assert.rejects(() => downloadRegistrySupport(root, [item]), /EEXIST/)
  assert.deepEqual(await readFile(path), bytes)
  await assert.rejects(
    () =>
      downloadRegistrySupport(root, [
        { ...item, tarball: 'oversized.tgz', tarballSize: bytes.length - 1 }
      ]),
    /frozen size/
  )
  assert.deepEqual(await readFile(path), bytes)
})

for (const name of ['README.md', 'README.en.md']) {
  test(`runtime archive requires maintained ${name}, not a placeholder or altered copy`, async (t) => {
    const badVersions = [
      entries().filter(([path]) => path !== 'package/' + name),
      entries().map(([path, bytes]) => [path, path === 'package/' + name ? 'placeholder' : bytes]),
      entries().map(([path, bytes]) => [
        path,
        path === 'package/' + name
          ? Buffer.from(String(bytes).replace('documented', 'wrong API'))
          : bytes
      ])
    ]
    for (const members of badVersions) {
      const { path, expected } = await fixture(t, members)
      await assert.rejects(inspectFrozenTarball(path, expected), /README|placeholder/)
    }
  })
}

test('frozen archive verification rejects a valid tarball when maintained source differs', async (t) => {
  const { root, expected } = await fixture(t)
  await writeFile(
    join(root, expected.packageDir, 'README.md'),
    '# @example/runtime\n\nDifferent maintained source.\n'
  )
  await assert.rejects(
    verifyFrozenArtifacts(
      root,
      { mode: 'runtime-only', packageCount: 1, packages: [expected] },
      { sourceRoot: root }
    ),
    /differs from maintained source/
  )
})
