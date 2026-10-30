import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createOptionalSdkRegistry } from '../../packages/renderers/3d/scripts/optional-sdk-registry.mjs'

async function registry(t, packages = new Map()) {
  const server = createOptionalSdkRegistry(packages)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  assert.equal(server.address().address, '127.0.0.1')
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

function send(server, path, method = 'GET', headers) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: server.address().port, path, method, headers },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks)
          })
        )
        response.on('error', reject)
      }
    )
    req.setTimeout(3000, () => req.destroy(new Error('Local registry request timed out')))
    req.on('error', reject)
    req.end()
  })
}

for (const target of [
  '/typescript',
  '/typescript/latest?channel=stable',
  '/@scope%2fpackage',
  '/@scope%2Fpackage?text=https://outside.invalid',
  '/@scope/package',
  '/%2f%2foutside.invalid/package'
]) {
  test(`registry redirects a normal npm path only to the official origin: ${target}`, async (t) => {
    const { server } = await registry(t)
    for (const method of ['GET', 'HEAD']) {
      const response = await send(server, target, method, { host: 'outside.invalid' })
      assert.equal(response.status, 307)
      assert.equal(response.headers.location, new URL(target, 'https://registry.npmjs.org').href)
      assert.equal(new URL(response.headers.location).origin, 'https://registry.npmjs.org')
      assert.equal(response.body.length, 0)
    }
  })
}

for (const target of [
  'http://outside.invalid/package',
  'https://outside.invalid/package',
  '//outside.invalid/package',
  '///outside.invalid/package',
  '/\\outside.invalid/package',
  '/%zz',
  '/%',
  '/typescript#fragment',
  '*'
]) {
  test(`registry rejects an ambiguous or malformed target without a redirect: ${target}`, async (t) => {
    const { server } = await registry(t)
    const response = await send(server, target)
    assert.equal(response.status, 400)
    assert.equal(response.headers.location, undefined)
  })
}

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
  test(`registry rejects ${method} before redirecting or serving packages`, async (t) => {
    const { server } = await registry(t)
    for (const path of [
      '/typescript',
      '/-/npm/v1/security/audits/quick',
      '/tarballs/candidate.tgz'
    ]) {
      const response = await send(server, path, method)
      assert.equal(response.status, 405)
      assert.equal(response.headers.allow, 'GET, HEAD')
      assert.equal(response.headers.location, undefined)
    }
  })
}

test('registry preserves candidate metadata, exact tarball bytes and HEAD semantics', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'file-viewer-sdk-registry-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bytes = Buffer.from('Synthetic local package bytes'),
    tarball = join(directory, 'candidate.tgz')
  await writeFile(tarball, bytes)
  const manifest = {
    name: '@example/candidate',
    version: '1.2.3',
    dependencies: { typescript: '^6.0.0' }
  }
  const row = {
    tarball: 'candidate.tgz',
    version: manifest.version,
    integrity: 'fixture-integrity'
  }
  const { server, origin } = await registry(
    t,
    new Map([[manifest.name, { row, tarball, manifest }]])
  )
  const response = await send(server, '/@example%2fcandidate')
  assert.equal(response.status, 200)
  const metadata = JSON.parse(response.body)
  assert.deepEqual(metadata['dist-tags'], { latest: row.version })
  assert.deepEqual(metadata.versions[row.version], {
    ...manifest,
    dist: { tarball: origin + '/tarballs/' + row.tarball, integrity: row.integrity }
  })
  assert.equal(response.headers.location, undefined)
  const head = await send(server, '/@example%2fcandidate', 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.body.length, 0)
  assert.equal(head.headers['content-length'], response.headers['content-length'])
  const archive = await send(server, '/tarballs/candidate.tgz')
  assert.equal(archive.status, 200)
  assert.deepEqual(archive.body, bytes)
  const archiveHead = await send(server, '/tarballs/candidate.tgz', 'HEAD')
  assert.equal(archiveHead.status, 200)
  assert.equal(archiveHead.body.length, 0)
  assert.equal(Number(archiveHead.headers['content-length']), bytes.length)
  assert.equal((await send(server, '/tarballs/missing.tgz')).status, 404)
})
