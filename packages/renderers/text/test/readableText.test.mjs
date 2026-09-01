import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import {
  formatFileViewerTextForDisplay,
  renderFileViewerCode,
  resolveFileViewerPrettyPrintMaxBytes,
  shouldAttemptFileViewerPrettyPrint
} from '../dist/index.js'

const encoder = new TextEncoder()

const toBuffer = value => {
  const bytes = encoder.encode(value)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
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

test('pretty-print threshold is inclusive and defaults to the virtualization threshold', () => {
  const context = {
    options: {
      text: {
        prettyPrint: true,
        virtualizeAboveBytes: 32
      }
    }
  }
  assert.equal(resolveFileViewerPrettyPrintMaxBytes(context), 32)
  assert.equal(shouldAttemptFileViewerPrettyPrint(31, 'json', context), true)
  assert.equal(shouldAttemptFileViewerPrettyPrint(32, 'json', context), true)
  assert.equal(shouldAttemptFileViewerPrettyPrint(33, 'json', context), false)
  assert.equal(shouldAttemptFileViewerPrettyPrint(1, 'txt', context), false)
  assert.equal(
    shouldAttemptFileViewerPrettyPrint(1, 'json', {
      options: { text: { prettyPrint: false, prettyPrintMaxBytes: 32 } }
    }),
    false
  )
})

test('Prettier formats supported JSON and falls back for malformed input', async () => {
  const source = '{"user":{"id":1,"roles":["reader","editor"]},"active":true}'
  const context = {
    options: {
      text: {
        prettyPrint: true,
        prettyPrintMaxBytes: encoder.encode(source).byteLength
      }
    }
  }
  const formatted = await formatFileViewerTextForDisplay({
    source,
    sourceByteLength: encoder.encode(source).byteLength,
    extension: 'json',
    context
  })
  assert.equal(formatted.formatted, true)
  assert.match(formatted.text, /\n\s+"user"/)
  assert.deepEqual(JSON.parse(formatted.text), JSON.parse(source))

  const malformed = '{"user":}'
  const fallback = await formatFileViewerTextForDisplay({
    source: malformed,
    sourceByteLength: encoder.encode(malformed).byteLength,
    extension: 'json',
    context: {
      options: { text: { prettyPrint: true, prettyPrintMaxBytes: 1024 } }
    }
  })
  assert.deepEqual(fallback, { text: malformed, formatted: false })
})

test('XML formatting is conservative for mixed content and xml:space', async () => {
  const mixed = '<catalog><item><name>Example</name><p>Hello <b>world</b>!</p></item></catalog>'
  const context = {
    options: { text: { prettyPrint: true, prettyPrintMaxBytes: 4096 } }
  }
  const formatted = await formatFileViewerTextForDisplay({
    source: mixed,
    sourceByteLength: encoder.encode(mixed).byteLength,
    extension: 'xml',
    context
  })
  assert.equal(formatted.formatted, true)
  assert.match(formatted.text, /<catalog>[\s\S]*<item>/)
  assert.equal(formatted.text.includes('Hello'), true)
  assert.equal(formatted.text.includes('world'), true)

  const preserved = '<root xml:space="preserve"><value>  keep   this  </value></root>'
  const fallback = await formatFileViewerTextForDisplay({
    source: preserved,
    sourceByteLength: encoder.encode(preserved).byteLength,
    extension: 'xml',
    context
  })
  assert.deepEqual(fallback, { text: preserved, formatted: false })
})

test('regular wrapped text keeps one visible line number per logical line', async () => {
  await withDom(async (_dom, target) => {
    const source = `${'long-value-'.repeat(40)}\nsecond line`
    const instance = await renderFileViewerCode(
      toBuffer(source),
      target,
      'txt',
      {
        options: {
          text: {
            toolbar: false,
            lineNumbers: true,
            wrapLongLines: true,
            virtualizeAboveBytes: 1024 * 1024
          }
        }
      }
    )
    const root = target.querySelector('.code-viewer')
    assert.equal(root?.dataset.wrapLongLines, 'true')
    assert.ok(target.querySelector('.code-area--wrapped-line-numbers'))
    const lines = [...target.querySelectorAll('.code-line')]
    assert.equal(lines.length, 2)
    assert.equal(lines[0].dataset.lineNumber, '1')
    assert.equal(lines[1].dataset.lineNumber, '2')
    assert.equal(lines[0].textContent, 'long-value-'.repeat(40))
    assert.equal(lines[1].textContent, 'second line')
    instance.unmount()
  })
})

test('pretty representation is labelled, toggleable, escaped, and leaves bytes unchanged', async () => {
  await withDom(async (dom, target) => {
    const source = '<main><script>window.__readableTextSentinel=1</script><p>safe</p></main>'
    const buffer = toBuffer(source)
    const before = Array.from(new Uint8Array(buffer))
    dom.window.__readableTextSentinel = 0
    const instance = await renderFileViewerCode(
      buffer,
      target,
      'html',
      {
        options: {
          text: {
            lineNumbers: true,
            prettyPrint: true,
            prettyPrintMaxBytes: buffer.byteLength,
            wrapLongLines: true
          }
        }
      }
    )
    const root = target.querySelector('.code-viewer')
    assert.equal(root?.dataset.prettyPrinted, 'true')
    assert.equal(root?.dataset.representation, 'formatted')
    assert.equal(dom.window.__readableTextSentinel, 0)
    assert.equal(target.querySelector('script'), null)
    assert.match(target.querySelector('code')?.textContent || '', /<script>/)
    assert.deepEqual(Array.from(new Uint8Array(buffer)), before)

    const toggle = target.querySelector('.code-representation-toggle')
    assert.ok(toggle)
    toggle.click()
    assert.equal(root?.dataset.representation, 'source')
    assert.equal(target.querySelectorAll('.code-line').length, 1)
    assert.equal(target.querySelector('code')?.textContent, source)
    assert.deepEqual(Array.from(new Uint8Array(buffer)), before)
    instance.unmount()
  })
})

test('wrapped files above the normal threshold use bounded variable-height rows', async () => {
  await withDom(async (_dom, target) => {
    const source = `${'wide '.repeat(200)}\nsecond\nthird`
    const instance = await renderFileViewerCode(
      toBuffer(source),
      target,
      'log',
      {
        options: {
          text: {
            toolbar: false,
            lineNumbers: true,
            prettyPrint: false,
            wrapLongLines: true,
            virtualizeAboveBytes: 1,
            virtualOverscanLines: 2
          }
        }
      }
    )
    const root = target.querySelector('.code-viewer--wrapped-virtual')
    assert.ok(root)
    assert.equal(root.dataset.totalLines, '3')
    assert.equal(root.dataset.wrapLongLines, 'true')
    const renderedRows = [...target.querySelectorAll('.code-virtual-line')]
    assert.ok(renderedRows.length >= 3)
    assert.equal(renderedRows[0].dataset.line, '1')
    assert.match(renderedRows[0].querySelector('.code-virtual-content')?.textContent || '', /^wide /)
    instance.unmount()
  })
})
