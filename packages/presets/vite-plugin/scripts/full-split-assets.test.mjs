import assert from 'node:assert/strict'
import test from 'node:test'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

test('Full asset copy merges only exact declared split owners without relaxing required files', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'full-split-asset-contract-'))
  const originalCwd = process.cwd()
  const log = console.log,
    warn = console.warn
  try {
    for (const mode of [
      'valid',
      'version',
      'range',
      'identity',
      'missing',
      'conflict',
      'undeclared-asset',
      'escape'
    ]) {
      const root = join(temporary, mode)
      const write = async (path, bytes) => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, bytes)
      }
      const full = join(root, 'node_modules/@file-viewer/web-full')
      const definitions = [
        {
          rendererId: 'cad',
          name: '@file-viewer/assets-cad',
          id: 'cad-runtime',
          path: 'wasm/cad/runtime.wasm',
          kind: 'wasm'
        },
        {
          rendererId: 'drawing',
          name: '@file-viewer/assets-drawing',
          id: 'drawio-runtime',
          path: 'vendor/drawio/viewer.js',
          kind: 'script'
        }
      ]
      const groups = definitions.map((item) => ({
        rendererId: item.rendererId,
        assets: [
          {
            id: item.id,
            rendererId: item.rendererId,
            defaultPath: item.path,
            kind: item.kind,
            target: 'public',
            required: true
          }
        ]
      }))
      if (mode === 'escape') groups[0].assets[0].defaultPath = '../outside.wasm'
      await write(
        join(root, 'package.json'),
        JSON.stringify({ type: 'module', dependencies: { '@file-viewer/web-full': '3.2.0' } })
      )
      await write(
        join(full, 'package.json'),
        JSON.stringify({
          name: '@file-viewer/web-full',
          version: '3.2.0',
          main: 'index.js',
          dependencies: Object.fromEntries(
            definitions.map((item) => [item.name, mode === 'range' ? '^3.2.0' : '3.2.0'])
          )
        })
      )
      await write(join(full, 'index.js'), 'export {}')
      await write(
        join(full, 'dist/flyfish-viewer-assets.json'),
        JSON.stringify({ schemaVersion: 1, rendererAssetManifests: groups })
      )
      await write(
        join(full, 'dist/flyfish-viewer-manifest.json'),
        JSON.stringify({ schemaVersion: 1, version: '3.2.0' })
      )
      await write(join(full, 'dist/original.txt'), 'unchanged base payload')
      for (const [index, item] of definitions.entries()) {
        if (mode === 'missing' && index === 0) continue
        const packageRoot = join(full, 'node_modules', item.name)
        const version = mode === 'version' && index === 0 ? '3.1.0' : '3.2.0'
        await write(
          join(packageRoot, 'package.json'),
          JSON.stringify({
            name: mode === 'identity' && index === 0 ? 'wrong-owner' : item.name,
            version
          })
        )
        const group = structuredClone(groups[index])
        if (mode === 'undeclared-asset' && index === 0) group.assets[0].id = 'not-in-full'
        await write(
          join(packageRoot, 'viewer/file-viewer-asset-pack.json'),
          JSON.stringify({
            schemaVersion: 1,
            packageName: item.name,
            packageVersion: version,
            rendererAssetManifests: [group]
          })
        )
        await write(join(packageRoot, 'viewer', item.path), `synthetic ${item.rendererId} bytes`)
      }
      if (mode === 'conflict')
        await write(join(full, 'dist', definitions[1].path), 'different base bytes')
      const isolated = join(root, 'plugin.mjs')
      await copyFile(new URL('../dist/index.js', import.meta.url), isolated)
      process.chdir(root)
      const { fileViewerRenderers } = await import(pathToFileURL(isolated).href)
      const plugin = fileViewerRenderers({
        preset: false,
        formats: ['pptx'],
        scan: false,
        autoPresets: false,
        copyAssets: { mode: 'build', baseDir: 'assets/viewer' }
      })
      plugin.configResolved({
        root,
        publicDir: join(root, 'public'),
        base: '/tenant/app/',
        build: { outDir: 'dist' }
      })
      console.log = () => {}
      console.warn = () => {}
      if (mode === 'valid') {
        await plugin.closeBundle()
        const target = join(root, 'dist/assets/viewer')
        for (const item of definitions)
          assert.equal(
            await readFile(join(target, item.path), 'utf8'),
            `synthetic ${item.rendererId} bytes`
          )
        assert.equal(await readFile(join(target, 'original.txt'), 'utf8'), 'unchanged base payload')
        assert.equal(
          JSON.parse(await readFile(join(target, 'flyfish-viewer-manifest.json'))).version,
          '3.2.0'
        )
        const manifest = JSON.parse(await readFile(join(target, 'flyfish-viewer-assets.json')))
        assert.deepEqual(manifest.rendererAssetManifests, groups)
        assert.ok(
          manifest.assets.every(
            (asset) => asset.copied && asset.required && asset.sourceVersion === '3.2.0'
          )
        )
        assert.deepEqual(
          manifest.assets.map((asset) => asset.sourcePackage),
          definitions.map((item) => item.name)
        )
      } else {
        const patterns = {
          version: /expected 3\.2\.0/,
          range: /must pin/,
          identity: /identity differs/,
          missing: /Could not resolve installed asset owner/,
          conflict: /Asset owners conflict/,
          'undeclared-asset': /differs from the declared Full manifest/,
          escape: /escapes/
        }
        await assert.rejects(plugin.closeBundle(), patterns[mode])
        if (mode === 'conflict')
          assert.equal(
            await readFile(join(root, 'dist/assets/viewer', definitions[1].path), 'utf8'),
            'different base bytes'
          )
      }
      console.log = log
      console.warn = warn
    }
  } finally {
    console.log = log
    console.warn = warn
    process.chdir(originalCwd)
    await rm(temporary, { recursive: true, force: true })
  }
})
