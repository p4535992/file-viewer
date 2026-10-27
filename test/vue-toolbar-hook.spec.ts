import { computed, effectScope, nextTick, reactive, ref, shallowRef } from 'vue'
import { describe, expect, it } from 'vitest'
import { useViewerToolbar } from '../packages/components/vue3/src/package/components/FileViewer/hooks/useViewerToolbar'
import type {
  FileViewerOperationAvailability,
  FileViewerToolbarOptions,
  FileViewerZoomState
} from '../packages/components/vue3/src/package/common/type'

describe('Vue FileViewer toolbar hook', () => {
  it('keeps toolbar visibility, PDF floating position and emitted capability states in one facade', async () => {
    const activeExportAdapter = shallowRef(null)
    const currentBuffer = ref(new ArrayBuffer(8))
    const currentExtend = computed(() => 'pdf')
    const currentFile = ref<File | null>(null)
    const currentSourceUrl = ref<string | null>(null)
    const error = ref('')
    const loading = ref(false)
    const rendererSearchAvailable = ref(true)
    const renderedReady = ref(true)
    const normalizedToolbar = computed<FileViewerToolbarOptions>(() => ({
      download: true,
      print: true,
      exportHtml: true,
      zoom: true,
      theme: true
    }))
    const zoomState = reactive<FileViewerZoomState>({
      scale: 1,
      label: '100%',
      canZoomIn: true,
      canZoomOut: false,
      canReset: false,
      minScale: 0.25,
      maxScale: 4
    })
    const availabilityEvents: FileViewerOperationAvailability[] = []
    const zoomEvents: FileViewerZoomState[] = []
    const scope = effectScope()

    const toolbar = scope.run(() => useViewerToolbar({
      activeExportAdapter,
      currentBuffer,
      currentExtend,
      currentFile,
      currentSourceUrl,
      error,
      getOptions: () => undefined,
      getZoomState: () => ({ ...zoomState }),
      loading,
      normalizedToolbar,
      rendererSearchAvailable,
      renderedReady,
      zoomState,
      emitOperationAvailabilityChange: availability => {
        availabilityEvents.push(availability)
      },
      emitZoomChange: state => {
        zoomEvents.push(state)
      }
    }))

    expect(toolbar).toBeTruthy()
    expect(toolbar?.operationAvailability.value).toMatchObject({
      download: true,
      print: false,
      exportHtml: true,
      zoom: true,
      zoomIn: true,
      zoomOut: false
    })
    expect(toolbar?.visibleToolbar.value).toMatchObject({
      download: true,
      print: false,
      exportHtml: true,
      zoom: true,
      theme: true
    })
    expect(toolbar?.toolbarOrder.value).toEqual([
      'search',
      'zoom',
      'download',
      'print',
      'exportHtml',
      'theme'
    ])
    expect(toolbar?.showToolbar.value).toBe(true)
    expect(toolbar?.toolbarPosition.value).toBe('bottom-right')
    expect(toolbar?.zoomButtonDisabled('canZoomIn')).toBe(false)
    expect(toolbar?.zoomButtonDisabled('canZoomOut')).toBe(true)
    expect(availabilityEvents[0]).toMatchObject(toolbar?.operationAvailability.value || {})
    expect(zoomEvents[0]).toMatchObject({ label: '100%' })

    const zoomEventCount = zoomEvents.length
    zoomState.minScale = 0.5
    zoomState.maxScale = 5
    await nextTick()

    expect(zoomEvents).toHaveLength(zoomEventCount)

    expect(toolbar?.zoomButtons.value).toEqual({ zoomIn: true, zoomOut: true, zoomReset: true })
    zoomState.canZoomIn = false
    zoomState.canZoomOut = true
    zoomState.canReset = true
    await nextTick()
    expect(toolbar?.zoomButtons.value.zoomIn).toBe(true)
    expect(toolbar?.zoomButtonDisabled('canZoomIn')).toBe(true)
    expect(toolbar?.visibleToolbar.value.zoom).toBe(true)

    error.value = 'render failed'
    await nextTick()

    expect(toolbar?.toolbarDisabled.value).toBe(true)
    expect(toolbar?.zoomButtons.value).toEqual({ zoomIn: false, zoomOut: false, zoomReset: false })
    expect(availabilityEvents.at(-1)).toMatchObject({
      download: true,
      print: false,
      exportHtml: false,
      zoom: false
    })

    scope.stop()
  })
})
