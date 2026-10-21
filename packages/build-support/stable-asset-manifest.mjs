import { isDeepStrictEqual } from 'node:util'

const content = manifest => {
  const value = structuredClone(manifest)
  delete value.generatedAt
  if (value.validation) delete value.validation.checkedAt
  return value
}

// Keep the original public receipt time only when every non-time field agrees.
// Fresh validation evidence is stored privately by the owning build.
export function stableAssetManifest(previous, next) {
  if (!previous?.generatedAt || !previous.validation?.checkedAt ||
      !Number.isFinite(Date.parse(previous.generatedAt)) ||
      !Number.isFinite(Date.parse(previous.validation.checkedAt))) return next
  return isDeepStrictEqual(content(previous), content(next)) ? previous : next
}
