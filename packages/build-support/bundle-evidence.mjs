import { join } from 'node:path'
import { writeBundleNotices } from './bundle-notices.mjs'
import { writeBundleInventory } from './bundle-inventory.mjs'

/** Preserve owner build options while recording all physical bundled inputs. */
export function captureBundleEvidence(build, packageDir, label, noticeOptions = {}) {
  const inputs = new Set()
  return {
    async build(options) {
      const result = await build({ ...options, metafile: true })
      for (const input of Object.keys(result.metafile.inputs)) inputs.add(input)
      return result
    },
    async finish() {
      await writeBundleInventory([...inputs], join(packageDir, '.build', label + '-inputs.json'))
      await writeBundleNotices(
        { inputs: Object.fromEntries([...inputs].map(input => [input, {}])) },
        join(packageDir, 'dist', label + '.THIRD_PARTY_LICENSES.txt'), noticeOptions
      )
    }
  }
}
