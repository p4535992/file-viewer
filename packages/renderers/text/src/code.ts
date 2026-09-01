import {
  createFileViewerZoomChangeEmitter as createZoomChangeEmitter,
  decodeFileViewerTextBuffer,
  registerFileViewerZoomProvider,
  unregisterFileViewerZoomProvider,
  type FileRenderContext,
  type FileViewerRenderedInstance,
  type FileViewerZoomState
} from '@file-viewer/core'
import type { HLJSApi, LanguageFn } from 'highlight.js'
import { codeStyle } from './codeStyle.js'
import renderLargeText, { shouldVirtualizeTextBuffer } from './largeText.js'
import {
  formatFileViewerTextForDisplay,
  shouldAttemptFileViewerPrettyPrint
} from './prettyPrint.js'
import {
  createFileViewerWrapToggleButton,
  renderFileViewerVirtualTextWithWrapToggle,
  updateFileViewerWrapToggleButton
} from './wrapToggle.js'

const languageMap: Record<string, string> = {
  bash: 'bash',
  c: 'cpp',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  diff: 'diff',
  patch: 'diff',
  bundle: 'plaintext',
  bdl: 'plaintext',
  gv: 'plaintext',
  go: 'go',
  h: 'cpp',
  hcl: 'plaintext',
  hpp: 'cpp',
  html: 'xml',
  htm: 'xml',
  http: 'http',
  ini: 'ini',
  ipynb: 'json',
  java: 'java',
  js: 'javascript',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  log: 'plaintext',
  md: 'markdown',
  markdown: 'markdown',
  mjs: 'javascript',
  php: 'php',
  proto: 'protobuf',
  py: 'python',
  rb: 'ruby',
  react: 'javascript',
  rs: 'rust',
  sh: 'bash',
  sql: 'sql',
  swift: 'swift',
  tex: 'latex',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'plaintext',
  vue: 'xml',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml'
}

