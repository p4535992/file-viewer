import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { loadEcosystemReleaseContext } from './workspace-packages.mjs'
import { canonicalRuntimePath } from './shared-asset-attribution.mjs'

const root = resolve(import.meta.dirname, '../..')
const readJson = async path => JSON.parse(await readFile(join(root, path)))

test('standard asset staging waits for every canonical workspace producer without adding runtime dependencies', async () => {
  const assets = await readJson('packages/tools/assets-standard/package.json')
  const profile = await readJson('packages/presets/standard/file-viewer.profile.json')
  const { entries } = await loadEcosystemReleaseContext(root)
  const ids = new Set()
  for (const name of profile.capabilityPackages) {
    const entry = entries.find(entry => entry.packageName === name)
    if (!entry.packageJson.fileViewer?.capabilityManifest) continue
    const capability = await readJson(join(entry.packageDir, entry.packageJson.fileViewer.capabilityManifest))
    for (const id of capability.assets?.rendererIds || []) ids.add(id)
  }
  const source = await readJson('packages/components/web/viewer/flyfish-viewer-assets.json')
  const producers = new Set()
  for (const manifest of source.rendererAssetManifests.filter(manifest => ids.has(manifest.rendererId))) {
    for (const asset of manifest.assets) {
      if (asset.target !== 'public' || !asset.defaultPath) continue
      const path = canonicalRuntimePath(asset.defaultPath, root)
      const owner = entries.find(entry => path.startsWith(entry.absoluteDir + '/'))
      if (owner) producers.add(owner.packageName)
    }
  }
  assert.deepEqual([...producers].sort(), ['@file-viewer/renderer-pdf', '@file-viewer/renderer-spreadsheet'])
  for (const producer of producers) {
    assert.equal(assets.devDependencies[producer], `workspace:${assets.version}`,
      `Asset staging can race its canonical producer without a build edge: ${producer}`)
    assert.ok(!assets.dependencies[producer], 'Build ordering must not inflate the runtime asset-package closure')
  }
  assert.deepEqual(Object.keys(assets.dependencies), ['@file-viewer/asset-installer'])
})
