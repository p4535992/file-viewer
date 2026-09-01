import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import {
  formatFileViewerTextForDisplay,
  renderFileViewerCode,
  resolveFileViewerPrettyPrintOptions
} from '../dist/index.js'

const encoder = new TextEncoder()

const toBuffer = value => {
  const bytes = encoder.encode(value)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

const waitFor = async (predicate, message, timeoutMs = 1500) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = predicate()
    if (value) {
      return value
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(message)
}

const withDom = async callback => {
  const dom = new JSDOM('<!doctype html><body><div id="target"></div></body>', {
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    url: 'https://example.test/'
  })
  const keys = [
    'window',
    'document',
    'Node',
    'Element',
    'HTMLElement',
    'HTMLDivElement',
    'DocumentFragment',
    'CustomEvent',
    'Event',
    'MutationObserver',
    'getComputedStyle'
  ]
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of keys) {
    const value = key === 'getComputedStyle'
      ? dom.window.getComputedStyle.bind(dom.window)
      : dom.window[key]
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value
    })
  }
  try {
    return await callback(dom, dom.window.document.querySelector('#target'))
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor)
      } else {
        delete globalThis[key]
      }
    }
    dom.window.close()
  }
}

test('pretty-print options use MIME, extension, then global precedence', () => {
  const context = {
    sourceFile: { type: 'application/ld+json; charset=utf-8' },
    options: {
      text: {
        prettyPrintOptions: {
          tabWidth: 2,
          useTabs: false,
          printWidth: 100,
          proseWrap: 'preserve',
          byExtension: {
            '*.JSON': {
              tabWidth: 4,
              printWidth: 80
            }
          },
          byMimeType: {
            'APPLICATION/LD+JSON': {
              tabWidth: 6,
              useTabs: true,
              printWidth: 60,
              proseWrap: 'always'
            }
          }
        }
      }
    }
  }

  assert.deepEqual(
    resolveFileViewerPrettyPrintOptions('json', 'payload.json', context),
    {
      tabWidth: 6,
      useTabs: true,
      printWidth: 60,
      proseWrap: 'always'
    }
  )
})

test('Prettier receives custom indentation and print width without changing source bytes', async () => {
  const source = '{"outer":{"inner":1,"description":"a readable value that gives Prettier a reason to break the object"}}'
  const buffer = toBuffer(source)
  const before = Array.from(new Uint8Array(buffer))
  const result = await formatFileViewerTextForDisplay({
    source,
    sourceByteLength: buffer.byteLength,
    extension: 'json',
    filename: 'payload.json',
    context: {
      sourceFile: { type: 'application/vnd.example+json' },
      options: {
        text: {
          prettyPrint: true,
          prettyPrintMaxBytes: buffer.byteLength,
          prettyPrintOptions: {
            tabWidth: 2,
            useTabs: false,
            printWidth: 120,
            byExtension: {
              json: { tabWidth: 4, printWidth: 80 }
            },
            byMimeType: {
              'application/vnd.example+json': {
                useTabs: true,
                printWidth: 40
              }
            }
          }
        }
      }
    }
  })

  assert.equal(result.formatted, true)
  assert.match(result.text, /^\t"outer"/m)
  assert.ok(result.text.trim().split('\n').length > 4)
  assert.deepEqual(JSON.parse(result.text), JSON.parse(source))
  assert.deepEqual(Array.from(new Uint8Array(buffer)), before)
})

test('Markdown proseWrap always reflows prose according to printWidth', async () => {
  const source = 'This paragraph contains enough ordinary words to demonstrate configurable prose wrapping in the formatted Markdown representation.'
  const result = await formatFileViewerTextForDisplay({
    source,
    sourceByteLength: encoder.encode(source).byteLength,
    extension: 'md',
    filename: 'notes.md',
    context: {
      options: {
        text: {
          prettyPrint: true,
          prettyPrintMaxBytes: 4096,
          prettyPrintOptions: {
            printWidth: 32,
            proseWrap: 'always'
          }
        }
      }
    }
  })

  assert.equal(result.formatted, true)
  assert.ok(result.text.trim().split('\n').length >= 4)
  assert.equal(result.text.replace(/\s+/g, ' ').trim(), source)
})

