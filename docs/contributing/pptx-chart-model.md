# PPTX chart models and custom renderers

The PPTX Worker preserves every supported plot group in `data.chartModel`, including repeated groups of the same family. A combination of two bar series and a line therefore reaches the renderer as three series. The existing single-family `chartType`, `chartData`, and `chartOptions` fields remain available; combination messages use `chartType: 'comboChart'`.

`PptxChartModel` is a serializable, exported TypeScript contract. Each group includes its family, series, axis ids, grouping, point colors, gap/overlap and label metadata. Axes retain their ids and cross-axis relationships, visibility, direction, scaling limits, number format, title, gridline presence and text properties. Category series retain indexed multi-level labels in addition to readable combined labels. Scatter groups retain each series and its numeric x values. Cache counts never determine array allocation.

The default Billboard renderer supports bar/line/area combinations, primary and secondary value axes, visibility/direction/limits, common decimal and percentage formats, category hierarchies and value/category/series labels. Existing doughnut hole/angle/point-color and stacked chart behavior remains covered by the browser suite.

Applications that need another chart backend can register a renderer receiving the Worker model directly:

```ts
import { registerPptxChartRenderer, type PptxChartModel } from '@file-viewer/pptx'

registerPptxChartRenderer((model: PptxChartModel, target: HTMLElement) => {
  const chart = renderApplicationChart(target, model)
  return { destroy: () => chart.destroy() }
})

// Restore the default capability renderer when this application hook is removed.
registerPptxChartRenderer(null)
```

The hook takes precedence over the library loader and may return a promise. Its cleanup runs when the presentation's post-processing handle is disposed. No second JSZip/DOMParser pass over the presentation is necessary. Registration, like the existing library loader, applies to the current JavaScript module instance.

Metadata preservation does not imply that Billboard implements every DrawingML layout feature. Exact font substitution and CJK spacing, all legend/label positions, partial series overlap, complex Excel number formats, and arbitrary transformed chart geometry require further document-specific fidelity work. Axis crossing and label-position metadata remain available to custom renderers. An original customer presentation and a reference rendering are needed to qualify those cases.

`test/pptx-chart-model.spec.ts` checks the model and renderer contract. `packages/renderers/pptx/scripts/verify-chart-families.mjs` creates synthetic PPTX files and checks the actual parser, built Worker, real Billboard SVG and cleanup at DPR 1 and 2. It also preserves the existing doughnut, stack, resize and tooltip checks. Set `PPTX_CHART_WORKER_FILE` to the built worker and `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed browser for an offline run.
