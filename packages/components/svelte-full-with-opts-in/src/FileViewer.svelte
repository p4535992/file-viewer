<script context="module">
  export {
    getDefaultFullAssetBaseUrl,
    resetDefaultFullAssetBaseUrl,
    setDefaultFullAssetBaseUrl
  } from '@file-viewer/preset-full-with-opts-in'
</script>

<script>
  import allRenderers, {
    getDefaultFullAssetBaseUrl,
    mergeFullAssetOptions
  } from '@file-viewer/preset-full-with-opts-in'
  import BaseFileViewer from '@file-viewer/svelte'

  export let url = undefined
  export let file = undefined
  export let buffer = undefined
  export let name = undefined
  export let filename = undefined
  export let type = undefined
  export let size = undefined
  export let options = undefined
  export let onEvent = undefined
  export let onStateChange = undefined
  export let className = ''
  export let containerStyle = ''

  let viewer

  function withFullViewerOptions(value = {}) {
    const { preset = allRenderers, rendererMode = 'replace', ...rest } = value
    return {
      ...mergeFullAssetOptions(rest, getDefaultFullAssetBaseUrl()),
      preset,
      rendererMode,
      autoRenderers: rest.autoRenderers ?? true
    }
  }

  function withFullMountOptions(value = {}) {
    return {
      ...value,
      options: withFullViewerOptions(value.options)
    }
  }

  $: fullOptions = withFullViewerOptions(options)

  export function getController() {
    return viewer?.getController() ?? null
  }

  export function getApi() {
    return viewer?.getApi() ?? null
  }

  export function load(nextOptions) {
    return viewer?.load(withFullMountOptions(nextOptions)) ?? Promise.resolve()
  }

  export function update(nextOptions) {
    return viewer?.update(withFullMountOptions(nextOptions)) ?? Promise.resolve()
  }

  export function reload() {
    return viewer?.reload() ?? Promise.resolve()
  }

  export function downloadOriginalFile() {
    return viewer?.downloadOriginalFile() ?? Promise.resolve()
  }

  export function printRenderedHtml(...args) {
    return viewer?.printRenderedHtml(...args) ?? Promise.resolve()
  }

  export function printWithMask(...args) {
    return viewer?.printWithMask(...args) ?? Promise.resolve()
  }

  export function exportRenderedHtml() {
    return viewer?.exportRenderedHtml() ?? Promise.resolve()
  }

  export function zoomIn() {
    return viewer?.zoomIn() ?? Promise.resolve(null)
  }

  export function zoomOut() {
    return viewer?.zoomOut() ?? Promise.resolve(null)
  }

  export function resetZoom() {
    return viewer?.resetZoom() ?? Promise.resolve(null)
  }

  export function fitToView(fit) {
    return viewer?.fitToView(fit) ?? Promise.resolve(null)
  }

  export function getViewState() {
    return viewer?.getViewState() ?? null
  }

  export function applyViewState(state, options) {
    return viewer?.applyViewState(state, options) ?? Promise.resolve(null)
  }

  export function searchDocument(query) {
    return viewer?.searchDocument(query) ?? Promise.resolve(null)
  }

  export function clearDocumentSearch() {
    return viewer?.clearDocumentSearch() ?? Promise.resolve(null)
  }

  export function nextSearchResult() {
    return viewer?.nextSearchResult() ?? Promise.resolve(null)
  }

  export function previousSearchResult() {
    return viewer?.previousSearchResult() ?? Promise.resolve(null)
  }

  export function collectDocumentAnchors() {
    return viewer?.collectDocumentAnchors() ?? Promise.resolve([])
  }

  export function scrollToAnchor(anchor) {
    return viewer?.scrollToAnchor(anchor) ?? Promise.resolve(false)
  }

  export function scrollToLine(line) {
    return viewer?.scrollToLine(line) ?? Promise.resolve(false)
  }

  export function getDocumentTextChunks() {
    return viewer?.getDocumentTextChunks() ?? []
  }

  export function getOperationAvailability() {
    return viewer?.getOperationAvailability() ?? null
  }

  export function getZoomState() {
    return viewer?.getZoomState() ?? null
  }

  export function getSearchState() {
    return viewer?.getSearchState() ?? null
  }

  export function getState() {
    return viewer?.getState() ?? null
  }

  export function subscribe(listener) {
    return viewer?.subscribe(listener) ?? (() => {})
  }

  export function destroy() {
    viewer?.destroy()
  }
</script>

<BaseFileViewer
  bind:this={viewer}
  {url}
  {file}
  {buffer}
  {name}
  {filename}
  {type}
  {size}
  options={fullOptions}
  {onEvent}
  {onStateChange}
  {className}
  {containerStyle}
  on:viewerEvent
/>