const languageLoaders: Record<string, () => Promise<{ default: LanguageFn }>> = {
  bash: () => import('highlight.js/lib/languages/bash'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  css: () => import('highlight.js/lib/languages/css'),
  diff: () => import('highlight.js/lib/languages/diff'),
  go: () => import('highlight.js/lib/languages/go'),
  http: () => import('highlight.js/lib/languages/http'),
  ini: () => import('highlight.js/lib/languages/ini'),
  java: () => import('highlight.js/lib/languages/java'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  latex: () => import('highlight.js/lib/languages/latex'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  php: () => import('highlight.js/lib/languages/php'),
  protobuf: () => import('highlight.js/lib/languages/protobuf'),
  python: () => import('highlight.js/lib/languages/python'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml')
}

let highlighterPromise: Promise<HLJSApi> | null = null
const registeredLanguages = new Set<string>()

const createElement = <TagName extends keyof HTMLElementTagNameMap>(
  documentRef: Document,
  tagName: TagName,
  className?: string,
  text?: string
) => {
  const element = documentRef.createElement(tagName)
  if (className) {
    element.className = className
  }
  if (typeof text === 'string') {
    element.textContent = text
  }
  return element
}

const createStyle = (documentRef: Document) => {
  const style = documentRef.createElement('style')
  style.textContent = codeStyle
  return style
}

const resolveLanguage = (type: string) => {
  return languageMap[type.trim().toLowerCase()] || 'plaintext'
}

const escapeHtml = (value: string) => {
  return value.replace(/[&<>"']/g, char => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return entities[char]
  })
}

const loadHighlighter = async () => {
  if (!highlighterPromise) {
    highlighterPromise = import('highlight.js/lib/core').then(module => module.default)
  }
  return highlighterPromise
}

const registerLanguageOnce = async (hljs: HLJSApi, name: string) => {
  if (registeredLanguages.has(name)) {
    return true
  }
  const loader = languageLoaders[name]
  if (!loader) {
    return false
  }
  const { default: language } = await loader()
  hljs.registerLanguage(name, language)
  registeredLanguages.add(name)
  return true
}

const clampZoom = (value: number) => {
  return Math.min(2.6, Math.max(0.6, Number(value.toFixed(2))))
}

const lineCountOf = (value: string) => {
  return value.split(/\r\n|\r|\n/).length
}

const createLineNumberText = (lineCount: number) => {
  return Array.from({ length: lineCount }, (_, index) => String(index + 1)).join('\n')
}

const createHighlightedLineRows = (documentRef: Document, highlightedHtml: string) => {
  const template = documentRef.createElement('template')
  template.innerHTML = highlightedHtml
  const lineFragments: DocumentFragment[] = [documentRef.createDocumentFragment()]
  const sourceStack: Element[] = []
  let targetStack: Node[] = [lineFragments[0]]

  const currentTarget = () => targetStack[targetStack.length - 1]

  const startNewLine = () => {
    const fragment = documentRef.createDocumentFragment()
    lineFragments.push(fragment)
    targetStack = [fragment]
    for (const sourceElement of sourceStack) {
      const clone = sourceElement.cloneNode(false) as Element
      currentTarget().appendChild(clone)
      targetStack.push(clone)
    }
  }

  const appendText = (value: string) => {
    let start = 0
    const lineBreaks = /\r\n|\r|\n/g
    let match: RegExpExecArray | null
    while ((match = lineBreaks.exec(value))) {
      currentTarget().appendChild(documentRef.createTextNode(value.slice(start, match.index)))
      start = match.index + match[0].length
      startNewLine()
    }
    currentTarget().appendChild(documentRef.createTextNode(value.slice(start)))
  }

  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      appendText(node.nodeValue || '')
      return
    }
    if (node.nodeType === 1) {
      const sourceElement = node as Element
      const clone = sourceElement.cloneNode(false) as Element
      currentTarget().appendChild(clone)
      sourceStack.push(sourceElement)
      targetStack.push(clone)
      for (const child of Array.from(sourceElement.childNodes)) {
        visit(child)
      }
      sourceStack.pop()
      targetStack.pop()
      return
    }
    currentTarget().appendChild(node.cloneNode(true))
  }

  for (const node of Array.from(template.content.childNodes)) {
    visit(node)
  }

  const fragment = documentRef.createDocumentFragment()
  lineFragments.forEach((line, index) => {
    const row = documentRef.createElement('span')
    row.className = 'code-line'
    row.dataset.lineNumber = String(index + 1)
    const content = documentRef.createElement('span')
    content.className = 'code-line-content'
    content.append(line)
    row.append(content)
    fragment.append(row)
  })
  return fragment
}

/**
 * Framework-neutral text/code renderer.
 *
 * highlight.js core and language definitions are loaded lazily by format. HTML
 * and XML are highlighted as escaped source text, never executed as real DOM.
 * Optional Prettier formatting changes only the displayed string; the original
 * ArrayBuffer remains the source used by download operations.
 * @param buffer 文本二进制内容
 * @param target 目标
 * @param type 文件扩展名，用于选择 highlight.js 语言
 */
export default async function renderText(
  buffer: ArrayBuffer,
  target: HTMLDivElement,
  type?: string,
  context?: FileRenderContext
): Promise<FileViewerRenderedInstance> {
  const documentRef = target.ownerDocument
  const extension = type || 'txt'
  const normalizedExtension = extension.trim().toLowerCase()
  const initialWrapLongLines = context?.options?.text?.wrapLongLines === true
  const virtualized = normalizedExtension !== 'bundle' &&
    normalizedExtension !== 'bdl' &&
    shouldVirtualizeTextBuffer(buffer, context)

  const renderVirtualized = async () => {
    if (context?.options?.text?.wrapLongLinesToggle === true) {
      return renderFileViewerVirtualTextWithWrapToggle(
        buffer,
        target,
        extension,
        context
      )
    }
    if (initialWrapLongLines) {
      const { default: renderWrappedLargeText } = await import('./wrappedLargeText.js')
      return renderWrappedLargeText(buffer, target, extension, context)
    }
    return renderLargeText(buffer, target, extension, context)
  }

  if (normalizedExtension === 'bundle' || normalizedExtension === 'bdl') {
    const { default: renderGitBundle } = await import('./gitBundle.js')
    return renderGitBundle(buffer, target, extension, context)
  }
  if (normalizedExtension === 'patch') {
    if (virtualized) {
      return renderVirtualized()
    }
    const { default: renderPatch } = await import('./patch.js')
    return renderPatch(buffer, target, extension, context)
  }

  const prettyPrintFilename = context?.filename ||
    `preview.${normalizedExtension || 'txt'}`
  const prettyPrintEligible = shouldAttemptFileViewerPrettyPrint(
    buffer.byteLength,
    normalizedExtension,
    context,
    prettyPrintFilename
  )
  if (virtualized && !prettyPrintEligible) {
    return renderVirtualized()
  }

  const originalText = decodeFileViewerTextBuffer(
    buffer,
    context?.options?.text?.encoding
  ).text
  const prettyPrintResult = prettyPrintEligible
    ? await formatFileViewerTextForDisplay({
        source: originalText,
        sourceByteLength: buffer.byteLength,
        extension: normalizedExtension,
        filename: prettyPrintFilename,
        context
      })
    : { text: originalText, formatted: false as const }

  if (virtualized && !prettyPrintResult.formatted) {
    return renderVirtualized()
  }

  const formattedText = prettyPrintResult.text
  const language = resolveLanguage(extension)
  const showToolbar = context?.options?.text?.toolbar !== false
  const showLineNumbers = context?.options?.text?.lineNumbers === true
  let disposed = false
  let zoom = 1
  let highlightedGeneration = 0
  let showingFormatted = prettyPrintResult.formatted
  let wrapLongLines = initialWrapLongLines
  let currentText = ''
  let currentHtml = ''
  const zoomEmitter = createZoomChangeEmitter()
  const root = createElement(documentRef, 'div', 'code-viewer')
  root.dataset.viewerZoomProvider = 'code'
  root.dataset.textToolbar = String(showToolbar)
  root.dataset.lineNumbers = String(showLineNumbers)
  root.dataset.prettyPrinted = String(prettyPrintResult.formatted)
  if (prettyPrintResult.parser) {
    root.dataset.prettyPrintParser = prettyPrintResult.parser
  }

  const toolbar = createElement(documentRef, 'div', 'code-toolbar')
  const extensionLabel = createElement(documentRef, 'span', '', extension.toUpperCase())
  const toolbarMeta = createElement(documentRef, 'div', 'code-toolbar-meta')
  const lineSummary = createElement(documentRef, 'strong')
  toolbar.append(extensionLabel, toolbarMeta)

  const pre = createElement(documentRef, 'pre', 'code-area')
  const code = createElement(documentRef, 'code', `hljs language-${language}`)
  pre.append(code)

  const applyRootWrapState = () => {
    root.classList.toggle('code-viewer--wrap-long-lines', wrapLongLines)
    root.dataset.wrapLongLines = String(wrapLongLines)
  }

  const mountCodeHtml = (html: string, text: string) => {
    const lineCount = lineCountOf(text)
    lineSummary.textContent = `${lineCount} lines`
    root.style.setProperty('--code-line-number-width', `${Math.max(5, String(lineCount).length + 2)}ch`)
    code.className = `hljs language-${language}`
    pre.replaceChildren()

    if (wrapLongLines && showLineNumbers) {
      pre.className = 'code-area code-area--wrapped-line-numbers'
      code.classList.add('code-lines')
      code.replaceChildren(createHighlightedLineRows(documentRef, html))
      pre.append(code)
      return
    }

    pre.className = wrapLongLines
      ? 'code-area code-area--wrap-long-lines'
      : showLineNumbers
        ? 'code-area code-area--line-numbers'
        : 'code-area'
    code.innerHTML = html
    if (showLineNumbers) {
      const gutter = createElement(
        documentRef,
        'span',
        'code-line-numbers',
        createLineNumberText(lineCount)
      )
      gutter.setAttribute('aria-hidden', 'true')
      pre.append(gutter)
    }
    pre.append(code)
  }

  const mountCurrentCode = () => {
    mountCodeHtml(currentHtml, currentText)
  }

  const representationToggle = prettyPrintResult.formatted
    ? createElement(documentRef, 'button', 'code-representation-toggle')
    : null
  if (representationToggle) {
    representationToggle.type = 'button'
  }

  let wrapToggle: HTMLButtonElement | null = null
  if (context?.options?.text?.wrapLongLinesToggle === true) {
    wrapToggle = createFileViewerWrapToggleButton(
      documentRef,
      wrapLongLines,
      context,
      () => {
        wrapLongLines = !wrapLongLines
        applyRootWrapState()
        if (wrapToggle) {
          updateFileViewerWrapToggleButton(wrapToggle, wrapLongLines, context)
        }
        mountCurrentCode()
      }
    )
  }

  if (representationToggle) {
    toolbarMeta.append(representationToggle)
  }
  if (wrapToggle) {
    toolbarMeta.append(wrapToggle)
  }
  toolbarMeta.append(lineSummary)

  if (showToolbar) {
    root.append(toolbar)
  } else if (representationToggle || wrapToggle) {
    const floatingControls = createElement(
      documentRef,
      'div',
      'code-representation-floating'
    )
    if (representationToggle) {
      floatingControls.append(representationToggle)
    }
    if (wrapToggle) {
      floatingControls.append(wrapToggle)
    }
    root.append(floatingControls)
  }
  root.append(pre)
  root.style.setProperty('--code-font-size', `${13 * zoom}px`)
  applyRootWrapState()
  target.replaceChildren(createStyle(documentRef), root)

  const renderRepresentation = () => {
    const text = showingFormatted ? formattedText : originalText
    const generation = highlightedGeneration + 1
    highlightedGeneration = generation
    root.dataset.representation = showingFormatted ? 'formatted' : 'source'
    if (representationToggle) {
      representationToggle.textContent = showingFormatted ? 'Formatted' : 'Source'
      representationToggle.title = showingFormatted
        ? 'Show original source'
        : 'Show formatted representation'
      representationToggle.setAttribute('aria-label', representationToggle.title)
      representationToggle.setAttribute('aria-pressed', String(showingFormatted))
    }

    currentText = text
    currentHtml = escapeHtml(text)
    mountCurrentCode()
    if (language === 'plaintext') {
      return
    }

    void (async () => {
      try {
        const hljs = await loadHighlighter()
        const hasLanguage = await registerLanguageOnce(hljs, language)
        if (disposed || generation !== highlightedGeneration) {
          return
        }
        currentHtml = hasLanguage
          ? hljs.highlight(text, { language, ignoreIllegals: true }).value
          : escapeHtml(text)
        mountCurrentCode()
      } catch {
        // The escaped source is already mounted. Highlighting failures remain
        // non-fatal and never replace it with executable markup.
      }
    })()
  }

  representationToggle?.addEventListener('click', () => {
    showingFormatted = !showingFormatted
    renderRepresentation()
  })
  renderRepresentation()

  const getZoomState = (): FileViewerZoomState => ({
    scale: zoom,
    label: `${Math.round(zoom * 100)}%`,
    canZoomIn: zoom < 2.6,
    canZoomOut: zoom > 0.6,
    canReset: zoom !== 1,
    minScale: 0.6,
    maxScale: 2.6
  })

  const setZoom = (scale: number) => {
    zoom = clampZoom(scale)
    root.style.setProperty('--code-font-size', `${13 * zoom}px`)
    zoomEmitter.emit()
    return getZoomState()
  }

  registerFileViewerZoomProvider(root, {
    zoomIn: () => setZoom(zoom + 0.1),
    zoomOut: () => setZoom(zoom - 0.1),
    resetZoom: () => setZoom(1),
    setZoom,
    getState: getZoomState,
    subscribe: zoomEmitter.subscribe
  })

  return {
    $el: target,
    unmount() {
      disposed = true
      highlightedGeneration += 1
      unregisterFileViewerZoomProvider(root)
      target.replaceChildren()
    }
  }
}
