export function distributionMode({ args = [], env = process.env, configuredMode } = {}) {
  const indices = args.flatMap((argument, index) => argument === '--distribution-mode' ? [index] : [])
  if (indices.length > 1) throw new Error('Specify the distribution mode exactly once')
  const argument = indices.length ? args[indices[0] + 1] : undefined
  const environment = env.FILE_VIEWER_DISTRIBUTION_MODE
  if (indices.length && !argument) throw new Error('--distribution-mode requires a value')
  for (const value of [argument, environment, configuredMode]) {
    if (value !== undefined && !['source', 'runtime-only'].includes(value)) {
      throw new Error('Distribution mode must be source or runtime-only')
    }
  }
  if (argument && environment && argument !== environment) {
    throw new Error('Distribution mode argument conflicts with the release environment')
  }
  if (configuredMode && [argument, environment].some(value => value && value !== configuredMode)) {
    throw new Error('Distribution mode override conflicts with the maintenance boundary')
  }
  return argument || environment || configuredMode || 'source'
}

export function assertDistributionManifestMode(manifest, expected) {
  const actual = manifest.mode || 'source'
  if (!['source', 'runtime-only'].includes(expected) || actual !== expected) {
    throw new Error('Frozen manifest distribution mode does not match the selected release mode')
  }
  if (actual === 'runtime-only' && manifest.schemaVersion !== 1) {
    throw new Error('Runtime-only manifest requires its versioned distribution schema')
  }
  return actual
}
