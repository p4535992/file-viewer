import { homedir } from 'node:os'
import { isAbsolute, join, parse, resolve } from 'node:path'

export function runtimeOnlyRustBuildEnvironment({ mode, workspaceRoot, env = process.env,
  userDirectory = homedir(), cargoDirectory = env.CARGO_HOME || join(userDirectory, '.cargo') }) {
  if (mode === 'source') return env
  if (mode !== 'runtime-only' || !workspaceRoot || !isAbsolute(workspaceRoot) ||
      resolve(workspaceRoot) === parse(resolve(workspaceRoot)).root) {
    throw new Error('Runtime-only Rust compilation requires its actual workspace directory')
  }
  const inherited = env.CARGO_ENCODED_RUSTFLAGS ? env.CARGO_ENCODED_RUSTFLAGS.split('\x1f') :
    (env.RUSTFLAGS || '').trim().split(/\s+/).filter(Boolean)
  const remaps = [[resolve(userDirectory), '/build-user'], [resolve(cargoDirectory), '/dependencies/cargo'],
    [resolve(workspaceRoot), '/workspace/file-viewer']]
  return { ...env, CARGO_ENCODED_RUSTFLAGS: [...inherited,
    ...remaps.map(([source, target]) => `--remap-path-prefix=${source}=${target}`)].join('\x1f') }
}
