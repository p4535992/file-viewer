import allRenderers, {
  getDefaultFullAssetBaseUrl,
  mergeFullAssetOptions
} from '@file-viewer/preset-full-with-opts-in'
import installBaseJQueryFileViewer, {
  mountViewer as mountBaseViewer,
  type JQueryFileViewerMethod,
  type JQueryFileViewerOptions,
  type ViewerMountOptions,
  type ViewerOptions
} from '@file-viewer/jquery'

export * from '@file-viewer/jquery'
export {
  getDefaultFullAssetBaseUrl,
  resetDefaultFullAssetBaseUrl,
  setDefaultFullAssetBaseUrl
} from '@file-viewer/preset-full-with-opts-in'

export const fileViewerFullPreset = allRenderers

type ViewerCoreOptions = NonNullable<Parameters<typeof mountBaseViewer>[2]>

type FileViewerPlugin = ((
  this: JQuery,
  options?: JQueryFileViewerOptions | JQueryFileViewerMethod,
  ...args: unknown[]
) => JQuery) & {
  __flyfishFileViewer?: true
  __flyfishFileViewerFull?: true
}

export function withFullViewerOptions(
  options: ViewerOptions = {},
  assetBaseUrl: string | URL | null | undefined = getDefaultFullAssetBaseUrl()
): ViewerOptions {
  const { preset = allRenderers, rendererMode = 'replace', ...rest } = options
  return {
    ...mergeFullAssetOptions(rest, assetBaseUrl),
    preset,
    rendererMode,
    autoRenderers: rest.autoRenderers ?? true
  }
}

export function withFullMountOptions(
  options: ViewerMountOptions = {},
  assetBaseUrl: string | URL | null | undefined = getDefaultFullAssetBaseUrl()
): ViewerMountOptions {
  return {
    ...options,
    options: withFullViewerOptions(options.options, assetBaseUrl)
  }
}

const withFullJQueryOptions = (
  options: JQueryFileViewerOptions = {}
): JQueryFileViewerOptions => {
  return {
    ...options,
    options: withFullViewerOptions(options.options)
  }
}

export const mountViewer = (
  container: HTMLElement,
  options: ViewerMountOptions = {},
  coreOptions: ViewerCoreOptions = {}
) => mountBaseViewer(container, withFullMountOptions(options), coreOptions)

const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined'

const getGlobalJQuery = (): JQueryStatic | undefined => {
  if (!isBrowser()) {
    return undefined
  }

  return window.jQuery || window.$
}

export const installJQueryFileViewer = (jqueryInstance: JQueryStatic | undefined = getGlobalJQuery()) => {
  if (!jqueryInstance) {
    return false
  }

  installBaseJQueryFileViewer(jqueryInstance)

  const basePlugin = jqueryInstance.fn.fileViewer as FileViewerPlugin | undefined
  if (!basePlugin || basePlugin.__flyfishFileViewerFull) {
    return !!basePlugin
  }

  const plugin: FileViewerPlugin = function fileViewer(
    this: JQuery,
    options: JQueryFileViewerOptions | JQueryFileViewerMethod = {},
    ...args: unknown[]
  ) {
    if (typeof options === 'string') {
      if (options === 'load' || options === 'update') {
        return basePlugin.call(
          this,
          options,
          withFullMountOptions((args[0] || {}) as ViewerMountOptions),
          ...args.slice(1)
        )
      }
      return basePlugin.call(this, options, ...args)
    }

    return basePlugin.call(this, withFullJQueryOptions(options))
  }

  plugin.__flyfishFileViewer = true
  plugin.__flyfishFileViewerFull = true
  jqueryInstance.fn.fileViewer = plugin
  return true
}

declare global {
  interface Window {
    jQuery?: JQueryStatic
    $?: JQueryStatic
  }
}

installJQueryFileViewer()

export default installJQueryFileViewer
