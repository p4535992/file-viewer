import assert from 'node:assert/strict'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const within = (root, path) => {
  const value = relative(root, path)
  return value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)
}

/** pnpm list may report dependency paths relative to its virtual store. */
export function loadInstalledPackage({ sourceRoot, path, expectedName, expectedVersion }) {
  assert.ok(typeof path === 'string' && path && !path.includes('\0'), 'Dependency package path is missing')
  assert.ok(!path.split(/[\\/]/).includes('..'), 'Dependency package path escapes its root')
  const root = realpathSync(resolve(sourceRoot))
  const candidate = isAbsolute(path) ? path : path.startsWith('.pnpm/') || path.startsWith('.pnpm\\')
    ? join(root, 'node_modules', path) : resolve(root, path)
  const packageRoot = realpathSync(candidate)
  assert.ok(within(root, packageRoot) || packageRoot.includes(`${sep}node_modules${sep}`), 'Dependency path is not an installed package or workspace')
  const manifestPath = join(packageRoot, 'package.json')
  const stat = lstatSync(manifestPath)
  assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 2 * 1024 * 1024, 'Dependency manifest must be a regular bounded file')
  const packageJson = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (expectedName) assert.equal(packageJson.name, expectedName, 'Dependency package owner changed')
  if (/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(expectedVersion || '')) {
    assert.equal(packageJson.version, expectedVersion, 'Dependency package version differs from pnpm list')
  }
  return { packageRoot, packageJson }
}
