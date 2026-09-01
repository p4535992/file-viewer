import {
  DEFAULT_FILE_VIEWER_SEARCH_MAX_MATCHES,
  createEmptyFileViewerSearchState,
  createFileViewerTranslator,
  createFileViewerZoomChangeEmitter as createZoomChangeEmitter,
  decodeFileViewerTextBuffer,
  normalizeFileViewerSearchOptions,
  registerFileViewerSearchProvider,
  registerFileViewerZoomProvider,
  unregisterFileViewerSearchProvider,
  unregisterFileViewerZoomProvider,
  type FileRenderContext,
  type FileViewerRenderedInstance,
  type FileViewerSearchMatch,
  type FileViewerSearchOptions,
  type FileViewerSearchState,
  type FileViewerZoomState
} from '@file-viewer/core'
import { codeStyle } from './codeStyle.js'

const WRAPPED_LARGE_TEXT_BASE_LINE_HEIGHT = 22.1
const WRAPPED_LARGE_TEXT_INDEX_YIELD_CHARACTERS = 2 * 1024 * 1024
const WRAPPED_LARGE_TEXT_MAX_SCROLL_HEIGHT = 8_000_000
const WRAPPED_LARGE_TEXT_DEFAULT_OVERSCAN_LINES = 12

interface WrappedLargeTextSearchMatch extends FileViewerSearchMatch {
  characterOffset: number;
  lineIndex: number;
}

const clamp = (value: number, minimum: number, maximum: number) => {
  return Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : minimum
}

const clampZoom = (value: number) => {
  return Math.min(2.6, Math.max(0.6, Number(value.toFixed(2))))
}

const getWindow = (target: HTMLElement) => target.ownerDocument.defaultView

const nextBrowserTurn = (target: HTMLElement) => {
  const view = getWindow(target)
  return new Promise<void>(resolve => {
    if (view?.setTimeout) {
      view.setTimeout(resolve, 0)
      return
    }
    setTimeout(resolve, 0)
  })
}

const buildLineStarts = async (
  text: string,
  target: HTMLElement,
  onProgress: (progress: number) => void
) => {
  const starts = [0]
  let nextYield = WRAPPED_LARGE_TEXT_INDEX_YIELD_CHARACTERS
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charCodeAt(index)
    if (character === 13) {
      if (text.charCodeAt(index + 1) === 10) {
        index += 1
      }
      starts.push(index + 1)
    } else if (character === 10) {
      starts.push(index + 1)
    }

    if (index >= nextYield) {
      onProgress(Math.min(99, Math.round((index / Math.max(1, text.length)) * 100)))
      nextYield = index + WRAPPED_LARGE_TEXT_INDEX_YIELD_CHARACTERS
      await nextBrowserTurn(target)
    }
  }
  onProgress(100)
  return starts
}

const getLineText = (text: string, lineStarts: readonly number[], lineIndex: number) => {
  const normalizedLine = clamp(Math.trunc(lineIndex), 0, lineStarts.length - 1)
  const start = lineStarts[normalizedLine] ?? 0
  let end = normalizedLine + 1 < lineStarts.length
    ? lineStarts[normalizedLine + 1] ?? text.length
    : text.length
  if (end > start && text.charCodeAt(end - 1) === 10) {
    end -= 1
  }
  if (end > start && text.charCodeAt(end - 1) === 13) {
    end -= 1
  }
  return text.slice(start, end)
}

const findLineAtCharacterOffset = (
  lineStarts: readonly number[],
  requestedOffset: number
) => {
  const offset = clamp(Math.trunc(requestedOffset), 0, Number.MAX_SAFE_INTEGER)
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((lineStarts[middle] ?? 0) <= offset) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  return low
}

class SparseWrappedLineHeights {
  private baseHeight: number
  private readonly lineCount: number
  private readonly measured = new Map<number, number>()
  private readonly fenwick = new Map<number, number>()

  constructor(lineCount: number, baseHeight: number) {
    this.lineCount = lineCount
    this.baseHeight = baseHeight
  }

  reset(baseHeight: number) {
    this.baseHeight = baseHeight
    this.measured.clear()
    this.fenwick.clear()
  }

  set(lineIndex: number, measuredHeight: number) {
    const normalizedLine = clamp(Math.trunc(lineIndex), 0, this.lineCount - 1)
    const height = Math.max(this.baseHeight, Number(measuredHeight) || this.baseHeight)
    const previous = this.measured.get(normalizedLine) ?? this.baseHeight
    const delta = height - previous
    if (Math.abs(delta) < 0.5) {
      return false
    }
    this.measured.set(normalizedLine, height)
    for (let index = normalizedLine + 1; index <= this.lineCount; index += index & -index) {
      this.fenwick.set(index, (this.fenwick.get(index) ?? 0) + delta)
    }
    return true
  }

