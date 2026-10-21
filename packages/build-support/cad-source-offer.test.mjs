import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CAD_INTEGRATION_SOURCE, appendCadIntegrationSourceNotice,
  cadIntegrationSourceNotice, writeCadIntegrationSourceNotice } from './cad-source-offer.mjs'

test('the source offer binds the release version to the reviewed archive', () => {
  const text = cadIntegrationSourceNotice('3.2.2')
  assert.ok(text.includes(CAD_INTEGRATION_SOURCE.url))
  assert.ok(text.includes('ca91f24f8adf161bc41a787d111afca493f15f2ee15511dc25e5153a7a607b57'))
  assert.throws(() => cadIntegrationSourceNotice('3.2.3'), /different release/)
})

test('appending or reusing the integration offer preserves every original notice byte', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'file-viewer-cad-source-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'THIRD_PARTY_LICENSES.txt')
  const original = Buffer.from('@flyfish-dev/cad-viewer@0.8.3\r\ndwf-viewer@0.6.7\r\nOriginal grant ©\r\n')
  await writeFile(path, original)
  await appendCadIntegrationSourceNotice(path, '3.2.2')
  const output = await readFile(path)
  assert.ok(output.subarray(0, original.length).equals(original))
  assert.ok(output.toString().includes(CAD_INTEGRATION_SOURCE.url))
  await appendCadIntegrationSourceNotice(path, '3.2.2')
  assert.ok((await readFile(path)).equals(output))
})

test('a different runtime or release cannot acquire a stale integration offer', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'file-viewer-cad-source-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'THIRD_PARTY_LICENSES.txt')
  const original = '@flyfish-dev/cad-viewer@0.8.2\ndwf-viewer@0.6.7\n'
  await writeFile(path, original)
  await assert.rejects(appendCadIntegrationSourceNotice(path, '3.2.2'), /exact normal bundled/)
  assert.equal(await readFile(path, 'utf8'), original)
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: '@file-viewer/renderer-cad', version: '3.2.3',
    dependencies: { '@flyfish-dev/cad-viewer': '0.8.3' }
  }))
  await assert.rejects(writeCadIntegrationSourceNotice(dir), /different release/)
  await assert.rejects(readFile(join(dir, 'CORRESPONDING_SOURCE_NOTICE.txt')), { code: 'ENOENT' })
})

test('combined CAD notices append or preserve exactly the reviewed source offer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'file-viewer-cad-offer-'))
  try {
    const file = join(root, 'NOTICE')
    const original = '@flyfish-dev/cad-viewer@0.8.3\ndwf-viewer@0.6.7\n'
    await writeFile(file, original)
    await appendCadIntegrationSourceNotice(file, '3.2.2')
    const expected = original + '\n\n' + cadIntegrationSourceNotice('3.2.2')
    assert.equal(await readFile(file, 'utf8'), expected)
    await appendCadIntegrationSourceNotice(file, '3.2.2')
    assert.equal(await readFile(file, 'utf8'), expected)
    for (const bad of [expected + cadIntegrationSourceNotice('3.2.2'),
      expected.replace('ca91f24f8adf161bc41a787d111afca493f15f2ee15511dc25e5153a7a607b57', 'invalid'),
      expected.replace('@flyfish-dev/cad-viewer@0.8.3', '@flyfish-dev/cad-viewer@0.8.0')]) {
      await writeFile(file, bad)
      await assert.rejects(() => appendCadIntegrationSourceNotice(file, '3.2.2'))
      assert.equal(await readFile(file, 'utf8'), bad)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
