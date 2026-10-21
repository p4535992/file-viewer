import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { browserLibraryDefines, browserRuntimeOptions } from './browser-runtime-options.mjs'

test('runtime-only browser options preserve original legal comments and source mode defaults', () => {
  assert.deepEqual(browserRuntimeOptions('source'), { minify: false, legalComments: 'eof' })
  assert.deepEqual(browserRuntimeOptions('runtime-only'), { minify: true, legalComments: 'eof' })
})

test('identical dependencies in different physical stores produce identical executable runtime bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'browser-runtime-paths-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const outputs = []
  const unminified = []
  for (const name of ['first-private-worktree', 'second-private-worktree']) {
    const project = join(root, 'project-' + name)
    const dependency = join(root, name, 'dependency-store', 'fixture-library')
    await mkdir(join(project, 'node_modules'), { recursive: true })
    await mkdir(dependency, { recursive: true })
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'fixture-library', version: '1.0.0', main: 'index.cjs' }))
    await writeFile(join(dependency, 'index.cjs'), '/*! Copyright Fixture Author; MIT license. */\nmodule.exports = value => value + 1\n')
    await symlink(dependency, join(project, 'node_modules/fixture-library'))
    const options = { absWorkingDir: project, stdin: { contents: 'import add from "fixture-library"; export const result = add(41)', resolveDir: project },
      bundle: true, platform: 'browser', format: 'cjs', target: 'es2018', write: false }
    outputs.push((await build({ ...options, ...browserRuntimeOptions('runtime-only') })).outputFiles[0].text)
    unminified.push((await build({ ...options, ...browserRuntimeOptions('source') })).outputFiles[0].text)
  }
  assert.notEqual(unminified[0], unminified[1], 'Baseline must reproduce physical path-dependent bytes')
  assert.equal(outputs[0], outputs[1])
  assert.ok(outputs[0].includes('Copyright Fixture Author; MIT license.'))
  assert.ok(!/private-worktree|dependency-store/.test(outputs[0]))
  const module = { exports: {} }
  new Function('module', outputs[0])(module)
  assert.equal(module.exports.result, 42)
})

test('browser SDK URLs keep explicit public configuration without application environment APIs', async () => {
  const contents = `
function environmentPath() { try { return process.env.PUBLIC_URL || undefined } catch { return undefined } }
export function assetBase() { return globalThis.PUBLIC_URL || globalThis.config?.path || environmentPath() || '/' }
`
  const output = (await build({ stdin: { contents }, bundle: true, format: 'cjs',
    platform: 'browser', target: 'es2020', write: false, define: browserLibraryDefines() })).outputFiles[0].text
  assert.doesNotMatch(output, /process\.env\.PUBLIC_URL/)
  for (const [globals, expected] of [[{}, '/'], [{ PUBLIC_URL: '/explicit/' }, '/explicit/'],
    [{ config: { path: '/configured/' } }, '/configured/']]) {
    const module = { exports: {} }
    new Function('globalThis', 'module', 'exports', output)(globals, module, module.exports)
    assert.equal(module.exports.assetBase(), expected)
  }
})