  private prefixDelta(count: number) {
    let total = 0
    for (let index = clamp(Math.trunc(count), 0, this.lineCount); index > 0; index -= index & -index) {
      total += this.fenwick.get(index) ?? 0
    }
    return total
  }

  offsetOf(lineIndex: number) {
    const line = clamp(Math.trunc(lineIndex), 0, this.lineCount)
    return (line * this.baseHeight) + this.prefixDelta(line)
  }

  totalHeight() {
    return this.offsetOf(this.lineCount)
  }

  lineAtOffset(requestedOffset: number) {
    const offset = clamp(requestedOffset, 0, Math.max(0, this.totalHeight() - 1))
    let low = 0
    let high = this.lineCount - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (this.offsetOf(middle) <= offset) {
        low = middle
      } else {
        high = middle - 1
      }
    }
    return low
  }
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const createSearchRegExp = (query: string, options: FileViewerSearchOptions) => {
  const escaped = escapeRegExp(query)
  return new RegExp(options.wholeWord ? `\\b${escaped}\\b` : escaped, options.caseSensitive ? 'g' : 'gi')
}

const cloneSearchState = (state: FileViewerSearchState): FileViewerSearchState => ({
  ...state,
  current: state.current ? { ...state.current } : null,
  matches: state.matches.map(match => ({ ...match }))
})

const formatLargeNumber = (value: number) => {
  try {
    return new Intl.NumberFormat().format(value)
  } catch {
    return String(value)
  }
}

const wrappedLargeTextStyle = `
.code-viewer--wrapped-virtual{height:100%;min-height:240px;display:flex;flex-direction:column;overflow:hidden}
.code-viewer--wrapped-virtual .code-toolbar{flex:0 0 42px}
.code-viewer--wrapped-virtual .code-virtual-scroll{position:relative;flex:1 1 auto;min-width:0;min-height:0;overflow:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;contain:strict;background:var(--code-bg);overflow-anchor:none}
.code-viewer--wrapped-virtual .code-virtual-spacer{position:relative;width:100%;min-width:0}
.code-viewer--wrapped-virtual .code-virtual-window{position:absolute;top:0;left:0;width:100%;min-width:0;will-change:transform}
.code-viewer--wrapped-virtual .code-virtual-line{display:grid;grid-template-columns:var(--code-line-number-width,7ch) minmax(0,1fr);width:100%;min-width:0;min-height:var(--code-line-height,22.1px);align-items:start;color:var(--code-text);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono',monospace;font-size:var(--code-font-size,13px);line-height:var(--code-line-height,22.1px);contain:layout paint style;box-sizing:border-box}
.code-viewer--wrapped-virtual:not(.code-viewer--line-numbers) .code-virtual-line{grid-template-columns:minmax(0,1fr)}
.code-viewer--wrapped-virtual .code-virtual-line--match{background:rgba(255,215,0,.18)}
.code-viewer--wrapped-virtual .code-virtual-number{position:sticky;left:0;z-index:1;display:block;min-height:100%;padding:0 1.25ch 0 .75ch;border-right:1px solid var(--code-border);background:var(--code-bg);color:var(--code-muted);text-align:right;user-select:none;box-sizing:border-box}
.code-viewer--wrapped-virtual .code-virtual-content{display:block;min-width:0;padding:0 18px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;box-sizing:border-box}
.code-viewer--wrapped-virtual .code-virtual-content mark{border-radius:2px;background:#ffd54f;color:#1f2328}
`

