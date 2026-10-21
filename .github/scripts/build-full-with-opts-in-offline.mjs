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

const version = '3.2.2'
const repo = process.env.GITHUB_WORKSPACE || process.cwd()
const out = process.env.OUT_DIR
const temp = process.env.RUNNER_TEMP
if (!out || !temp || !resolve(out).startsWith(resolve(temp) + '/')) {
  throw new Error('OUT_DIR must be inside RUNNER_TEMP')
}
const folderName = 'file-viewer-v' + version + '-full-with-opts-in-offline'
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
  assert.match(name, /-3\.2\.2\.tgz$/, 'Unexpected package version')
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
for (const name of [
  '@file-viewer/core', '@file-viewer/renderer-dicom',
  '@file-viewer/renderer-signature', '@file-viewer/renderer-design',
  '@file-viewer/renderer-binary', '@file-viewer/renderer-3d'
]) {
  const manifestPath = presetRequire.resolve(name + '/package.json')
  assert.ok(manifestPath.startsWith(stage + '/'), 'Dependency resolves outside bundle: ' + name)
  file(manifestPath)
}
const virtualStore = join(stage, 'web/node_modules/.pnpm')
const entries = await readdir(virtualStore)
for (const forbidden of ['@file-viewer+renderer-cad@', '@file-viewer+assets-cad@']) {
  assert.ok(!entries.some(name => name.includes(forbidden)), 'Forbidden AGPL package: ' + forbidden)
}
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
  assert.equal(pkg.version, version, 'Asset pack version mismatch: ' + name)
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
await writeFile(join(assetRoot, 'full-with-opts-in-asset-packs.json'),
  JSON.stringify({ schemaVersion: 1, assetPackDetails, attributionConflicts: conflicts,
    separatelyPreservedOriginalLedgers: true }, null, 2) + '\n')
for (const relative of [
  'vendor/pdf/pdf.worker.mjs',
  'wasm/model/occt-import-js.wasm',
  'vendor/ppt/ppt-native.wasm',
  'vendor/drawio/viewer-static.min.js',
  'full-with-opts-in-asset-packs.json'
]) file(join(assetRoot, relative))
for (const forbidden of ['wasm/cad', 'vendor/cad']) {
  assert.equal(existsSync(join(assetRoot, forbidden)), false, 'Forbidden AGPL asset: ' + forbidden)
}
const ledgerOwners = new Set(assetPackDetails.map(x => x.name))
for (const needed of ['@file-viewer/assets-standard', '@file-viewer/assets-typst',
                     '@file-viewer/assets-design', '@file-viewer/assets-drawing']) {
  assert.ok(ledgerOwners.has(needed), 'Missing opt-in asset pack: ' + needed)
}
const ledger = { entries: assetPackDetails, paths: await walk(assetRoot) }
const document = [
  '# File Viewer v3.2.2 — full opt-in offline distribution',
  '',
  'Built against flyfish-dev/file-viewer v3.2.2 with additive opt-in wrappers.',
  'web/ includes precompiled ESM and all installed production dependencies,',
  'including the project renderer packages and third-party runtime modules.',
  'Use web/dist/index.js with your bundler without recompiling File Viewer.',
  'Serve the whole file-viewer/ directory at /file-viewer/ (or configure an',
  'equivalent base path), preserving its manifests, Workers, WASM, fonts,',
  'vendor data and licenses. Original Flyfish installation receipts and',
  'attribution files for each of 11 packs are preserved under asset-packs/.',
  'Where attribution filenames differ, no runtime is overwritten.',
  'No third-party CDN dependency is required.',
  'npm-tarballs/ contains eight compiled framework wrappers and the preset.',
  'Those npm tarballs are not individually standalone browser bundles; their',
  'declared npm dependencies are still required for separate installations.',
  '',
  'Opt-ins: DICOM, signatures/evidence, enhanced IFC, BPMN, design/Adobe',
  'formats, binary inspector and other explicitly selected capabilities.',
  'AGPL-only CAD/DWG/DWF/DWFX runtime is deliberately excluded.',
  '',
  'Source commit: ' + (process.env.GITHUB_SHA || '(local build)'),
  ''
].join('\n')
await writeFile(join(stage, 'README.md'), document)
const sizes = Object.fromEntries([
  'web/dist/index.js',
  'file-viewer/vendor/pdf/pdf.worker.mjs',
  'file-viewer/wasm/model/occt-import-js.wasm',
  'file-viewer/vendor/drawio/viewer-static.min.js'
].map(x => [x, file(join(stage, x))]))
const manifest = {
  schemaVersion: 1,
  upstreamVersion: version,
  sourceCommit: process.env.GITHUB_SHA || null,
  tarballs: all,
  runtimeAssets: {
    ledgerGroups: ledger.entries.length,
    owners: [...ledgerOwners].sort(),
    files: ledger.paths?.length ?? null
  },
  requiredFileSizes: sizes,
  cadAgplRuntimeExcluded: true
}
await writeFile(join(stage, 'OFFLINE_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n')
const runtimeBytes = Object.values(sizes).reduce((a, b) => a + b, 0)
assert.ok(runtimeBytes > 2_000_000, 'Suspiciously small runtime payload: ' + runtimeBytes)
run('tar', ['-czf', archive, '-C', temp, folderName])
const archiveBytes = file(archive)
assert.ok(archiveBytes > 15_000_000, 'Incomplete offline archive: ' + archiveBytes + ' bytes')
console.log(JSON.stringify({ archive: basename(archive), bytes: archiveBytes, ...manifest }))
