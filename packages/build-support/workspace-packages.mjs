import { lstat, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export function npmPackFilename(packageName, packageVersion) {
  return `${packageName.replace(/^@/, '').replace(/\//g, '-')}-${packageVersion}.tgz`
}

/**
 * Packs one ecosystem package in an isolated directory before moving it to its
 * release artifact name. npm's filename mapping is not injective: for example,
 * `@file-viewer/cli` and `file-viewer-cli` both become
 * `file-viewer-cli-<version>.tgz`. Never pack multiple ecosystem packages
 * directly into the shared release directory.
 */
export async function packEcosystemEntryToDirectory(entry, packDir, pack) {
  if (!entry?.packageName || !entry?.version || !entry?.tarballName) {
    throw new Error('Cannot pack an ecosystem entry without package name, version, and tarball name')
  }
  if (entry.tarballName !== basename(entry.tarballName)) {
    throw new Error(`${entry.packageName} release tarball must use a basename-only filename`)
  }
  if (typeof pack !== 'function') {
    throw new Error(`${entry.packageName} pack callback is required`)
  }

  const destination = resolve(packDir)
  await mkdir(destination, { recursive: true })
  const stagingDir = await mkdtemp(join(destination, '.pack-'))
  try {
    await pack(entry, stagingDir)
    const packedTarball = join(
      stagingDir,
      npmPackFilename(entry.packageName, entry.version)
    )
    const details = await lstat(packedTarball)
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error(`${entry.packageName} staged tarball is not a regular file`)
    }
    const releaseTarball = join(destination, entry.tarballName)
    await rm(releaseTarball, { force: true })
    await rename(packedTarball, releaseTarball)
    return releaseTarball
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
}

function releaseTarballName(packageJson, spec) {
  const tarballBaseName = spec.releaseArtifact?.tarballBaseName
  if (tarballBaseName === undefined) {
    return npmPackFilename(packageJson.name, packageJson.version)
  }
  if (
    typeof tarballBaseName !== 'string' ||
    tarballBaseName.length > 214 ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(tarballBaseName)
  ) {
    throw new Error(
      `Invalid releaseArtifact.tarballBaseName for ${packageJson.name}: expected one lowercase npm-safe basename segment`
    )
  }
  return `${tarballBaseName}-${packageJson.version}.tgz`
}

export function ecosystemEntryReleaseVersion(entry) {
  return entry?.compatibilityPackage?.releaseVersion ??
    entry?.wrapper?.releaseVersion ??
    entry?.renderer?.releaseVersion ??
    entry?.preset?.releaseVersion ??
    entry?.utilityPackage?.releaseVersion ??
    entry?.corePackage?.releaseVersion ??
    null
}

export function ecosystemEntryExpectedVersion(entry, fallbackVersion) {
  return ecosystemEntryReleaseVersion(entry) || fallbackVersion
}

export function ecosystemPackageSpecs(wrapperManifest) {
  return [
    {
      id: 'core',
      kind: 'core',
      packageDir: 'packages/core',
      publicSource: true,
      corePackage: wrapperManifest.corePackage
    },
    ...(wrapperManifest.utilityPackages || []).map(utilityPackage => ({
      id: utilityPackage.id,
      kind: 'utility',
      packageDir: utilityPackage.packageDir,
      utilityPackage,
      publicSource: utilityPackage.publicSource !== false
    })),
    ...(wrapperManifest.renderers || []).map(renderer => ({
      id: `renderer-${renderer.id}`,
      kind: 'renderer',
      packageDir: renderer.packageDir,
      renderer,
      publicSource: renderer.publicSource !== false
    })),
    ...(wrapperManifest.presets || []).map(preset => ({
      id: `preset-${preset.id}`,
      kind: 'preset',
      packageDir: preset.packageDir,
      preset,
      publicSource: preset.publicSource !== false
    })),
    ...(wrapperManifest.compatibilityPackages || []).map(compatibilityPackage => ({
      id: compatibilityPackage.id,
      kind: 'compatibility',
      packageDir: compatibilityPackage.packageDir,
      compatibilityPackage,
      publicSource: compatibilityPackage.publicSource === true,
      releaseArtifact: compatibilityPackage.releaseArtifact ?? {
        includeTarball: true
      }
    })),
    ...wrapperManifest.wrappers.map(wrapper => ({
      id: wrapper.id,
      kind: 'standard-wrapper',
      packageDir: wrapper.packageDir,
      wrapper,
      publicSource: true
    }))
  ]
}

export const ecosystemReleaseDependencyFields = Object.freeze([
  'dependencies',
  'optionalDependencies',
  'peerDependencies'
])

export function collectEcosystemReleaseDependencies(entry, packageNames) {
  const dependencies = new Set()
  for (const field of ecosystemReleaseDependencyFields) {
    for (const packageName of Object.keys(entry.packageJson[field] || {})) {
      if (packageNames.has(packageName)) {
        dependencies.add(packageName)
      }
    }
  }
  return [...dependencies]
}

function findEcosystemReleaseDependencyCycle(remainingNames, dependenciesByName) {
  const remaining = new Set(remainingNames)
  const state = new Map()
  const stack = []

  function visit(packageName) {
    const currentState = state.get(packageName)
    if (currentState === 'visiting') {
      const cycleStart = stack.indexOf(packageName)
      return [...stack.slice(cycleStart), packageName]
    }
    if (currentState === 'visited') {
      return null
    }

    state.set(packageName, 'visiting')
    stack.push(packageName)
    for (const dependency of dependenciesByName.get(packageName) || []) {
      if (!remaining.has(dependency)) {
        continue
      }
      const cycle = visit(dependency)
      if (cycle) {
        return cycle
      }
    }
    stack.pop()
    state.set(packageName, 'visited')
    return null
  }

  for (const packageName of remainingNames) {
    const cycle = visit(packageName)
    if (cycle) {
      return cycle
    }
  }
  return null
}

/**
 * Keeps the manifest order as the tie-breaker while ensuring every workspace
 * dependency is packed or published before the package that consumes it.
 */
export function stableTopologicalSortEcosystemEntries(entries) {
  const packageNames = new Set()
  for (const entry of entries) {
    if (!entry.packageName) {
      throw new Error('Ecosystem release entry is missing packageName')
    }
    if (packageNames.has(entry.packageName)) {
      throw new Error(`Duplicate ecosystem release package: ${entry.packageName}`)
    }
    packageNames.add(entry.packageName)
  }

  const dependenciesByName = new Map(
    entries.map(entry => [
      entry.packageName,
      collectEcosystemReleaseDependencies(entry, packageNames)
    ])
  )
  const remaining = [...entries]
  const sorted = []
  const released = new Set()

  while (remaining.length > 0) {
    const nextIndex = remaining.findIndex(entry =>
      dependenciesByName.get(entry.packageName).every(dependency => released.has(dependency))
    )
    if (nextIndex < 0) {
      const remainingNames = remaining.map(entry => entry.packageName)
      const cycle = findEcosystemReleaseDependencyCycle(remainingNames, dependenciesByName)
      throw new Error(
        cycle
          ? `Ecosystem release dependency cycle detected: ${cycle.join(' -> ')}`
          : `Could not resolve ecosystem release dependency order for: ${remainingNames.join(', ')}`
      )
    }

    const [entry] = remaining.splice(nextIndex, 1)
    sorted.push(entry)
    released.add(entry.packageName)
  }

  return sorted
}

export async function loadEcosystemPackageEntry(sourceRoot, spec) {
  const absoluteDir = resolve(sourceRoot, spec.packageDir)
  const packageJson = await readJson(join(absoluteDir, 'package.json'))
  return {
    ...spec,
    absoluteDir,
    packageJson,
    packageName: packageJson.name,
    version: packageJson.version,
    tarballName: releaseTarballName(packageJson, spec),
    releaseArtifact: spec.releaseArtifact ?? {
      includeTarball: true
    }
  }
}

export async function loadEcosystemReleaseContext(sourceRoot) {
  const rootPackage = await readJson(join(sourceRoot, 'package.json'))
  const wrapperManifest = await readJson(join(sourceRoot, 'ecosystem', 'wrappers.json'))
  const specs = ecosystemPackageSpecs(wrapperManifest)
  const entries = await Promise.all(specs.map(spec => loadEcosystemPackageEntry(sourceRoot, spec)))
  const tarballOwners = new Map()
  for (const entry of entries) {
    const owner = tarballOwners.get(entry.tarballName)
    if (owner) {
      throw new Error(
        `Ecosystem release tarball collision: ${owner} and ${entry.packageName} both use ${entry.tarballName}`
      )
    }
    tarballOwners.set(entry.tarballName, entry.packageName)
  }
  return {
    rootPackage,
    wrapperManifest,
    specs,
    entries
  }
}

export function collectExportEntrypoints(value, paths = new Set()) {
  if (!value) {
    return paths
  }
  if (typeof value === 'string') {
    paths.add(value)
    return paths
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectExportEntrypoints(item, paths)
    }
    return paths
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectExportEntrypoints(item, paths)
    }
  }
  return paths
}

