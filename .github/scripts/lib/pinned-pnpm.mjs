import { existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { delimiter, dirname, join, resolve } from 'node:path'

const cadesOptionPattern = /(?:^|\s)-cades(?:\s|$)/
const opensslExecutable = process.platform === 'win32' ? 'openssl.exe' : 'openssl'
const wasmOptExecutable = process.platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt'

// Resolve the package manager through the same Node runtime that runs the release
// script, rather than accepting an unrelated global pnpm on PATH.
export function pnpmInvocation() {
  const corepack = corepackInvocation()
  return { command: corepack.command, args: [...corepack.args, 'pnpm'] }
}

// CAdES fixture verification requires an OpenSSL implementation that exposes
// `cms -cades`; macOS ships LibreSSL without that option.
export function resolveCadesOpenSSL(environment = process.env) {
  const configured = String(environment.FILE_VIEWER_OPENSSL || '').trim()
  const pathCandidates = String(environment.PATH || '')
    .split(delimiter)
    .filter(Boolean)
    .map((entry) => resolve(entry, opensslExecutable))
  const platformCandidates =
    process.platform === 'darwin'
      ? [
          '/opt/homebrew/bin/openssl',
          '/opt/homebrew/opt/openssl@3/bin/openssl',
          '/usr/local/bin/openssl',
          '/usr/local/opt/openssl@3/bin/openssl'
        ]
      : []
  const candidates = configured ? [configured] : [...pathCandidates, ...platformCandidates]

  for (const candidate of [...new Set(candidates)]) {
    const result = spawnSync(candidate, ['cms', '-help'], { env: environment, encoding: 'utf8' })
    const help = `${result.stdout || ''}${result.stderr || ''}`
    if (!result.error && cadesOptionPattern.test(help)) return candidate
  }

  if (configured) {
    throw new Error(
      `FILE_VIEWER_OPENSSL does not support the required cms -cades option: ${configured}`
    )
  }
  return undefined
}

export function resolveWasmOpt(environment = process.env) {
  const configured = String(environment.FILE_VIEWER_WASM_OPT || '').trim()
  const pathCandidates = String(environment.PATH || '')
    .split(delimiter)
    .filter(Boolean)
    .map((entry) => resolve(entry, wasmOptExecutable))
  const platformCandidates =
    process.platform === 'darwin'
      ? [
          '/opt/homebrew/bin/wasm-opt',
          '/opt/homebrew/opt/binaryen/bin/wasm-opt',
          '/usr/local/bin/wasm-opt',
          '/usr/local/opt/binaryen/bin/wasm-opt'
        ]
      : []
  const candidates = configured ? [configured] : [...pathCandidates, ...platformCandidates]

  for (const candidate of [...new Set(candidates)]) {
    const result = spawnSync(candidate, ['--version'], { env: environment, encoding: 'utf8' })
    const version = `${result.stdout || ''}${result.stderr || ''}`
    if (!result.error && result.status === 0 && /wasm-opt version/i.test(version)) return candidate
  }

  if (configured) {
    throw new Error(`FILE_VIEWER_WASM_OPT is not a usable wasm-opt executable: ${configured}`)
  }
  return undefined
}

// Package scripts may invoke pnpm again. Put a Corepack shim ahead of PATH so
// those nested calls resolve the repository-declared pnpm version as well.
export function pinnedPnpmEnvironment(root, environment = process.env) {
  const shimDirectory = resolve(root, '.release', 'pnpm-shims')
  mkdirSync(shimDirectory, { recursive: true })
  const corepack = corepackInvocation()
  const enabled = spawnSync(
    corepack.command,
    [...corepack.args, 'enable', '--install-directory', shimDirectory],
    { cwd: root, env: environment, encoding: 'utf8' }
  )
  if (enabled.error || enabled.status !== 0) {
    throw new Error(
      `Unable to create the release pnpm shim: ${(enabled.stderr || enabled.error?.message || '').trim()}`
    )
  }

  const pathEntries = String(environment.PATH || '')
    .split(process.platform === 'win32' ? ';' : ':')
    .filter((entry) => entry && entry !== shimDirectory)
  const wasmOpt = resolveWasmOpt(environment)
  const cadesOpenSSL = resolveCadesOpenSSL(environment)
  const toolDirectories = [wasmOpt, cadesOpenSSL]
    .filter(Boolean)
    .map((tool) => dirname(tool))
    .filter((directory) => directory !== '.')
  // Tool directories can also contain another Node; nested scripts must retain this runtime.
  const PATH = [
    ...new Set([shimDirectory, dirname(process.execPath), ...toolDirectories, ...pathEntries])
  ].join(process.platform === 'win32' ? ';' : ':')
  return {
    ...environment,
    ...(wasmOpt ? { FILE_VIEWER_WASM_OPT: wasmOpt } : {}),
    ...(cadesOpenSSL ? { FILE_VIEWER_OPENSSL: cadesOpenSSL } : {}),
    PATH
  }
}

function corepackInvocation() {
  if (process.platform === 'win32') {
    return { command: 'corepack.cmd', args: [] }
  }

  const bundledCorepack = resolve(dirname(process.execPath), 'corepack')
  if (existsSync(bundledCorepack)) {
    return { command: process.execPath, args: [bundledCorepack] }
  }

  return { command: 'corepack', args: [] }
}
