#!/usr/bin/env node
// Release-only offline packager, following the Flyfish compiled package and
// version-matched /file-viewer/ runtime-asset distribution convention.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

const version = '3.3.3'
const upstreamBaselineVersion = '3.3.3'
// All product dependencies use the same complete official 3.3.3 cohort.
const patchedPackageVersions = Object.freeze({})
const repo = process.env.GITHUB_WORKSPACE || process.cwd()
const out = process.env.OUT_DIR
const temp = process.env.RUNNER_TEMP
if (!out || !temp || !resolve(out).startsWith(resolve(temp) + '/')) {
  throw new Error('OUT_DIR must be inside RUNNER_TEMP')
}
const folderName = 'file-viewer-v' + version + '-full-with-opts-in-r1-offline'
const stage = join(temp, folderName)
const archive = join(out, folderName + '.tar.gz')
function run(exe, args) {
  console.log('[offline]', exe, ...args)
  const result = spawnSync(exe, args, { cwd: repo, stdio: 'inherit' })
  if (result.error || result.status !== 0) {
    throw new Error(exe + ' failed (' + (result.status ?? result.error?.message) + '): ' + args.join(' '))
  }
}
function file(path) {
  const info = statSync(path, { throwIfNoEntry: false })
  assert.ok(info?.isFile() && info.size > 0, 'Missing or empty runtime asset: ' + path)
  return info.size
}
await rm(stage, { recursive: true, force: true })
await mkdir(join(stage, 'npm-tarballs'), { recursive: true })
await mkdir(out, { recursive: true })
const all = (await readdir(out)).filter(n => n.endsWith('.tgz')).sort()
assert.equal(all.length, 9, 'Exactly nine custom npm packages are required')
for (const name of all) {
  assert.ok(name.endsWith(`-${version}.tgz`), `Unexpected package version: ${name} (expected ${version})`)
  await cp(join(out, name), join(stage, 'npm-tarballs', name))
}
// pnpm deploy copies the complete compiled production dependency closure.
run('pnpm', ['--filter', '@file-viewer/web-full-with-opts-in', 'deploy',
  '--prod', '--legacy', join(stage, 'web')])