export function collectPackageEntrypoints(packageJson) {
  const entrypoints = new Set()
  for (const field of ['main', 'module', 'browser', 'types', 'svelte']) {
    if (typeof packageJson[field] === 'string') {
      entrypoints.add(packageJson[field])
    }
  }
  for (const item of collectExportEntrypoints(packageJson.exports)) {
    entrypoints.add(item)
  }
  for (const item of Object.values(packageJson.bin || {})) {
    if (typeof item === 'string') {
      entrypoints.add(item)
    }
  }
  return [...entrypoints].filter(entrypoint =>
    !entrypoint.startsWith('/') &&
    !entrypoint.includes(':') &&
    !entrypoint.includes('*') &&
    !entrypoint.startsWith('#') &&
    entrypoint !== './' &&
    entrypoint !== '.'
  )
}

export function ecosystemPackageManifestEntry(entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    packageName: entry.packageName,
    version: entry.version,
    packageDir: entry.packageDir,
    tarball: entry.tarballName,
    publicSource: entry.publicSource,
    releaseArtifact: entry.releaseArtifact,
    targetPackage: entry.compatibilityPackage?.targetPackage ?? null,
    releaseVersion: ecosystemEntryReleaseVersion(entry),
    github: entry.wrapper?.github ?? entry.renderer?.github ?? entry.preset?.github ?? entry.utilityPackage?.github ?? null,
    gitee: entry.wrapper?.gitee ?? entry.renderer?.gitee ?? entry.preset?.gitee ?? entry.utilityPackage?.gitee ?? null,
    sourceRepository: entry.corePackage?.sourceRepository ?? null
  }
}
