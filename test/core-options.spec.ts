import { describe, expect, it, vi } from 'vitest'
import {
  getFileViewerOptionsSearchParam,
  normalizeFileViewerUiDensity,
  normalizeFileViewerTheme,
  parseFileViewerOptions,
  resolveFileViewerColorScheme,
  sanitizeFileViewerOptions,
  serializeFileViewerOptions,
  setFileViewerOptionsSearchParam,
  toggleFileViewerColorScheme
} from '../packages/core/src'

describe('@file-viewer/core option serialization helpers', () => {
  it('preserves opt-in image panning through JSON and URL options', () => {
    for (const handTool of [true, false]) {
      const options = { image: { handTool, rotation: false } }
      expect(parseFileViewerOptions(serializeFileViewerOptions(options)!)).toEqual(options)
      const params = new URLSearchParams()
      setFileViewerOptionsSearchParam(params, options)
      expect(getFileViewerOptionsSearchParam(params)).toEqual(options)
    }
  })
  it('preserves the opt-in Excel viewport option through public JSON and URL parameters', () => {
    const options = { spreadsheet: { fillViewport: true, worker: false as const } }
    expect(parseFileViewerOptions(serializeFileViewerOptions(options)!)).toEqual(options)
    const params = new URLSearchParams()
    setFileViewerOptionsSearchParam(params, options)
    expect(getFileViewerOptionsSearchParam(params)).toEqual(options)
    expect(parseFileViewerOptions(serializeFileViewerOptions({ spreadsheet: { fillViewport: false } })!))
      .toEqual({ spreadsheet: { fillViewport: false } })
  })
  it('preserves declarative XML profiles but never serializes diagnostic callbacks', () => {
    const xml = {
      profiles: [{
        id: 'invoice',
        match: { rootNamespace: { enabled: true, root: 'invoice', namespace: 'urn:invoice' } },
        xslt: './invoice.xsl'
      }],
      baseUrl: '/profiles/',
      timeoutMs: 3000,
      onDiagnostic: vi.fn()
    }
    expect(parseFileViewerOptions(serializeFileViewerOptions({ xml })!)?.xml).toEqual({
      profiles: xml.profiles,
      baseUrl: '/profiles/',
      timeoutMs: 3000
    })
  })

  it('normalizes viewer theme options for every wrapper', () => {
    expect(normalizeFileViewerTheme('light')).toBe('light')
    expect(normalizeFileViewerTheme('dark')).toBe('dark')
    expect(normalizeFileViewerTheme('system')).toBe('system')
    expect(normalizeFileViewerTheme(undefined)).toBe('system')
    expect(resolveFileViewerColorScheme('system', false)).toBe('light')
    expect(resolveFileViewerColorScheme('system', true)).toBe('dark')
    expect(toggleFileViewerColorScheme('light')).toBe('dark')
    expect(toggleFileViewerColorScheme('dark')).toBe('light')
    expect(toggleFileViewerColorScheme('system', true)).toBe('light')
    expect(normalizeFileViewerUiDensity('compact')).toBe('compact')
    expect(normalizeFileViewerUiDensity('comfortable')).toBe('comfortable')
    expect(normalizeFileViewerUiDensity(undefined)).toBe('comfortable')
  })

  it('serializes execution-safe options without hook-only hooks', () => {
    const serialized = serializeFileViewerOptions({
      theme: 'light',
      styleIsolation: 'shadow',
      ui: {
        density: 'compact',
        surfaceBackground: 'transparent'
      },
      toolbar: {
        print: true,
        theme: false,
        position: 'bottom-right',
        order: ['zoom', 'search', 'download', 'print', 'theme'],
        beforePrint: vi.fn()
      },
      fit: {
        mode: 'width',
        resize: 'until-interaction',
        padding: 12
      },
      archive: {
        workerUrl: '/viewer/vendor/libarchive/worker-bundle.js',
        cache: true,
        entryActions: {
          download: false
        }
      },
      cad: {
        workerUrl: new URL('https://viewer.example.com/cad-worker.js'),
        dxfEncoding: 'gbk'
      },
      rendererMode: 'replace',
      renderers: {
        id: 'runtime-only-renderer',
        definitions: [],
      },
      hooks: {
        onLoadStart: vi.fn()
      },
      beforeOperation: vi.fn()
    })

    expect(serialized).toBeTruthy()
    const options = JSON.parse(serialized || '{}')
    expect(options.theme).toBe('light')
    expect(options.styleIsolation).toBe('shadow')
    expect(options.ui).toEqual({
      density: 'compact',
      surfaceBackground: 'transparent'
    })
    expect(options.toolbar).toEqual({
      print: true,
      theme: false,
      position: 'bottom-right',
      order: ['zoom', 'search', 'download', 'print', 'theme']
    })
    expect(options.fit).toEqual({
      mode: 'width',
      resize: 'until-interaction',
      padding: 12
    })
    expect(options.archive.cache).toBe(true)
    expect(options.archive.entryActions.download).toBe(false)
    expect(options.cad.workerUrl).toBe('https://viewer.example.com/cad-worker.js')
    expect(options.rendererMode).toBeUndefined()
    expect(options.renderers).toBeUndefined()
    expect(options.hooks).toBeUndefined()
    expect(options.beforeOperation).toBeUndefined()
  })

  it('parses query options through the same sanitizer', () => {
    expect(parseFileViewerOptions('{bad json')).toBeUndefined()
    expect(parseFileViewerOptions(JSON.stringify({
      watermark: {
        text: '内部预览',
        opacity: 0.12
      },
      toolbar: {
        download: false
      }
    }))).toEqual({
      watermark: {
        text: '内部预览',
        opacity: 0.12
      },
      toolbar: {
        download: false
      }
    })
  })

  it('can write and read options from URLSearchParams', () => {
    const params = new URLSearchParams()
    setFileViewerOptionsSearchParam(params, {
      pdf: {
        toolbar: false,
        streaming: 'same-origin'
      }
    })

    expect(params.has('options')).toBe(true)
    expect(getFileViewerOptionsSearchParam(params)).toEqual({
      pdf: {
        toolbar: false,
        streaming: 'same-origin'
      }
    })

    setFileViewerOptionsSearchParam(params, null)
    expect(params.has('options')).toBe(false)
  })

  it('returns undefined for empty or hook-only option objects', () => {
    expect(sanitizeFileViewerOptions(undefined)).toBeUndefined()
    expect(sanitizeFileViewerOptions({
      hooks: {
        onLoadComplete: vi.fn()
      },
      beforeOperation: vi.fn()
    })).toBeUndefined()
  })
})
