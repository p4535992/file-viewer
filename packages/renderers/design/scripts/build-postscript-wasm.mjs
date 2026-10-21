import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const provenance = JSON.parse(await readFile(resolve(packageDir, 'source/postscript/upstream.json'), 'utf8'))
const cargoLockPath = resolve(packageDir, 'source/postscript/Cargo.lock')
const keepTemp = process.argv.includes('--keep-temp')
const sha256 = value => createHash('sha256').update(value).digest('hex')
const run = (command, args, cwd, env = process.env) => {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`)
}
const assertToolVersion = (command, args, expected) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  const actual = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.status !== 0 || !actual.includes(expected)) {
    throw new Error(`${command} must match ${expected}; found ${actual}`)
  }
}
const checkFile = async (path, expected) => {
  const bytes = await readFile(path)
  if (sha256(bytes) !== expected) throw new Error(`SHA-256 mismatch: ${path}`)
  return bytes
}

const toolchain = provenance.tools.rust
assertToolVersion('rustc', [`+${toolchain}`, '--version'], `rustc ${toolchain} `)
assertToolVersion('wasm-bindgen', ['--version'], `wasm-bindgen ${provenance.tools.wasmBindgen}`)
assertToolVersion('wasm-opt', ['--version'], `wasm-opt version ${provenance.tools.wasmOpt}`)
await checkFile(cargoLockPath, provenance.cargoLockSha256)
await checkFile(resolve(packageDir, 'LICENSES', provenance.cc0.output), provenance.cc0.sha256)

// A fixed checkout path keeps Rust crate disambiguators reproducible. mkdir
// also refuses a concurrent build instead of deleting its in-progress source.
const temporaryRoot = join(await realpath(tmpdir()), 'file-viewer-stet-upstream-build-v1')
await mkdir(temporaryRoot, { recursive: false })
const sourceDir = resolve(temporaryRoot, 'stet')
const buildEnv = {
  ...process.env,
  CARGO_INCREMENTAL: '0',
  SOURCE_DATE_EPOCH: '0',
  TZ: 'UTC',
  LC_ALL: 'C',
  CARGO_ENCODED_RUSTFLAGS: [
    `--remap-path-prefix=${temporaryRoot}=/file-viewer-stet-build`,
    `--remap-path-prefix=${homedir()}=/file-viewer-build-home`,
    '-Ccodegen-units=1',
  ].join('\x1f'),
}
try {
  run('git', ['init', '--quiet', sourceDir], temporaryRoot)
  run('git', ['remote', 'add', 'origin', provenance.repository], sourceDir)
  run('git', ['fetch', '--depth=1', 'origin', provenance.commit], sourceDir)
  run('git', ['checkout', '--detach', 'FETCH_HEAD'], sourceDir)
  run('git', ['diff', '--exit-code', 'HEAD'], sourceDir)
  // No source patches, font substitutions, profile deletion, or manifest
  // edits. Only the downstream-locked dependency resolution is supplied.
  await copyFile(cargoLockPath, resolve(sourceDir, 'crates/stet-wasm/Cargo.lock'))
  const embedded = []
  for (const asset of provenance.assets) {
    embedded.push(await checkFile(resolve(sourceDir, asset.path), asset.sha256))
  }
  for (const license of provenance.licenses) {
    await checkFile(resolve(sourceDir, license.path), license.sha256)
    await checkFile(resolve(packageDir, 'LICENSES', license.output), license.sha256)
  }
  run('cargo', [`+${toolchain}`, 'fetch', '--locked', '--manifest-path', 'crates/stet-wasm/Cargo.toml'], sourceDir)
  run('cargo', [`+${toolchain}`, 'fmt', '--all', '--', '--check'], sourceDir)
  run('cargo', [
    `+${toolchain}`, 'build', '--locked', '--target', 'wasm32-unknown-unknown', '--release',
    '--manifest-path', 'crates/stet-wasm/Cargo.toml',
  ], sourceDir, buildEnv)
  const rawWasm = resolve(sourceDir, 'crates/stet-wasm/target/wasm32-unknown-unknown/release/stet_wasm.wasm')
  const generatedDir = resolve(temporaryRoot, 'generated')
  await mkdir(generatedDir)
  run('wasm-bindgen', ['--target', 'web', '--out-dir', generatedDir, '--out-name', 'stet_wasm', rawWasm], sourceDir)
  const optimizedWasm = resolve(generatedDir, 'stet_wasm_bg.optimized.wasm')
  run('wasm-opt', ['-Oz', '--strip-debug', '--strip-dwarf', '-o', optimizedWasm, resolve(generatedDir, 'stet_wasm_bg.wasm')], sourceDir)
  const wasm = await readFile(optimizedWasm)
  // LLVM/Binaryen can split data at zero runs. Check initialized linear
  // memory, where the complete resources must exist, rather than requiring
  // every file to occupy one contiguous encoded data segment.
  const runtime = await import(pathToFileURL(resolve(generatedDir, 'stet_wasm.js')).href)
  const instance = runtime.initSync({ module: wasm })
  const embeddedMemory = Buffer.from(instance.memory.buffer)
  for (const [index, bytes] of embedded.entries()) {
    if (!embeddedMemory.includes(bytes)) throw new Error(`Missing embedded upstream asset: ${provenance.assets[index].path}`)
  }
  for (const localPath of [temporaryRoot, homedir()]) {
    if (wasm.includes(Buffer.from(localPath))) throw new Error(`WebAssembly leaks a local build path: ${localPath}`)
  }
  const outputs = [
    ['stet_wasm.js', 'src/postscriptRuntime/stet_wasm.js'],
    ['stet_wasm.d.ts', 'src/postscriptRuntime/stet_wasm.d.ts'],
    ['stet_wasm_bg.optimized.wasm', 'runtime/postscript/stet_wasm_bg.wasm'],
  ]
  for (const [input, output] of outputs) {
    await mkdir(dirname(resolve(packageDir, output)), { recursive: true })
    await copyFile(resolve(generatedDir, input), resolve(packageDir, output))
  }
  run('node', [resolve(packageDir, 'scripts/collect-postscript-notices.mjs'), sourceDir], packageDir)
  console.log(`[renderer-design] Unpatched Stet ${provenance.version} ${provenance.commit}: sha256=${sha256(wasm)}, bytes=${wasm.byteLength}`)
} finally {
  if (keepTemp) console.log(`[renderer-design] Kept build source at ${temporaryRoot}`)
  else await rm(temporaryRoot, { recursive: true, force: true })
}
