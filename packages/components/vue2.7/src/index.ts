import Vue from 'vue'
import type { CreateElement, PluginObject, VueConstructor, VNode } from 'vue'
import {
  createViewerControllerHandle,
  mountViewer,
  type ViewerController,
  type ViewerControllerHandle,
  type ViewerEvent,
  type ViewerMountOptions,
  type ViewerCoreOptions,
  type ViewerState,
} from './controller.js'
import { fileViewerCoreRendererRegistry } from '@file-viewer/core'

export type {
  FileRef,
  ViewerAiOptions,
  ViewerApplyViewStateOptions,
  ViewerArchiveOptions,
  ViewerCadOptions,
  ViewerController,
  ViewerControllerAccessor,
  ViewerControllerHandle,
  ViewerDocxOptions,
  ViewerEvent,
  ViewerEventHandler,
  ViewerEventType,
  ViewerFetchFile,
  ViewerFetchInput,
  ViewerFitMode,
  ViewerFitOptions,
  ViewerFitResult,
  ViewerMountOptions,
  ViewerOptions,
  ViewerPdfOptions,
  ViewerPresentationOptions,
  ViewerSpreadsheetOptions,
  ViewerCoreOptions,
  ViewerSearchOptions,
  ViewerSourceInput,
  ViewerThemeMode,
  ViewerToolbarOptions,
  ViewerToolbarPosition,
  ViewerTypstOptions,
  ViewerUiDensity,
  ViewerUiOptions,
  ViewerViewState,
  ViewerWatermarkOptions,
  ViewerLifecycleContext,
  ViewerOperationContext,
  ViewerState,
  ViewerStateListener
} from './controller.js'

export interface FileViewerVue27PluginOptions {
  componentName?: string
}

export interface FileViewerVue27PublicInstance extends Vue, ViewerControllerHandle {}

interface FileViewerVue27Props extends ViewerMountOptions {
  containerClass?: unknown
  containerStyle?: unknown
}

type FileViewerVue27Vm = Vue & FileViewerVue27Props & {
  controller: ViewerController | null
  getViewerOptions(): ViewerMountOptions
  handleViewerEvent(event: ViewerEvent): void
  handleViewerStateChange(state: ViewerState, event?: ViewerEvent): void
  mountViewer(): void
  updateViewer(): void
  disposeViewer(): void
}

const defaultContainerStyle = {
  width: '100%',
  height: '100%',
  minHeight: '0'
}

const viewerCoreOptions: ViewerCoreOptions = {
  registry: fileViewerCoreRendererRegistry
}

const toVm = (value: Vue) => value as FileViewerVue27Vm
const getVmHandle = (vm: FileViewerVue27Vm): ViewerControllerHandle => {
  return createViewerControllerHandle(() => vm.controller, () => vm.disposeViewer())
}

