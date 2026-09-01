import {
  type FileRenderContext,
  type FileViewerRenderedInstance
} from '@file-viewer/core'
import renderLargeText from './largeText.js'

interface FileViewerWrapToggleLabels {
  active: string
  inactive: string
  enable: string
  disable: string
}

const wrapToggleLabels: Readonly<Record<string, FileViewerWrapToggleLabels>> = {
  de: {
    active: 'Umbruch: an',
    inactive: 'Umbruch: aus',
    enable: 'Lange Zeilen umbrechen',
    disable: 'Zeilenumbruch deaktivieren'
  },
  en: {
    active: 'Wrap: on',
    inactive: 'Wrap: off',
    enable: 'Wrap long lines',
    disable: 'Disable line wrapping'
  },
  it: {
    active: 'A capo: sì',
    inactive: 'A capo: no',
    enable: 'Manda a capo le righe lunghe',
    disable: 'Disattiva il ritorno a capo'
  },
  ja: {
    active: '折り返し: オン',
    inactive: '折り返し: オフ',
    enable: '長い行を折り返す',
    disable: '行の折り返しを解除'
  },
  zh: {
    active: '换行：开',
    inactive: '换行：关',
    enable: '自动换行长行',
    disable: '关闭长行换行'
  }
}

const resolveWrapToggleLabels = (
  documentRef: Document,
  context?: FileRenderContext
) => {
  const configured = context?.options?.i18n?.locale || context?.options?.locale
  const locale = configured && configured !== 'auto'
    ? configured
    : documentRef.defaultView?.navigator?.language || 'en'
  const language = String(locale).trim().toLowerCase().split(/[-_]/, 1)[0] || 'en'
  return wrapToggleLabels[language] || wrapToggleLabels.en
}

export const updateFileViewerWrapToggleButton = (
  button: HTMLButtonElement,
  wrapped: boolean,
  context?: FileRenderContext
) => {
  const labels = resolveWrapToggleLabels(button.ownerDocument, context)
  button.textContent = wrapped ? labels.active : labels.inactive
  button.title = wrapped ? labels.disable : labels.enable
  button.setAttribute('aria-label', button.title)
  button.setAttribute('aria-pressed', String(wrapped))
  button.dataset.wrapLongLinesToggle = 'true'
}

export const createFileViewerWrapToggleButton = (
  documentRef: Document,
  wrapped: boolean,
  context: FileRenderContext | undefined,
  onToggle: () => void
) => {
  const button = documentRef.createElement('button')
  button.type = 'button'
  button.className = 'code-representation-toggle code-wrap-toggle'
  updateFileViewerWrapToggleButton(button, wrapped, context)
  button.addEventListener('click', onToggle)
  return button
}

const disposeRenderedInstance = async (
  instance: FileViewerRenderedInstance | null
) => {
  if (!instance) {
    return
  }
  if ('unmount' in instance) {
    await instance.unmount()
    return
  }
  if ('$destroy' in instance) {
    await instance.$destroy()
    return
  }
  await instance.destroy()
}

const contextWithWrapState = (
  context: FileRenderContext | undefined,
  wrapped: boolean
): FileRenderContext => ({
  ...context,
  options: {
    ...context?.options,
    text: {
      ...context?.options?.text,
      wrapLongLines: wrapped
    }
  }
})

const attachWrapToggle = (
  target: HTMLDivElement,
  wrapped: boolean,
  context: FileRenderContext | undefined,
  onToggle: () => void
) => {
  const root = target.querySelector<HTMLElement>('.code-viewer')
  if (!root) {
    return
  }
  const button = createFileViewerWrapToggleButton(
    target.ownerDocument,
    wrapped,
    context,
    onToggle
  )
  const toolbarMeta = root.querySelector<HTMLElement>('.code-toolbar-meta')
  if (toolbarMeta) {
    toolbarMeta.prepend(button)
    return
  }
  let floating = root.querySelector<HTMLElement>('.code-representation-floating')
  if (!floating) {
    floating = target.ownerDocument.createElement('div')
    floating.className = 'code-representation-floating'
    root.prepend(floating)
  }
  floating.append(button)
}

const renderVirtualTextForWrapState = async (
  buffer: ArrayBuffer,
  target: HTMLDivElement,
  type: string,
  context: FileRenderContext | undefined,
  wrapped: boolean
) => {
  const nextContext = contextWithWrapState(context, wrapped)
  if (wrapped) {
    const { default: renderWrappedLargeText } = await import('./wrappedLargeText.js')
    return renderWrappedLargeText(buffer, target, type, nextContext)
  }
  return renderLargeText(buffer, target, type, nextContext)
}

/**
 * Mounts the bounded large-text renderer and optionally switches between its
 * fixed-height and wrapped variable-height implementations. This helper is
 * reached only after the code renderer has skipped or failed pretty printing,
 * so changing the wrap state never invokes Prettier.
 */
export const renderFileViewerVirtualTextWithWrapToggle = async (
  buffer: ArrayBuffer,
  target: HTMLDivElement,
  type: string,
  context?: FileRenderContext
): Promise<FileViewerRenderedInstance> => {
  let wrapped = context?.options?.text?.wrapLongLines === true
  if (context?.options?.text?.wrapLongLinesToggle !== true) {
    return renderVirtualTextForWrapState(buffer, target, type, context, wrapped)
  }

  let disposed = false
  let generation = 0
  let instance: FileViewerRenderedInstance | null = null

  const mount = async () => {
    const currentGeneration = generation + 1
    generation = currentGeneration
    const previous = instance
    instance = null
    await disposeRenderedInstance(previous)
    if (disposed || currentGeneration !== generation) {
      return
    }

    const mounted = await renderVirtualTextForWrapState(
      buffer,
      target,
      type,
      context,
      wrapped
    )
    if (disposed || currentGeneration !== generation) {
      await disposeRenderedInstance(mounted)
      return
    }
    instance = mounted
    attachWrapToggle(target, wrapped, context, () => {
      const previousState = wrapped
      wrapped = !wrapped
      void mount().catch(error => {
        wrapped = previousState
        console.warn('[file-viewer] Unable to toggle virtual line wrapping.', error)
        void mount().catch(restoreError => {
          console.warn('[file-viewer] Unable to restore virtual line wrapping.', restoreError)
        })
      })
    })
  }

  await mount()

  return {
    $el: target,
    async unmount() {
      disposed = true
      generation += 1
      const mounted = instance
      instance = null
      await disposeRenderedInstance(mounted)
      target.replaceChildren()
    }
  }
}