const web = JSON.parse(await readFile(join(stage, 'web/package.json'), 'utf8'))
assert.equal(web.name, '@file-viewer/web-full-with-opts-in')
assert.equal(web.version, version)
file(join(stage, 'web/dist/index.js'))
// pnpm's deployed production graph is nested under .pnpm and may be linked
// from the preset package, not hoisted to the direct web node_modules root.
const webRequire = createRequire(join(stage, 'web/package.json'))
const presetPath = webRequire.resolve('@file-viewer/preset-full-with-opts-in/package.json')
assert.ok(presetPath.startsWith(stage + '/'), 'Preset resolves outside offline bundle')
file(presetPath)
const presetRequire = createRequire(presetPath)
for (const [name, expectedVersion] of Object.entries(patchedPackageVersions)) {
  const packagePath = presetRequire.resolve(name + '/package.json')
  const metadata = JSON.parse(await readFile(packagePath, 'utf8'))
  assert.equal(metadata.version, expectedVersion, 'Official release package version mismatch: ' + name)
}
for (const name of [
  '@file-viewer/core', '@file-viewer/renderer-dicom',
  '@file-viewer/renderer-signature', '@file-viewer/renderer-design',
  '@file-viewer/renderer-binary', '@file-viewer/renderer-3d'
]) {
  const manifestPath = presetRequire.resolve(name + '/package.json')
  assert.ok(manifestPath.startsWith(stage + '/'), 'Dependency resolves outside bundle: ' + name)
  file(manifestPath)
}
const cadRendererManifest = presetRequire.resolve('@file-viewer/renderer-cad/package.json')
const cadRenderer = JSON.parse(await readFile(cadRendererManifest, 'utf8'))
assert.equal(cadRenderer.version, version, 'CAD renderer version mismatch')
assert.equal(cadRenderer.dependencies['@flyfish-dev/cad-viewer'], '0.8.3', 'Unreviewed CAD runtime version')
const cadRuntimeRequire = createRequire(cadRendererManifest)
const cadRuntime = JSON.parse(await readFile(cadRuntimeRequire.resolve('@flyfish-dev/cad-viewer/package.json'), 'utf8'))
assert.equal(cadRuntime.version, '0.8.3', 'Installed CAD runtime mismatch')
// Run each original Flyfish installer against its own empty staging root.
// Their transactional asset ledgers intentionally reject distinct packages
// overwriting shared attribution filenames. Preserve every package's original
// attribution instead of disabling integrity checks or discarding notices.
const assetRoot = join(stage, 'file-viewer')
const packsRoot = join(stage, 'asset-packs')
await mkdir(assetRoot, { recursive: true })
await mkdir(packsRoot, { recursive: true })
const installers = [
  ['standard', '@file-viewer/assets-standard', 'file-viewer-assets-standard'],
  ['cad', '@file-viewer/assets-cad', 'file-viewer-assets-cad'],
  ['typst', '@file-viewer/assets-typst', 'file-viewer-assets-typst'],
  ['model', '@file-viewer/assets-model', 'file-viewer-assets-model'],
  ['drawing', '@file-viewer/assets-drawing', 'file-viewer-assets-drawing'],
  ['iwork', '@file-viewer/assets-iwork', 'file-viewer-assets-iwork'],
  ['ppt', '@file-viewer/assets-ppt', 'file-viewer-assets-ppt'],
  ['hangul', '@file-viewer/assets-hangul', 'file-viewer-assets-hangul'],
  ['wordperfect', '@file-viewer/assets-wordperfect', 'file-viewer-assets-wordperfect'],
  ['chm', '@file-viewer/assets-chm', 'file-viewer-assets-chm'],
  ['data', '@file-viewer/assets-data', 'file-viewer-assets-data'],
  ['design', '@file-viewer/assets-design', 'file-viewer-assets-design']
]
const assetPackDetails = []
async function walk(folder, root = folder) {
  const files = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    assert.ok(!entry.isSymbolicLink(), 'Unexpected symlink in asset pack: ' + path)
    if (entry.isDirectory()) files.push(...await walk(path, root))
    else if (entry.isFile()) files.push(path.slice(root.length + 1))
  }
  return files
}
const equal = async (a, b) => {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  return hash(await readFile(a)) === hash(await readFile(b))
}
const conflicts = []
for (const [id, name, bin] of installers) {
  const manifestPath = presetRequire.resolve(name + '/package.json')
  const pkg = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(pkg.version,
    patchedPackageVersions[name] || upstreamBaselineVersion,
    'Asset pack version mismatch: ' + name)
  const cli = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[bin]
  assert.ok(cli, 'Flyfish asset pack binary missing: ' + name)
  const target = join(packsRoot, id)
  run(process.execPath, [resolve(dirname(manifestPath), cli), target])
  const ledgerFile = join(target, 'file-viewer-assets.ledger.json')
  file(ledgerFile)
  const ledger = JSON.parse(await readFile(ledgerFile, 'utf8'))
  assert.ok(Array.isArray(ledger.entries) && ledger.entries.length > 0,
    'Empty Flyfish receipt ledger: ' + name)
  const paths = await walk(target)
  for (const path of paths) {
    // Keep original receipts, ledgers and manifests in each package directory.
    // Filename collisions in attribution material are archived verbatim too.
    if (path === 'file-viewer-assets.ledger.json' ||
        path === 'flyfish-viewer-assets.json' ||
        path === 'flyfish-viewer-manifest.json' ||
        path.startsWith('.file-viewer-asset-') ||
        path.includes('receipt')) continue
    const source = join(target, path)
    const dest = join(assetRoot, path)
    if (existsSync(dest)) {
      if (!await equal(source, dest)) {
        // Only attribution metadata may collide. Runtime collisions MUST fail.
        assert.ok(/(?:NOTICE|LICENSE|LICENCES|LICENSES|ATTRIBUTION|THIRD_PARTY)/i.test(path),
          'Conflicting runtime bytes between Flyfish packs: ' + path)
        conflicts.push({ pack: name, path })
      }
      continue
    }
    await mkdir(dirname(dest), { recursive: true })
    await cp(source, dest, { recursive: false, force: false })
  }
  assetPackDetails.push({ name, version: pkg.version, files: paths.length,
    ledgerGroups: ledger.entries.length })
}
// IFC's official installer is also run separately, preserving its native grants.
const ifcPath = presetRequire.resolve('@file-viewer/renderer-3d/package.json')
const ifcPkg = JSON.parse(await readFile(ifcPath, 'utf8'))
const ifcBin = ifcPkg.bin?.['file-viewer-ifc-assets']
assert.ok(ifcBin, 'Missing original IFC asset installer')
const ifcDestination = join(assetRoot, 'vendor/ifc')
run(process.execPath, [resolve(dirname(ifcPath), ifcBin), ifcDestination])
file(join(assetRoot, 'vendor/ifc/manifest.json'))

