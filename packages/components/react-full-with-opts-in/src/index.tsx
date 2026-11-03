import allRenderers, {
  getDefaultFullAssetBaseUrl,
  mergeFullAssetOptions
} from '@file-viewer/preset-full-with-opts-in'
import {
  FileViewer as BaseFileViewer,
  useFileViewer as useBaseFileViewer,
  type FileViewerHandle,
  type FileViewerProps,
  type UseFileViewerResult,
  type ViewerMountOptions,
  type ViewerOptions
} from '@file-viewer/react'
import { createElement, forwardRef, useMemo } from 'react'

export * from '@file-viewer/react'
export {
  getDefaultFullAssetBaseUrl,
  resetDefaultFullAssetBaseUrl,
  setDefaultFullAssetBaseUrl
} from '@file-viewer/preset-full-with-opts-in'

export const fileViewerFullPreset = allRenderers

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

export const FileViewer = forwardRef<FileViewerHandle, FileViewerProps>((props, ref) => {
  const { options, ...rest } = props
  const fullOptions = useMemo(() => withFullViewerOptions(options), [options])

  return createElement(BaseFileViewer, {
    ...rest,
    ref,
    options: fullOptions
  })
})

FileViewer.displayName = 'FileViewerFull'

export const useFileViewer = (
  options: ViewerMountOptions = {}
): UseFileViewerResult => {
  const fullOptions = useMemo(() => withFullMountOptions(options), [options])
  return useBaseFileViewer(fullOptions)
}

export default FileViewer
