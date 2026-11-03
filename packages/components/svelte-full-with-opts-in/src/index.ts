import allRenderers, {
  getDefaultFullAssetBaseUrl,
  mergeFullAssetOptions
} from '@file-viewer/preset-full-with-opts-in'
import {
  fileViewer as baseFileViewer,
  mountViewer as mountBaseViewer,
  type FileViewerSvelteActionOptions,
  type FileViewerSvelteActionReturn,
  type ViewerController,
  type ViewerMountOptions,
  type ViewerOptions
} from '@file-viewer/svelte/action'

// This module is the explicit /action entry. The package root exclusively
// resolves to FileViewer.svelte so Svelte never mistakes this action for a component.
export * from '@file-viewer/svelte/action'
export {
  getDefaultFullAssetBaseUrl,
  resetDefaultFullAssetBaseUrl,
  setDefaultFullAssetBaseUrl
} from '@file-viewer/preset-full-with-opts-in'

export const fileViewerFullPreset = allRenderers

type ViewerCoreOptions = NonNullable<Parameters<typeof mountBaseViewer>[2]>

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

const withFullActionOptions = (
  options: FileViewerSvelteActionOptions = {}
): FileViewerSvelteActionOptions => {
  return {
    ...options,
    options: withFullViewerOptions(options.options)
  }
}

export const mountViewer = (
  container: HTMLElement,
  options: ViewerMountOptions = {},
  coreOptions: ViewerCoreOptions = {}
): ViewerController => mountBaseViewer(container, withFullMountOptions(options), coreOptions)

export const fileViewer = (
  node: HTMLElement,
  initialOptions: FileViewerSvelteActionOptions = {}
): FileViewerSvelteActionReturn => {
  const action = baseFileViewer(node, withFullActionOptions(initialOptions))

  return {
    ...action,
    update(options: FileViewerSvelteActionOptions = {}) {
      action.update(withFullActionOptions(options))
    },
    load(options: ViewerMountOptions) {
      return action.load(withFullMountOptions(options))
    }
  }
}

export default fileViewer
