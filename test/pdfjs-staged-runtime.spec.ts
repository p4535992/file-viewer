import { describe, expect, it } from 'vitest'
import {
  isolatePdfJsWebpackRuntime,
  pdfJsRuntimeIsolationTransform,
  pdfJsRuntimeModificationNotice,
} from '../packages/renderers/pdf/scripts/pdfjs-runtime-transform.mjs'

const pdfJsRuntimeSource = `
var __webpack_modules__ = {};
var __webpack_module_cache__ = {};
var __webpack_exports__ = {};
function __webpack_require__(moduleId) {
  return __webpack_modules__[moduleId];
}
`

describe('staged PDF.js runtime isolation', () => {
  it('isolates every PDF.js webpack runtime binding before packing', () => {
    const transformed = isolatePdfJsWebpackRuntime(pdfJsRuntimeSource)

    expect(pdfJsRuntimeIsolationTransform).toBe('isolate-pdfjs-webpack4-runtime-v2')
    expect(transformed.replacements).toBe(5)
    expect(transformed.output.startsWith(pdfJsRuntimeModificationNotice)).toBe(true)
    expect(transformed.output).not.toMatch(/\b__webpack_(modules|module_cache|exports|require)__\b/)
    expect(transformed.output).toContain('__pdfjs_webpack_modules__')
    expect(transformed.output).toContain('__pdfjs_webpack_module_cache__')
    expect(transformed.output).toContain('__pdfjs_webpack_exports__')
    expect(transformed.output).toContain('__pdfjs_webpack_require__')
  })

  it('does not alter a module without PDF.js webpack runtime bindings', () => {
    const source = 'export const ready = true\n'
    expect(isolatePdfJsWebpackRuntime(source)).toEqual({ output: source, replacements: 0 })
  })

  it('removes unavailable source-map references without changing executable code', () => {
    const source = 'export const ready = true\n//# sourceMappingURL=missing.js.map\n'
    const transformed = isolatePdfJsWebpackRuntime(source)
    expect(transformed.output).toContain('export const ready = true')
    expect(transformed.output).not.toContain('sourceMappingURL')
  })
})
