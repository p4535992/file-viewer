#!/usr/bin/env node
// Release-only offline packager, following the Flyfish compiled package and
// version-matched /file-viewer/ runtime-asset distribution convention.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

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
// Use the project's installers, not its unfiltered upstream CAD-enabled demo.
run(process.execPath, [
  'packages/presets/full-with-opts-in/bin/copy-assets.mjs',
  join(stage, 'file-viewer')
])
for (const relative of [
  'vendor/pdf/pdf.worker.mjs',
  'wasm/model/occt-import-js.wasm',
  'vendor/ppt/ppt-native.wasm',
  'vendor/drawio/viewer-static.min.js',
  'file-viewer-assets.ledger.json',
  'flyfish-viewer-assets.json'
]) file(join(stage, 'file-viewer', relative))
for (const forbidden of ['wasm/cad', 'vendor/cad']) {
  assert.equal(existsSync(join(stage, 'file-viewer', forbidden)), false, 'Forbidden AGPL asset: ' + forbidden)
}
const ledger = JSON.parse(await readFile(join(stage, 'file-viewer/file-viewer-assets.ledger.json'), 'utf8'))
assert.ok(Array.isArray(ledger.entries) && ledger.entries.length > 0, 'Empty asset ledger')
const ledgerOwners = new Set(ledger.entries.map(x => x.ownerPackage))
for (const needed of ['@file-viewer/assets-standard', '@file-viewer/assets-typst',
                     '@file-viewer/assets-design', '@file-viewer/assets-drawing']) {
  assert.ok(ledgerOwners.has(needed), 'Missing opt-in asset pack: ' + needed)
}
const document = [
  '# File Viewer v3.2.2 — full opt-in offline distribution',
  '',
  'Built against flyfish-dev/file-viewer v3.2.2 with additive opt-in wrappers.',
  'web/ includes precompiled ESM and all installed production dependencies,',
  'including the project renderer packages and third-party runtime modules.',
  'Use web/dist/index.js with your bundler without recompiling File Viewer.',
  'Serve the whole file-viewer/ directory at /file-viewer/ (or configure an',
  'equivalent base path), preserving its manifests, Workers, WASM, fonts,',
  'vendor data, licenses and receipts. There is no third-party CDN dependency.',
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