export const FileViewer: VueConstructor<FileViewerVue27PublicInstance & FileViewerVue27Vm> = Vue.extend({
  name: 'FileViewer',
  props: {
    url: String,
    file: null,
    buffer: null,
    name: String,
    filename: String,
    type: String,
    size: Number,
    options: Object,
    onEvent: Function,
    onStateChange: Function,
    containerClass: [String, Array, Object],
    containerStyle: [String, Array, Object]
  } as any,
  data() {
    return {
      controller: null as ViewerController | null
    }
  },
  mounted() {
    toVm(this).mountViewer()
  },
  beforeDestroy() {
    toVm(this).disposeViewer()
  },
  watch: {
    url: 'updateViewer',
    file: 'updateViewer',
    buffer: 'updateViewer',
    name: 'updateViewer',
    filename: 'updateViewer',
    type: 'updateViewer',
    size: 'updateViewer',
    options: {
      handler: 'updateViewer',
      deep: true
    }
  },
  methods: {
    getViewerOptions(): ViewerMountOptions {
      const vm = toVm(this)
      return {
        url: vm.url,
        file: vm.file,
        buffer: vm.buffer,
        name: vm.name,
        filename: vm.filename,
        type: vm.type,
        size: vm.size,
        options: vm.options,
        onEvent: event => vm.handleViewerEvent(event),
        onStateChange: (state, event) => vm.handleViewerStateChange(state, event)
      }
    },
    handleViewerEvent(event: ViewerEvent) {
      const vm = toVm(this)
      vm.onEvent?.(event)
      this.$emit('viewer-event', event)
      this.$emit('viewerEvent', event)
    },
    handleViewerStateChange(state: ViewerState, event?: ViewerEvent) {
      const vm = toVm(this)
      vm.onStateChange?.(state, event)
      this.$emit('viewer-state-change', state, event)
      this.$emit('viewerStateChange', state, event)
    },
    mountViewer() {
      const vm = toVm(this)
      const container = this.$refs.container as HTMLElement | undefined
      if (!container || vm.controller) {
        return
      }
      vm.controller = mountViewer(container, vm.getViewerOptions(), viewerCoreOptions)
    },
    updateViewer() {
      const vm = toVm(this)
      if (vm.controller) {
        vm.controller.update(vm.getViewerOptions())
        return
      }
      vm.mountViewer()
    },
    disposeViewer() {
      const vm = toVm(this)
      vm.controller?.destroy()
      vm.controller = null
    },
    getController() {
      return getVmHandle(toVm(this)).getController()
    },
    getApi() {
      return getVmHandle(toVm(this)).getApi()
    },
    load(options: ViewerMountOptions) {
      return getVmHandle(toVm(this)).load(options)
    },
    update(options: ViewerMountOptions) {
      return getVmHandle(toVm(this)).update(options)
    },
    reload() {
      return getVmHandle(toVm(this)).reload()
    },
    downloadOriginalFile() {
      return getVmHandle(toVm(this)).downloadOriginalFile()
    },
    printRenderedHtml(...args: Parameters<ViewerControllerHandle['printRenderedHtml']>) {
      return getVmHandle(toVm(this)).printRenderedHtml(...args)
    },
    printWithMask(...args: Parameters<ViewerControllerHandle['printWithMask']>) {
      return getVmHandle(toVm(this)).printWithMask(...args)
    },
    exportRenderedHtml() {
      return getVmHandle(toVm(this)).exportRenderedHtml()
    },
    zoomIn() {
      return getVmHandle(toVm(this)).zoomIn()
    },
    zoomOut() {
      return getVmHandle(toVm(this)).zoomOut()
    },
    resetZoom() {
      return getVmHandle(toVm(this)).resetZoom()
    },
    fitToView(fit?: Parameters<ViewerControllerHandle['fitToView']>[0]) {
      return getVmHandle(toVm(this)).fitToView(fit)
    },
    getViewState() {
      return getVmHandle(toVm(this)).getViewState()
    },
    applyViewState(
      state: Parameters<ViewerControllerHandle['applyViewState']>[0],
      options?: Parameters<ViewerControllerHandle['applyViewState']>[1]
    ) {
      return getVmHandle(toVm(this)).applyViewState(state, options)
    },
    searchDocument(query: string) {
      return getVmHandle(toVm(this)).searchDocument(query)
    },
    clearDocumentSearch() {
      return getVmHandle(toVm(this)).clearDocumentSearch()
    },
    nextSearchResult() {
      return getVmHandle(toVm(this)).nextSearchResult()
    },
    previousSearchResult() {
      return getVmHandle(toVm(this)).previousSearchResult()
    },
    collectDocumentAnchors() {
      return getVmHandle(toVm(this)).collectDocumentAnchors()
    },
    scrollToAnchor(anchor: Parameters<ViewerControllerHandle['scrollToAnchor']>[0]) {
      return getVmHandle(toVm(this)).scrollToAnchor(anchor)
    },
    scrollToLine(line: number) {
      return getVmHandle(toVm(this)).scrollToLine(line)
    },
    getDocumentTextChunks() {
      return getVmHandle(toVm(this)).getDocumentTextChunks()
    },
    getOperationAvailability() {
      return getVmHandle(toVm(this)).getOperationAvailability()
    },
    getZoomState() {
      return getVmHandle(toVm(this)).getZoomState()
    },
    getSearchState() {
      return getVmHandle(toVm(this)).getSearchState()
    },
    getState() {
      return getVmHandle(toVm(this)).getState()
    },
    subscribe(listener: Parameters<ViewerControllerHandle['subscribe']>[0]) {
      return getVmHandle(toVm(this)).subscribe(listener)
    },
    destroy() {
      getVmHandle(toVm(this)).destroy()
    }
  },
  render(h: CreateElement): VNode {
    const vm = toVm(this)
    return h('div', {
      ref: 'container',
      class: ['ff-file-viewer-vue27', vm.containerClass],
      style: [defaultContainerStyle, vm.containerStyle]
    } as Record<string, unknown>)
  }
})

export const install = (
  VueCtor: VueConstructor,
  options: FileViewerVue27PluginOptions = {}
) => {
  VueCtor.component(options.componentName || 'FileViewer', FileViewer)
}

export const FileViewerPlugin: PluginObject<FileViewerVue27PluginOptions> = {
  install
}

export default FileViewerPlugin
