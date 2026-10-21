import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  renderTiff,
  renderTiffWithDecoder,
  validateTiffPageSafety,
} from '../packages/renderers/image/src/tiff'
import { hasTiffSignature } from '../packages/renderers/image/src/image'

const page = (width: number, height: number) => ({ t256: [width], t257: [height] })
const require = createRequire(new URL('../packages/renderers/image/package.json', import.meta.url))

describe('GitHub issue #208 TIFF safety limits', () => {
  let target: HTMLDivElement

  beforeEach(() => {
    const dom = new JSDOM('<main id="target"><span>unchanged</span></main>', { url: 'http://localhost' })
    target = dom.window.document.getElementById('target') as HTMLDivElement
  })

  it('rejects empty and oversized sources before loading the decoder', async () => {
    await expect(renderTiff(new ArrayBuffer(0), target)).rejects.toThrow('source exceeds')
    await expect(renderTiff(new ArrayBuffer(32 * 1024 * 1024 + 1), target)).rejects.toThrow('source exceeds')
    expect(target.textContent).toBe('unchanged')
  })

  it('rejects damaged input and excessive page counts', async () => {
    await expect(renderTiff(new ArrayBuffer(8), target)).rejects.toThrow()
    expect(() => validateTiffPageSafety(Array.from({ length: 65 }, () => page(1, 1))))
      .toThrow('more than 64 pages')
    expect(target.textContent).toBe('unchanged')
  })

  it.each([
    ['dimension', [page(16_385, 1)]],
    ['single-page pixels', [page(8_000, 5_000)]],
    ['cumulative pixels', Array.from({ length: 5 }, () => page(6_000, 5_000))],
  ])('rejects the %s limit before allocating RGBA buffers', async (_name, pages) => {
    expect(() => validateTiffPageSafety(pages)).toThrow('safety limit')
    expect(target.textContent).toBe('unchanged')
  })

  it('releases decoded page data and Object URLs when unmounted', async () => {
    const window = target.ownerDocument.defaultView!
    const ifds = [
      { ...page(2, 2), data: new Uint8Array([1]) },
      { ...page(2, 2), pixels: new Uint8Array([2]) },
    ]
    const decoder = {
      decode: vi.fn(() => ifds),
      decodeImage: vi.fn(),
      toRGBA8: vi.fn(() => new Uint8Array(16)),
    }
    const created: string[] = []
    const revoked: string[] = []
    Object.defineProperties(window.URL, {
      createObjectURL: {
        configurable: true,
        value: vi.fn(() => {
          const value = `blob:tiff-page-${created.length + 1}`
          created.push(value)
          return value
        }),
      },
      revokeObjectURL: {
        configurable: true,
        value: vi.fn((value: string) => revoked.push(value)),
      },
    })
    Object.defineProperties(window.HTMLImageElement.prototype, {
      complete: { configurable: true, get: () => true },
      naturalHeight: { configurable: true, get: () => 2 },
      naturalWidth: { configurable: true, get: () => 2 },
    })
    window.requestAnimationFrame = callback => {
      callback(0)
      return 1
    }
    window.cancelAnimationFrame = vi.fn()
    Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => ({
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData: vi.fn(),
      }),
    })
    Object.defineProperty(window.HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      value: (callback: (blob: Blob) => void) => callback(new window.Blob(['png'], { type: 'image/png' })),
    })
    const ResizeObserverStub = class {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)

    const session = await renderTiffWithDecoder(new ArrayBuffer(8), target, decoder)
    expect(target.querySelectorAll('.tiff-frame')).toHaveLength(2)
    expect(ifds).toHaveLength(0)
    expect(created).toEqual(['blob:tiff-page-1', 'blob:tiff-page-2'])
    session.unmount?.()
    expect(revoked).toEqual(created)
    expect(target.childElementCount).toBe(0)
    vi.unstubAllGlobals()
  })

  it('keeps the MIT decoder behind the TIFF-only dynamic boundary', () => {
    const imageDist = readFileSync(join(process.cwd(), 'packages/renderers/image/dist/image.js'), 'utf8')
    const tiffDist = readFileSync(join(process.cwd(), 'packages/renderers/image/dist/tiff.js'), 'utf8')
    const utifPackage = JSON.parse(readFileSync(require.resolve('utif/package.json'), 'utf8'))
    expect(imageDist).toContain("import('./tiff.js')")
    expect(imageDist).not.toContain("import('utif')")
    expect(tiffDist).toContain("import('utif')")
    expect(utifPackage.license).toBe('MIT')
  })

  it('does not send a browser-decodable image with a misleading TIFF extension to UTIF', () => {
    const pngNamedTif = readFileSync(join(process.cwd(), 'apps/viewer-demo/public/example/pic.tif'))
    const originalTiff = readFileSync(join(process.cwd(), 'apps/viewer-demo/public/example/multipage-ccitt-g4.tif'))
    expect(hasTiffSignature(pngNamedTif.buffer.slice(pngNamedTif.byteOffset, pngNamedTif.byteOffset + pngNamedTif.byteLength))).toBe(false)
    expect(hasTiffSignature(originalTiff.buffer.slice(originalTiff.byteOffset, originalTiff.byteOffset + originalTiff.byteLength))).toBe(true)
  })
})
