import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profile = JSON.parse(await readFile(resolve(pkg, 'source/postscript/upstream.json'), 'utf8'))
const source = resolve(process.argv[2] || '')
assert.ok(process.argv[2], 'Pass the pinned upstream stet checkout path.')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' })
assert.equal(git.stdout.trim(), profile.commit)
for (const args of [['diff', '--name-only', 'HEAD'], ['ls-files', '--others', '--exclude-standard']]) {
  const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.ok(result.stdout.trim().split('\n').every(path => !path || path === 'crates/stet-wasm/Cargo.lock'), 'Native notices require unmodified upstream source')
}
const lock = await readFile(resolve(source, 'crates/stet-wasm/Cargo.lock'))
assert.equal(hash(lock), profile.cargoLockSha256)
const lockedChecksums = new Map(lock.toString('utf8').split('[[package]]').flatMap(block => {
  const name = block.match(/^name = "([^"]+)"/m)?.[1]
  const version = block.match(/^version = "([^"]+)"/m)?.[1]
  const checksum = block.match(/^checksum = "([^"]+)"/m)?.[1]
  return checksum ? [[`${name}@${version}`, checksum]] : []
}))
const archiveFiles = bytes => {
  const tar = gunzipSync(bytes), files = new Map()
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(x => x === 0)) break
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '')
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8) || 0
    const prefix = header.subarray(345, 500).toString().replace(/\0.*$/s, '')
    if (header[156] === 0 || header[156] === 48) {
      const path = (prefix ? `${prefix}/${name}` : name).split('/').slice(1).join('/')
      files.set(path, tar.subarray(offset + 512, offset + 512 + size))
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}
const result = spawnSync('cargo', [`+${profile.tools.rust}`, 'metadata', '--offline', '--locked', '--manifest-path', resolve(source, 'crates/stet-wasm/Cargo.toml'), '--format-version', '1'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
assert.equal(result.status, 0, result.stderr)
const metadata = JSON.parse(result.stdout)
const materials = {}
const material = bytes => {
  const sha256 = hash(bytes), text = bytes.toString('utf8')
  assert.ok(Buffer.from(text).equals(bytes), 'Legal material must round-trip without byte changes')
  materials[sha256] = { text, bytes: bytes.length }
  return sha256
}
const legalPaths = async (directory, prefix = '') => {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'target' || entry.name === '.git') continue
    const name = prefix + entry.name, path = resolve(directory, entry.name)
    if (entry.isDirectory()) found.push(...await legalPaths(path, name + '/'))
    else if (/^(LICENSE|COPYING|NOTICE|COPYRIGHT)([._-]|$)/i.test(entry.name)) found.push([name, path])
  }
  return found
}
const packages = []
for (const entry of metadata.packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'))) {
  const root = dirname(entry.manifest_path)
  const registry = entry.source?.startsWith('registry+')
  const checksum = registry ? lockedChecksums.get(`${entry.name}@${entry.version}`) : undefined
  let archive
  if (registry) {
    const cached = resolve(root, '../../..', 'cache', basename(dirname(root)), `${entry.name}-${entry.version}.crate`)
    const bytes = await readFile(cached)
    assert.equal(hash(bytes), checksum, `${entry.name} archive does not match Cargo.lock`)
    archive = archiveFiles(bytes)
    assert.ok((await readFile(entry.manifest_path)).equals(archive.get('Cargo.toml')), `${entry.name} metadata changed`)
  }
  const record = {
    name: entry.name, version: entry.version, declaredLicense: entry.license,
    ...(registry ? {
      checksum,
      packageMetadataSha256: hash(await readFile(entry.manifest_path)),
      source: `https://static.crates.io/crates/${entry.name}/${entry.name}-${entry.version}.crate`,
    } : {
      sourceCommit: profile.commit,
      source: `https://github.com/AndyCappDev/stet/tree/${profile.commit}/${relative(source, root).replaceAll('\\', '/')}`,
    }),
    profiles: ['stet-conservative-lock'], legalFiles: [],
  }
  const legal = await legalPaths(root)
  for (const [name, path] of legal.sort((a, b) => a[0].localeCompare(b[0], 'en'))) {
    const bytes = await readFile(path)
    if (registry) assert.ok(bytes.equals(archive.get(name)), `${entry.name}/${name} changed from registry source`)
    record.legalFiles.push({ name, sha256: material(bytes) })
  }
  if (entry.name === 'jpeg-encoder') {
    const bytes = await readFile(resolve(root, 'src/fdct.rs'))
    assert.ok(bytes.equals(archive.get('src/fdct.rs')))
    const end = bytes.indexOf(Buffer.from('*/'))
    assert.ok(end > 0 && bytes.subarray(0, end).includes(Buffer.from('Independent JPEG Group')))
    record.legalFiles.push({ name: 'src/fdct.rs#original-license-header', sha256: material(bytes.subarray(0, end + 2)) })
  }
  if (!record.legalFiles.length) {
    const override = profile.licenseOverrides[entry.name]
    assert.ok(override, `${entry.name}: no original legal file collected`)
    const vcs = JSON.parse(await readFile(resolve(root, '.cargo_vcs_info.json'), 'utf8'))
    assert.equal(vcs.git.sha1, override.crateSourceCommit)
    const bytes = await readFile(resolve(pkg, 'source/postscript', override.path))
    assert.equal(hash(bytes), override.sha256)
    record.legalFiles.push({ name: 'upstream/LICENSE', source: override.url, sha256: material(bytes) })
  }
  packages.push(record)
}
const standardLibrary = { version: profile.tools.rust, sourceCommit: profile.rustLicenseSource.commit, scope: 'Original Rust source grants for the declared standard-library build profile; no post-link symbols claim.', legalFiles: [] }
for (const entry of profile.rustLicenseSource.files) {
  const bytes = await readFile(resolve(pkg, 'source/postscript', entry.path))
  assert.equal(hash(bytes), entry.sha256)
  standardLibrary.legalFiles.push({ name: entry.path, source: entry.url, sha256: material(bytes) })
}
const wasm = await readFile(resolve(pkg, 'runtime/postscript/stet_wasm_bg.wasm'))
const book = {
  schemaVersion: 1,
  scope: 'Conservative exact locked source profile including host/build alternatives; no post-link symbols claim.',
  source: { repository: 'https://github.com/AndyCappDev/stet', commit: profile.commit, includesCoveredModifications: false, scope: 'Unmodified upstream source and resources; only the documented downstream dependency lock is supplied.' },
  lockSha256: hash(lock), runtimeFiles: [{ path: 'stet_wasm_bg.wasm', bytes: wasm.length, sha256: hash(wasm) }],
  packages, standardLibrary, materials,
}
const bookPath = resolve(pkg, 'LICENSES/Stet_NATIVE_THIRD_PARTY_LICENSES.json')
const bookBytes = Buffer.from(JSON.stringify(book, null, 2) + '\n')
if (process.argv.includes('--check')) assert.ok(bookBytes.equals(await readFile(bookPath)), 'Native notice book differs from the pinned upstream and exact cache')
else await writeFile(bookPath, bookBytes)
console.log(`[postscript-notices] ${packages.length} locked packages, ${Object.keys(materials).length} unmodified legal materials, bound to WASM ${hash(wasm)}.`)
