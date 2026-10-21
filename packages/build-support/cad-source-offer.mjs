import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const CAD_INTEGRATION_SOURCE = Object.freeze({
  // 3.2.2 retains the same CAD/DWF inputs and byte-identical integration.
  // The original reviewed corresponding-source archive therefore still applies.
  releaseVersion: '3.2.2',
  cadVersion: '0.8.3',
  dwfVersion: '0.6.7',
  url: 'https://github.com/flyfish-dev/file-viewer/releases/download/v3.2.0-sources/file-viewer-cad-corresponding-source-3.2.0.tar.gz',
  sha256: 'ca91f24f8adf161bc41a787d111afca493f15f2ee15511dc25e5153a7a607b57'
})

export function cadIntegrationSourceNotice(releaseVersion) {
  assert.equal(releaseVersion, CAD_INTEGRATION_SOURCE.releaseVersion,
    'The CAD integration source offer must be reviewed for a different release')
  return [
    'File Viewer CAD integration corresponding source',
    '',
    'Package release: ' + releaseVersion,
    'Source archive: ' + CAD_INTEGRATION_SOURCE.url,
    'SHA-256: ' + CAD_INTEGRATION_SOURCE.sha256,
    '',
    'This archive reconstructs the CAD JavaScript integration from the original public preferred source, version-specific asset-license descriptors, fixed dependencies and ordinary build scripts.',
    'It retains complete original license texts and identifies the exact public CAD, DWF and LibreDWG bindings sources in upstream-sources.json.',
    'The integration output is 622,502 bytes with SHA-256 9d548ef213c59c2ffe81070c7410b1825093817f684ee5353486f409e913f3f5.',
    'The original component grants, attribution and native source notices remain applicable.',
    ''
  ].join('\n')
}

export async function writeCadIntegrationSourceNotice(packageDir) {
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@file-viewer/renderer-cad',
    'This generator writes only the CAD renderer source notice')
  assert.equal(manifest.dependencies['@flyfish-dev/cad-viewer'], CAD_INTEGRATION_SOURCE.cadVersion,
    'The CAD source offer must be reviewed for a different runtime')
  await writeFile(join(packageDir, 'CORRESPONDING_SOURCE_NOTICE.txt'),
    cadIntegrationSourceNotice(manifest.version))
}

export async function appendCadIntegrationSourceNotice(noticePath, releaseVersion) {
  const originalBytes = await readFile(noticePath)
  const original = originalBytes.toString('utf8')
  assert.ok(original.includes('@flyfish-dev/cad-viewer@' + CAD_INTEGRATION_SOURCE.cadVersion) &&
    original.includes('dwf-viewer@' + CAD_INTEGRATION_SOURCE.dwfVersion),
  'The combined CAD source offer requires both exact normal bundled owner notices')
  const offer = cadIntegrationSourceNotice(releaseVersion)
  const headings = original.split('File Viewer CAD integration corresponding source').length - 1
  if (headings) {
    assert.equal(headings, 1, 'The integration source offer must occur exactly once')
    assert.equal(original.split(offer).length - 1, 1,
      'The retained integration source offer differs from the exact reviewed release')
    return
  }
  await writeFile(noticePath, Buffer.concat([originalBytes, Buffer.from('\n\n' + offer)]))
}