// Upstream Flyfish keeps Geo3D and XSD/XSLT as explicit specialist entries.
// Copy their source-owned workers, WASM decoders, schema engines and original
// license manifests into the *same-version* offline runtime tree.
const geo3dDir = join(assetRoot, 'vendor/geo3d')
run(process.execPath, ['packages/renderers/3d/bin/copy-geo3d-assets.mjs', geo3dDir])
const geo3dManifest = JSON.parse(await readFile(join(geo3dDir, 'manifest.json'), 'utf8'))
assert.equal(geo3dManifest.schema, 1, 'Malformed Flyfish Geo3D manifest')
assert.equal(geo3dManifest.packages.find(x => x.name === '@giro3d/giro3d')?.version, '2.0.5',
  'Geo3D Giro3D peer not pinned to upstream version')
for (const relative of [
  'laz-perf/laz-perf.wasm', 'workers/las-worker.js',
  'workers/geotiff-worker.js', 'workers/texture-worker.js',
  'three/draco/draco_decoder.wasm', 'three/basis/basis_transcoder.wasm'
]) {
  file(join(geo3dDir, relative))
  assert.ok(geo3dManifest.files[relative], 'Missing Geo3D manifest entry: ' + relative)
}
const xmlDir = join(assetRoot, 'xml')
run(process.execPath, ['packages/renderers/text/bin/copy-xml-profile-assets.mjs', xmlDir])
const xmlManifest = JSON.parse(await readFile(join(xmlDir, 'manifest.json'), 'utf8'))
assert.equal(xmlManifest.schema, 1, 'Malformed Flyfish XML asset manifest')
for (const [name, version] of [['xmllint-wasm', '5.3.0'], ['xslt-polyfill', '1.0.33']]) {
  assert.equal(xmlManifest.engines.find(x => x.name === name)?.version, version,
    'XML engine version not pinned to upstream: ' + name)
}
for (const relative of ['xmllint-browser.mjs', 'xmllint.wasm', 'xslt-wasm.js']) {
  file(join(xmlDir, relative))
  assert.ok(xmlManifest.files[relative], 'Missing XML manifest entry: ' + relative)
}
async function verifyCopiedManifest(folder, manifest, label) {
  assert.ok(manifest.files && Object.keys(manifest.files).length > 0,
    'Empty source manifest: ' + label)
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const path = join(folder, relative)
    const bytes = await readFile(path)
    assert.equal(bytes.length, expected.bytes, 'Asset size mismatch: ' + label + '/' + relative)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256,
      'Asset hash mismatch: ' + label + '/' + relative)
  }
}
await verifyCopiedManifest(geo3dDir, geo3dManifest, 'Geo3D')
await verifyCopiedManifest(xmlDir, xmlManifest, 'XML')

await writeFile(join(assetRoot, 'full-with-opts-in-asset-packs.json'),
  JSON.stringify({ schemaVersion: 1, assetPackDetails, attributionConflicts: conflicts,
    separatelyPreservedOriginalLedgers: true }, null, 2) + '\n')
