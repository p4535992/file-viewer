import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'

const upstreamOrigin = 'https://registry.npmjs.org'

// The registry belongs to the optional-SDK type verifier, not the viewer runtime.
// Accept origin-form requests only; never concatenate an unchecked HTTP target
// into a redirect authority (absolute-form targets are also valid HTTP input).
export function createOptionalSdkRegistry(packages) {
  const server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { allow: 'GET, HEAD' }).end('This validation registry is read-only')
        return
      }
      const target = request.url
      let upstream
      let path
      try {
        if (
          typeof target !== 'string' ||
          !target.startsWith('/') ||
          target.startsWith('//') ||
          /[\\\u0000-\u0020\u007f#]/.test(target)
        )
          throw new Error('Invalid request target')
        upstream = new URL(target, upstreamOrigin)
        if (upstream.origin !== upstreamOrigin || upstream.username || upstream.password)
          throw new Error('Invalid registry origin')
        path = decodeURIComponent(upstream.pathname)
      } catch {
        response.writeHead(400).end('Invalid registry request target')
        return
      }
      if (path.startsWith('/tarballs/')) {
        const p = [...packages.values()].find((p) => '/tarballs/' + p.row.tarball === path)
        if (!p) return response.writeHead(404).end()
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': (await stat(p.tarball)).size
        })
        if (request.method === 'HEAD') return response.end()
        createReadStream(p.tarball).pipe(response)
        return
      }
      const name = path.slice(1)
      if (packages.has(name)) {
        const p = packages.get(name)
        const registry = 'http://127.0.0.1:' + server.address().port
        const metadata = {
          ...p.manifest,
          dist: { tarball: registry + '/tarballs/' + p.row.tarball, integrity: p.row.integrity }
        }
        const body = JSON.stringify({
          name,
          'dist-tags': { latest: p.row.version },
          versions: { [p.row.version]: metadata }
        })
        response
          .writeHead(200, {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body)
          })
          .end(request.method === 'HEAD' ? undefined : body)
      } else response.writeHead(307, { location: upstream.href }).end()
    } catch (error) {
      response.writeHead(500).end(String(error))
    }
  })
  return server
}
