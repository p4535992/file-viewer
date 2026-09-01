import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputDirectory = resolve(packageDirectory, 'dist/prettier')
const runtimeModules = {
  standalone: 'prettier/standalone',
  babel: 'prettier/plugins/babel',
  estree: 'prettier/plugins/estree',
  glimmer: 'prettier/plugins/glimmer',
  graphql: 'prettier/plugins/graphql',
  html: 'prettier/plugins/html',
  markdown: 'prettier/plugins/markdown',
  postcss: 'prettier/plugins/postcss',
  typescript: 'prettier/plugins/typescript',
  yaml: 'prettier/plugins/yaml'
}

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })

for (const [name, specifier] of Object.entries(runtimeModules)) {
  const source = fileURLToPath(import.meta.resolve(specifier))
  await copyFile(source, resolve(outputDirectory, `${name}.mjs`))
}

const prettierPackagePath = fileURLToPath(import.meta.resolve('prettier/package.json'))
const prettierPackage = JSON.parse(await readFile(prettierPackagePath, 'utf8'))
await copyFile(
  resolve(dirname(prettierPackagePath), 'LICENSE'),
  resolve(outputDirectory, 'LICENSE')
)
await writeFile(
  resolve(outputDirectory, 'runtime.json'),
  `${JSON.stringify({ name: 'prettier', version: prettierPackage.version }, null, 2)}\n`,
  'utf8'
)
