import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const source = resolve(process.argv[2] || '')
assert.ok(process.argv[2], 'Pass the pinned upstream stet checkout path.')
const pkg = resolve(root, 'packages/renderers/design')
const provenance = JSON.parse(await readFile(resolve(pkg, 'source/postscript/upstream.json'), 'utf8'))
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' })
assert.equal(sha.stdout.trim(), provenance.commit, 'Pinned upstream checkout required')
const changes = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: source, encoding: 'utf8' })
assert.equal(changes.status, 0)
assert.ok(changes.stdout.trim().split('\n').every(x => x === '' || x === 'crates/stet-wasm/Cargo.lock'), 'Upstream source must be unpatched')
const temporary = await mkdtemp(join(tmpdir(), 'file-viewer-stet-source-test-'))
try {
  await copyFile(resolve(pkg, 'source/postscript/Cargo.lock'), resolve(temporary, 'Cargo.lock'))
  const dependencies = ['stet-core', 'stet-ops', 'stet-engine'].map(name =>
    `${name} = { path = ${JSON.stringify(resolve(source, 'crates', name))} }`).join('\n')
  await writeFile(resolve(temporary, 'Cargo.toml'), `[package]\nname = "file-viewer-stet-embedded-font-regression"\nversion = "0.0.0"\nedition = "2024"\n[dependencies]\n${dependencies}\n[[test]]\nname = "embedded-fonts"\npath = ${JSON.stringify(resolve(pkg, 'source/postscript/tests/embedded-fonts.rs'))}\n`)
  const test = spawnSync('cargo', [`+${provenance.tools.rust}`, 'test', '--offline', '--manifest-path', resolve(temporary, 'Cargo.toml')], { stdio: 'inherit' })
  assert.equal(test.status, 0, 'Embedded TTF/CFF upstream regression failed')
} finally { await rm(temporary, { recursive: true, force: true }) }
