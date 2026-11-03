import allRenderers, {
  getDefaultFullAssetBaseUrl,
  mergeFullAssetOptions
} from '@file-viewer/preset-full-with-opts-in'
import {
  FileViewerLegacy as BaseFileViewerLegacy,
  useFileViewer as useBaseFileViewer,
  type FileViewerLegacyHandle,
  type FileViewerLegacyProps,
  type UseFileViewerResult,
  type ViewerMountOptions,
  type ViewerOptions
} from '@file-viewer/react-legacy'
import { createElement, forwardRef, useMemo } from 'react'

export * from '@file-viewer/react-legacy'
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

export const FileViewerLegacy = forwardRef<FileViewerLegacyHandle, FileViewerLegacyProps>((props, ref) => {
  const { options, ...rest } = props
  const fullOptions = useMemo(() => withFullViewerOptions(options), [options])

  return createElement(BaseFileViewerLegacy, {
    ...rest,
    ref,
    options: fullOptions
  })
})

FileViewerLegacy.displayName = 'FileViewerLegacyFull'

export const FileViewer = FileViewerLegacy

export const useFileViewer = (
  options: ViewerMountOptions = {}
): UseFileViewerResult => {
  const fullOptions = useMemo(() => withFullMountOptions(options), [options])
  return useBaseFileViewer(fullOptions)
}

export default FileViewerLegacy