for (const relative of [
  'vendor/pdf/pdf.worker.mjs',
  'wasm/model/occt-import-js.wasm',
  'vendor/ppt/dist/pptjs.mjs',
  'vendor/ppt/dist/pptjs.worker.js',
  'vendor/drawio/viewer-static.min.js',
  'full-with-opts-in-asset-packs.json',
  'vendor/geo3d/workers/las-worker.js',
  'vendor/geo3d/laz-perf/laz-perf.wasm',
  'vendor/geo3d/three/draco/draco_decoder.wasm',
  'vendor/geo3d/three/basis/basis_transcoder.wasm',
  'xml/xmllint-browser.mjs',
  'xml/xmllint.wasm',
  'xml/xslt-wasm.js'
]) file(join(assetRoot, relative))
const cadBase = join(assetRoot, 'wasm/cad/0.8.3')
for (const filename of [
  'dwg-worker.js', 'dwfv-render.wasm', 'libredwg-web.js', 'libredwg-web.wasm',
  'LICENSE', 'NOTICE', 'GPL-3.0.txt', 'CORRESPONDING_SOURCE_NOTICE.txt', 'CORRESPONDING_SOURCE.zip'
]) file(join(cadBase, filename))
const cadNotice = await readFile(join(cadBase, 'CORRESPONDING_SOURCE_NOTICE.txt'), 'utf8')
assert.ok(cadNotice.includes('@flyfish-dev/cad-viewer 0.8.3'))
assert.ok(cadNotice.includes('dwf-viewer 0.6.7'))
const dwfMagic = (await readFile(join(cadBase, 'dwfv-render.wasm'))).subarray(0, 4)
assert.equal(dwfMagic.toString('hex'), '0061736d', 'Invalid DWF/DWFX WASM module')
const ledgerOwners = new Set(assetPackDetails.map(x => x.name))
for (const needed of ['@file-viewer/assets-standard', '@file-viewer/assets-typst',
                     '@file-viewer/assets-design', '@file-viewer/assets-drawing', '@file-viewer/assets-cad']) {
  assert.ok(ledgerOwners.has(needed), 'Missing opt-in asset pack: ' + needed)
}
const ledger = { entries: assetPackDetails, paths: await walk(assetRoot) }
const document = [
  '# File Viewer v3.3.3 — full opt-in offline distribution',
  '',
  'Built from the official File Viewer v3.3.3 package cohort with additive opt-in wrappers.',
  'web/ contains precompiled ESM and the complete production dependency closure.',
  'Serve the entire file-viewer/ directory from /file-viewer/ or configure a base URL.',
  'npm-tarballs/ contains eight framework wrappers and the full-with-opts-in preset.',
  'All runtime packs, original installation receipts and license records are preserved.',
  'Geo3D assets are under file-viewer/vendor/geo3d/ and XML engines under file-viewer/xml/.',
  'CAD/DWG/DWF/DWFX use @flyfish-dev/cad-viewer 0.8.3 and dwf-viewer 0.6.7.',
  'Offline CAD Worker/WASM files and source notices are under file-viewer/wasm/cad/0.8.3/.',
  'The CAD runtime includes AGPL/GPL components. Redistributors must comply with',
  'their licenses and preserve the bundled corresponding-source offers and notices.',
  'No remote CDN dependency is needed for the supplied runtime assets.',
  '',
  'Source commit: ' + (process.env.GITHUB_SHA || '(local build)'),
  ''
].join('\n')
await writeFile(join(stage, 'README.md'), document)
const sizes = Object.fromEntries([
  'web/dist/index.js',
  'file-viewer/vendor/pdf/pdf.worker.mjs',
  'file-viewer/wasm/model/occt-import-js.wasm',
  'file-viewer/vendor/drawio/viewer-static.min.js',
  'file-viewer/wasm/cad/0.8.3/dwfv-render.wasm',
  'file-viewer/wasm/cad/0.8.3/libredwg-web.wasm',
  'file-viewer/vendor/geo3d/laz-perf/laz-perf.wasm',
  'file-viewer/vendor/geo3d/workers/las-worker.js',
  'file-viewer/xml/xmllint.wasm',
  'file-viewer/xml/xslt-wasm.js'
].map(x => [x, file(join(stage, x))]))
const manifest = {
  schemaVersion: 1,
  upstreamVersion: version,
  upstreamReleaseCommit: '760038d88e9252bc746c04626b82b84226ef6948',
  upstreamBaselineVersion,
  patchedPackageVersions,
  sourceCommit: process.env.GITHUB_SHA || null,
  tarballs: all,
  runtimeAssets: {
    ledgerGroups: ledger.entries.length,
    owners: [...ledgerOwners].sort(),
    files: ledger.paths?.length ?? null
  },
  requiredFileSizes: sizes,
  specialistAssets: {
    geo3d: { source: '@file-viewer/renderer-3d/geo3d', formats: ['las', 'laz', 'copc', 'geotiff', 'cog', 'cityjson', '3dtiles', '3tz'], files: Object.keys(geo3dManifest.files).length },
    xml: { source: '@file-viewer/renderer-text/xml-profiles', engines: xmlManifest.engines, files: Object.keys(xmlManifest.files).length },
    cad: { source: '@flyfish-dev/cad-viewer@0.8.3 / dwf-viewer@0.6.7', wasmPath: 'wasm/cad/0.8.3/', licenses: ['AGPL-3.0', 'GPL-3.0'] }
  },
  cadAgplRuntimeIncluded: true
}
await writeFile(join(stage, 'OFFLINE_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n')
const runtimeBytes = Object.values(sizes).reduce((a, b) => a + b, 0)
assert.ok(runtimeBytes > 2_000_000, 'Suspiciously small runtime payload: ' + runtimeBytes)
run('tar', ['-czf', archive, '-C', temp, folderName])
const archiveBytes = file(archive)
assert.ok(archiveBytes > 15_000_000, 'Incomplete offline archive: ' + archiveBytes + ' bytes')
console.log(JSON.stringify({ archive: basename(archive), bytes: archiveBytes, ...manifest }))
