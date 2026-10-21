import assert from 'node:assert/strict'
import test from 'node:test'
import { stableAssetManifest } from './stable-asset-manifest.mjs'

const manifest = time => ({ schemaVersion: 1, generatedAt: time,
  rendererAssetManifests: [{ rendererId: 'fixture', assets: [{ path: 'worker.js', required: true }] }],
  validation: { valid: true, checkedAt: time, assets: [{ path: 'worker.js', exists: true }], missingRequired: [] } })

test('unchanged public content reuses original timestamps without mutating inputs', () => {
  const before = manifest('2026-10-13T00:00:00Z')
  const next = manifest('2026-10-14T00:00:00Z')
  const snapshot = structuredClone(next)
  assert.equal(stableAssetManifest(before, next), before)
  assert.deepEqual(next, snapshot)
})

test('changed assets, validation failures, new fields and missing timestamps cannot inherit proof', () => {
  const before = manifest('2026-10-13T00:00:00Z')
  for (const alter of [
    value => value.rendererAssetManifests[0].assets[0].path = 'new-worker.js',
    value => value.validation.valid = false,
    value => value.validation.missingRequired.push('worker.js'),
    value => value.validation.assets[0].exists = false,
    value => value.validation.missingOptional = ['optional.wasm'],
    value => value.newField = true
  ]) {
    const next = manifest('2026-10-14T00:00:00Z')
    alter(next)
    assert.equal(stableAssetManifest(before, next), next)
  }
  const next = manifest('2026-10-14T00:00:00Z')
  assert.equal(stableAssetManifest(null, next), next)
  assert.equal(stableAssetManifest({ ...before, generatedAt: 'invalid' }, next), next)
})

test('fresh private validation retains its current time even when publication metadata is reused', () => {
  const before = manifest('2026-10-13T00:00:00Z')
  const current = manifest('2026-10-14T00:00:00Z')
  const publication = stableAssetManifest(before, current)
  const evidence = { ...current, reusedPublicTimestamps: publication === before }
  assert.equal(publication.validation.checkedAt, '2026-10-13T00:00:00Z')
  assert.equal(evidence.validation.checkedAt, '2026-10-14T00:00:00Z')
  assert.equal(evidence.reusedPublicTimestamps, true)
  assert.deepEqual(evidence.validation.assets, publication.validation.assets)
})