export default async function renderWrappedLargeText(
  buffer: ArrayBuffer,
  target: HTMLDivElement,
  type = 'txt',
  context?: FileRenderContext
): Promise<FileViewerRenderedInstance> {
  const t = createFileViewerTranslator(context?.options)
  const documentRef = target.ownerDocument
  const decoded = decodeFileViewerTextBuffer(buffer, context?.options?.text?.encoding)
  const text = decoded.text
  const configuredOverscan = context?.options?.text?.virtualOverscanLines
  const overscan = Number.isFinite(configuredOverscan)
    ? clamp(Math.trunc(Number(configuredOverscan)), 2, 100)
    : WRAPPED_LARGE_TEXT_DEFAULT_OVERSCAN_LINES
  const showToolbar = context?.options?.text?.toolbar !== false
  // Match the existing large-text renderer: omitted lineNumbers keeps the
  // historical visible gutter, while an explicit false hides it.
  const showLineNumbers = context?.options?.text?.lineNumbers !== false
  let disposed = false
  let zoom = 1
  let scheduledFrame = 0
  let lastWindowStart = -1
  let lastWindowEnd = -1
  let activeLine = -1
  let searchGeneration = 0
  const zoomEmitter = createZoomChangeEmitter()

  const style = documentRef.createElement('style')
  style.textContent = `${codeStyle}\n${wrappedLargeTextStyle}`
  const root = documentRef.createElement('div')
  root.className = showLineNumbers
    ? 'code-viewer code-viewer--virtual code-viewer--wrapped-virtual code-viewer--line-numbers'
    : 'code-viewer code-viewer--virtual code-viewer--wrapped-virtual'
  root.dataset.viewerZoomProvider = 'code'
  root.dataset.viewerSearchProvider = 'code-virtual-wrapped'
  root.dataset.textToolbar = String(showToolbar)
  root.dataset.lineNumbers = String(showLineNumbers)
  root.dataset.wrapLongLines = 'true'
  root.dataset.textEncoding = decoded.encoding

  const toolbar = documentRef.createElement('div')
  toolbar.className = 'code-toolbar'
  const extensionLabel = documentRef.createElement('span')
  extensionLabel.textContent = type.toUpperCase()
  const toolbarMeta = documentRef.createElement('div')
  toolbarMeta.className = 'code-toolbar-meta'
  const status = documentRef.createElement('span')
  const lineSummary = documentRef.createElement('strong')
  status.textContent = t('text.code.indexingLargeFile', { progress: 0 })
  toolbarMeta.append(status, lineSummary)
  toolbar.append(extensionLabel, toolbarMeta)
  if (showToolbar) {
    root.append(toolbar)
  }
  target.replaceChildren(style, root)
  context?.onProgressiveRender?.()

  const lineStarts = await buildLineStarts(text, target, progress => {
    if (!disposed) {
      status.textContent = t('text.code.indexingLargeFile', { progress })
    }
  })
  if (disposed) {
    return { $el: target, unmount() {} }
  }

  const lineCount = lineStarts.length
  status.textContent = t('text.code.virtualized')
  lineSummary.textContent = `${formatLargeNumber(lineCount)} lines`
  root.dataset.totalLines = String(lineCount)
  root.style.setProperty('--code-line-number-width', `${Math.max(6, String(lineCount).length + 2)}ch`)

  const viewport = documentRef.createElement('div')
  viewport.className = 'code-virtual-scroll'
  viewport.dataset.viewerScrollContainer = 'true'
  viewport.tabIndex = 0
  const spacer = documentRef.createElement('div')
  spacer.className = 'code-virtual-spacer'
  const windowElement = documentRef.createElement('div')
  windowElement.className = 'code-virtual-window'
  spacer.append(windowElement)
  viewport.append(spacer)
  root.append(viewport)

  const getBaseLineHeight = () => WRAPPED_LARGE_TEXT_BASE_LINE_HEIGHT * zoom
  const heights = new SparseWrappedLineHeights(lineCount, getBaseLineHeight())
  const getViewportHeight = () => Math.max(240, viewport.clientHeight || 600)
  const getContentHeight = () => Math.max(getViewportHeight(), heights.totalHeight())
  const getSpacerHeight = () => Math.min(
    WRAPPED_LARGE_TEXT_MAX_SCROLL_HEIGHT,
    getContentHeight()
  )
  const usesCappedScrollHeight = () => getContentHeight() > WRAPPED_LARGE_TEXT_MAX_SCROLL_HEIGHT

  const contentOffsetFromScroll = (scrollTop = viewport.scrollTop) => {
    if (!usesCappedScrollHeight()) {
      return scrollTop
    }
    const viewportHeight = getViewportHeight()
    const maxScroll = Math.max(1, getSpacerHeight() - viewportHeight)
    const maxContentScroll = Math.max(1, getContentHeight() - viewportHeight)
    return (scrollTop / maxScroll) * maxContentScroll
  }

  const scrollOffsetFromContent = (contentOffset: number) => {
    if (!usesCappedScrollHeight()) {
      return contentOffset
    }
    const viewportHeight = getViewportHeight()
    const maxScroll = Math.max(0, getSpacerHeight() - viewportHeight)
    const maxContentScroll = Math.max(1, getContentHeight() - viewportHeight)
    return (clamp(contentOffset, 0, maxContentScroll) / maxContentScroll) * maxScroll
  }

  const windowOffsetFromContent = (contentOffset: number) => {
    return scrollOffsetFromContent(contentOffset)
  }

  const updateSpacerHeight = () => {
    root.style.setProperty('--code-font-size', `${13 * zoom}px`)
    root.style.setProperty('--code-line-height', `${getBaseLineHeight()}px`)
    spacer.style.height = `${getSpacerHeight()}px`
  }

  const appendHighlightedContent = (
    content: HTMLElement,
    lineText: string,
    match: WrappedLargeTextSearchMatch | null
  ) => {
    if (!match || match.characterOffset < 0) {
      content.textContent = lineText
      return
    }
    const start = clamp(match.characterOffset, 0, lineText.length)
    const end = clamp(start + match.text.length, start, lineText.length)
    content.append(
      documentRef.createTextNode(lineText.slice(0, start)),
      Object.assign(documentRef.createElement('mark'), { textContent: lineText.slice(start, end) }),
      documentRef.createTextNode(lineText.slice(end))
    )
  }

  let searchState = createEmptyFileViewerSearchState()

  const renderWindow = (force = false) => {
    if (disposed) {
      return
    }
    const anchorContentOffset = contentOffsetFromScroll()
    const firstVisibleLine = heights.lineAtOffset(anchorContentOffset)
    const endContentOffset = anchorContentOffset + getViewportHeight()
    const lastVisibleLine = heights.lineAtOffset(endContentOffset)
    const startLine = clamp(firstVisibleLine - overscan, 0, lineCount - 1)
    const endLine = clamp(lastVisibleLine + overscan + 2, startLine + 1, lineCount)
    if (!force && startLine === lastWindowStart && endLine === lastWindowEnd) {
      return
    }
    lastWindowStart = startLine
    lastWindowEnd = endLine

    const activeMatch = searchState.current as WrappedLargeTextSearchMatch | null
    const fragment = documentRef.createDocumentFragment()
    for (let lineIndex = startLine; lineIndex < endLine; lineIndex += 1) {
      const row = documentRef.createElement('div')
      row.className = 'code-virtual-line'
      row.dataset.line = String(lineIndex + 1)
      if (lineIndex === activeLine) {
        row.classList.add('code-virtual-line--match')
      }
      if (showLineNumbers) {
        const number = documentRef.createElement('span')
        number.className = 'code-virtual-number'
        number.setAttribute('aria-hidden', 'true')
        number.textContent = String(lineIndex + 1)
        row.append(number)
      }
      const content = documentRef.createElement('span')
      content.className = 'code-virtual-content'
      appendHighlightedContent(
        content,
        getLineText(text, lineStarts, lineIndex),
        activeMatch?.lineIndex === lineIndex ? activeMatch : null
      )
      row.append(content)
      fragment.append(row)
    }

    windowElement.replaceChildren(fragment)
    windowElement.style.transform = `translateY(${windowOffsetFromContent(heights.offsetOf(startLine))}px)`

    let heightsChanged = false
    for (const row of Array.from(windowElement.children)) {
      const lineIndex = Number((row as HTMLElement).dataset.line) - 1
      const measuredHeight = Math.max(
        (row as HTMLElement).getBoundingClientRect().height,
        (row as HTMLElement).scrollHeight
      )
      if (measuredHeight > 0) {
        heightsChanged = heights.set(lineIndex, measuredHeight) || heightsChanged
      }
    }
    if (heightsChanged) {
      updateSpacerHeight()
      viewport.scrollTop = scrollOffsetFromContent(anchorContentOffset)
      windowElement.style.transform = `translateY(${windowOffsetFromContent(heights.offsetOf(startLine))}px)`
    }
  }

  const scheduleRender = () => {
    if (scheduledFrame || disposed) {
      return
    }
    const view = getWindow(target)
    if (view?.requestAnimationFrame) {
      scheduledFrame = view.requestAnimationFrame(() => {
        scheduledFrame = 0
        renderWindow()
      })
      return
    }
    scheduledFrame = Number(view?.setTimeout?.(() => {
      scheduledFrame = 0
      renderWindow()
    }, 0) ?? setTimeout(() => {
      scheduledFrame = 0
      renderWindow()
    }, 0))
  }

  const scrollToLine = (requestedLine: number) => {
    const lineIndex = clamp(Math.trunc(requestedLine), 0, lineCount - 1)
    viewport.scrollTop = scrollOffsetFromContent(heights.offsetOf(lineIndex))
    lastWindowStart = -1
    lastWindowEnd = -1
    renderWindow(true)
  }

  const setActiveSearchMatch = (requestedIndex: number) => {
    const matches = searchState.matches as WrappedLargeTextSearchMatch[]
    if (!matches.length) {
      activeLine = -1
      searchState.currentIndex = -1
      searchState.current = null
      renderWindow(true)
      return cloneSearchState(searchState)
    }
    const currentIndex = ((requestedIndex % matches.length) + matches.length) % matches.length
    const match = matches[currentIndex]
    searchState.currentIndex = currentIndex
    searchState.current = match
    activeLine = match.lineIndex
    scrollToLine(match.lineIndex)
    return cloneSearchState(searchState)
  }

  const clearSearch = () => {
    searchGeneration += 1
    searchState = createEmptyFileViewerSearchState()
    activeLine = -1
    renderWindow(true)
    return cloneSearchState(searchState)
  }

  const searchWrappedText = async (
    rawQuery: string,
    rawOptions?: FileViewerSearchOptions
  ) => {
    const query = rawQuery.replace(/\s+/g, ' ').trim()
    const options = normalizeFileViewerSearchOptions(rawOptions)
    if (!query || options.enabled === false) {
      return clearSearch()
    }

    const generation = searchGeneration + 1
    searchGeneration = generation
    const matches: WrappedLargeTextSearchMatch[] = []
    const maxMatches = Math.max(1, options.maxMatches || DEFAULT_FILE_VIEWER_SEARCH_MAX_MATCHES)
    let charactersSinceYield = 0

    for (let lineIndex = 0; lineIndex < lineCount && matches.length < maxMatches; lineIndex += 1) {
      const lineText = getLineText(text, lineStarts, lineIndex)
      const expression = createSearchRegExp(query, options)
      let match: RegExpExecArray | null
      while ((match = expression.exec(lineText)) && matches.length < maxMatches) {
        if (!match[0]) {
          expression.lastIndex += 1
          continue
        }
        matches.push({
          id: `code-virtual-wrapped-search-${matches.length + 1}`,
          index: matches.length,
          text: match[0],
          anchor: null,
          line: lineIndex + 1,
          lineIndex,
          characterOffset: match.index
        })
      }
      charactersSinceYield += lineText.length
      if (charactersSinceYield >= WRAPPED_LARGE_TEXT_INDEX_YIELD_CHARACTERS) {
        charactersSinceYield = 0
        await nextBrowserTurn(target)
        if (disposed || generation !== searchGeneration) {
          return cloneSearchState(searchState)
        }
      }
    }

    searchState = {
      query,
      total: matches.length,
      currentIndex: matches.length ? 0 : -1,
      current: matches[0] || null,
      matches
    }
    return matches.length ? setActiveSearchMatch(0) : cloneSearchState(searchState)
  }

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
    const firstVisibleLine = heights.lineAtOffset(contentOffsetFromScroll())
    zoom = clampZoom(scale)
    heights.reset(getBaseLineHeight())
    updateSpacerHeight()
    scrollToLine(firstVisibleLine)
    zoomEmitter.emit()
    return getZoomState()
  }

  registerFileViewerSearchProvider(root, {
    search: searchWrappedText,
    next: () => setActiveSearchMatch(searchState.currentIndex + 1),
    previous: () => setActiveSearchMatch(searchState.currentIndex - 1),
    clear: clearSearch,
    getState: () => cloneSearchState(searchState)
  })
  registerFileViewerZoomProvider(root, {
    zoomIn: () => setZoom(zoom + 0.1),
    zoomOut: () => setZoom(zoom - 0.1),
    resetZoom: () => setZoom(1),
    setZoom,
    getState: getZoomState,
    subscribe: zoomEmitter.subscribe
  })
  context?.registerExportAdapter?.({ print: false, exportHtml: false })

  viewport.addEventListener('scroll', scheduleRender, { passive: true })
  const ResizeObserverCtor = getWindow(target)?.ResizeObserver
  const resizeObserver = ResizeObserverCtor
    ? new ResizeObserverCtor(() => {
        const firstVisibleLine = heights.lineAtOffset(contentOffsetFromScroll())
        heights.reset(getBaseLineHeight())
        updateSpacerHeight()
        scrollToLine(firstVisibleLine)
      })
    : null
  resizeObserver?.observe(viewport)

  updateSpacerHeight()
  renderWindow(true)

  return {
    $el: target,
    unmount() {
      disposed = true
      searchGeneration += 1
      const view = getWindow(target)
      if (scheduledFrame && view?.cancelAnimationFrame) {
        view.cancelAnimationFrame(scheduledFrame)
      } else if (scheduledFrame) {
        view?.clearTimeout?.(scheduledFrame)
        clearTimeout(scheduledFrame)
      }
      resizeObserver?.disconnect()
      unregisterFileViewerSearchProvider(root)
      unregisterFileViewerZoomProvider(root)
      target.replaceChildren()
    }
  }
}