test('regular pretty preview toggles wrapping in place without rebuilding the formatted representation', async () => {
  await withDom(async (_dom, target) => {
    const source = '{"outer":{"description":"long-value-long-value-long-value-long-value"},"second":true}'
    const buffer = toBuffer(source)
    const before = Array.from(new Uint8Array(buffer))
    const instance = await renderFileViewerCode(buffer, target, 'json', {
      filename: 'payload.json',
      options: {
        locale: 'en-US',
        text: {
          toolbar: false,
          lineNumbers: true,
          prettyPrint: true,
          prettyPrintMaxBytes: buffer.byteLength,
          prettyPrintOptions: {
            printWidth: 40
          },
          wrapLongLines: false,
          wrapLongLinesToggle: true,
          virtualizeAboveBytes: 1024 * 1024
        }
      }
    })

    const initialRoot = target.querySelector('.code-viewer')
    const initialToggle = target.querySelector('.code-wrap-toggle')
    assert.ok(initialRoot)
    assert.ok(initialToggle)
    assert.equal(initialRoot.dataset.prettyPrinted, 'true')
    assert.equal(initialRoot.dataset.representation, 'formatted')
    assert.equal(initialRoot.dataset.wrapLongLines, 'false')
    const formattedText = initialRoot.querySelector('code')?.textContent
    assert.match(formattedText || '', /\n/)

    initialToggle.click()
    assert.strictEqual(target.querySelector('.code-viewer'), initialRoot)
    assert.equal(initialRoot.dataset.wrapLongLines, 'true')
    assert.equal(initialRoot.dataset.representation, 'formatted')
    assert.equal(target.querySelector('.code-wrap-toggle')?.getAttribute('aria-pressed'), 'true')
    assert.ok(initialRoot.querySelector('.code-area--wrapped-line-numbers'))
    assert.equal(initialRoot.querySelector('code')?.textContent, formattedText)

    target.querySelector('.code-wrap-toggle').click()
    assert.strictEqual(target.querySelector('.code-viewer'), initialRoot)
    assert.equal(initialRoot.dataset.wrapLongLines, 'false')
    assert.ok(initialRoot.querySelector('.code-area--line-numbers'))
    assert.equal(initialRoot.querySelector('code')?.textContent, formattedText)
    assert.deepEqual(Array.from(new Uint8Array(buffer)), before)
    await instance.unmount()
  })
})

test('virtual preview toggles between bounded fixed and wrapped renderers', async () => {
  await withDom(async (_dom, target) => {
    const source = `${'wide '.repeat(200)}\nsecond\nthird`
    const instance = await renderFileViewerCode(toBuffer(source), target, 'log', {
      options: {
        locale: 'en-US',
        text: {
          toolbar: false,
          lineNumbers: true,
          prettyPrint: false,
          wrapLongLines: false,
          wrapLongLinesToggle: true,
          virtualizeAboveBytes: 1,
          virtualOverscanLines: 2
        }
      }
    })

    assert.ok(target.querySelector('.code-viewer--virtual'))
    assert.equal(target.querySelector('.code-viewer')?.dataset.wrapLongLines, 'false')
    target.querySelector('.code-wrap-toggle').click()

    const wrappedRoot = await waitFor(
      () => target.querySelector('.code-viewer--wrapped-virtual'),
      'wrapped virtual renderer was not mounted'
    )
    assert.equal(wrappedRoot.dataset.wrapLongLines, 'true')
    assert.equal(target.querySelector('.code-wrap-toggle')?.getAttribute('aria-pressed'), 'true')

    target.querySelector('.code-wrap-toggle').click()
    const fixedRoot = await waitFor(
      () => {
        const root = target.querySelector('.code-viewer--virtual')
        return root && !root.classList.contains('code-viewer--wrapped-virtual') ? root : null
      },
      'fixed-height virtual renderer was not restored'
    )
    assert.equal(fixedRoot.dataset.wrapLongLines, 'false')
    assert.equal(target.querySelector('.code-wrap-toggle')?.getAttribute('aria-pressed'), 'false')
    await instance.unmount()
  })
})
