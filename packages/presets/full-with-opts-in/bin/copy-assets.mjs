#!/usr/bin/env node
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const target = resolve(process.argv[2] || 'public/file-viewer')
if (process.argv.length > 3 || process.argv[2]?.startsWith('-')) {
  console.error('Usage: file-viewer-copy-assets-full-with-opts-in [target-directory]')
  process.exit(1)
}

const installers = [
  [
    "@file-viewer/assets-standard",
    "file-viewer-assets-standard"
  ],
  [
    "@file-viewer/assets-typst",
    "file-viewer-assets-typst"
  ],
  [
    "@file-viewer/assets-model",
    "file-viewer-assets-model"
  ],
  [
    "@file-viewer/assets-drawing",
    "file-viewer-assets-drawing"
  ],
  [
    "@file-viewer/assets-iwork",
    "file-viewer-assets-iwork"
  ],
  [
    "@file-viewer/assets-ppt",
    "file-viewer-assets-ppt"
  ],
  [
    "@file-viewer/assets-hangul",
    "file-viewer-assets-hangul"
  ],
  [
    "@file-viewer/assets-wordperfect",
    "file-viewer-assets-wordperfect"
  ],
  [
    "@file-viewer/assets-chm",
    "file-viewer-assets-chm"
  ],
  [
    "@file-viewer/assets-data",
    "file-viewer-assets-data"
  ],
  [
    "@file-viewer/assets-design",
    "file-viewer-assets-design"
  ]
]

function runBin(packageName, binName, destination) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`)
  const metadata = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  const relativeBin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.[binName]
  if (!relativeBin) throw new Error(`${packageName} does not expose ${binName}`)
  const result = spawnSync(process.execPath, [resolve(dirname(packageJsonPath), relativeBin), destination], {
    stdio: 'inherit'
  })
  if (result.status !== 0) process.exit(result.status || 1)
}

for (const [packageName, binName] of installers) runBin(packageName, binName, target)
runBin('@file-viewer/renderer-3d', 'file-viewer-ifc-assets', resolve(target, 'vendor/ifc'))
console.log(`[file-viewer] Installed full-with-opts-in assets in ${target} (CAD/DWG/DWF/DWFX runtime excluded).`)
