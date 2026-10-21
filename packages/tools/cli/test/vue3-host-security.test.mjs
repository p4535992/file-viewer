import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const catalog = JSON.parse(await readFile(new URL('../catalog/catalog.json', import.meta.url)))
const fixedVueVersion = version => {
  const [major, minor, patch] = version.split('.').map(Number)
  return major === 3 && (minor > 5 || (minor === 5 && patch >= 42))
}

test('Vue 3 default includes the upstream SSR attribute-name fix', () => {
  const host = catalog.frameworkTemplates.vue3
  assert.ok(fixedVueVersion(host.defaultVersion), 'GHSA-g2v6-rqmx-r4w6 affects stable Vue versions below 3.5.42')
  assert.equal(host.runtimeDependencies.vue, host.defaultVersion)
})

test('validated Vue 3 choices cannot reintroduce the vulnerable host', () => {
  for (const [version, template] of Object.entries(catalog.frameworkTemplates.vue3.validatedVersions)) {
    assert.ok(fixedVueVersion(version), 'A quickstart choice still installs the vulnerable Vue SSR dependency')
    assert.equal(template.runtimeDependencies.vue, version)
  }
})

test('Vue 2.6 and 2.7 compatibility hosts remain unchanged', () => {
  assert.equal(catalog.frameworkTemplates['vue2.6'].runtimeDependencies.vue, '2.6.14')
  assert.equal(catalog.frameworkTemplates['vue2.7'].runtimeDependencies.vue, '2.7.16')
})
