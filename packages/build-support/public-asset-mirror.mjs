import { existsSync } from 'node:fs'
import { join } from 'node:path'

// The public mirror does not track packages/components/web/viewer or
// third_party/drawio. Their byte-identical copies live under
// apps/viewer-demo/public (see scripts/lib/public-source-index.mjs). Callers
// still verify every resolved file against its pinned digest.
const mirrors = [
  ['packages/components/web/viewer/', 'apps/viewer-demo/public/'],
  ['packages/compat/web/viewer/', 'apps/viewer-demo/public/'],
  ['third_party/drawio/', 'apps/viewer-demo/public/vendor/drawio/']
]

export function resolveWorkspaceAsset(sourceRoot, relativePath) {
  const direct = join(sourceRoot, relativePath)
  if (existsSync(direct)) return direct
  for (const [prefix, target] of mirrors) {
    if (!relativePath.startsWith(prefix)) continue
    const mirrored = join(sourceRoot, target, relativePath.slice(prefix.length))
    if (existsSync(mirrored)) return mirrored
  }
  return direct
}
