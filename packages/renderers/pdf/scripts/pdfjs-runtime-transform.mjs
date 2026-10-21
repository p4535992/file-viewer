import { removeRuntimeSourceReferences } from '../../../build-support/runtime-only-javascript.mjs'

export const pdfJsRuntimeIsolationTransform = 'isolate-pdfjs-webpack4-runtime-v2'
export const pdfJsRuntimeModificationNotice =
  '/* File Viewer modification: isolated PDF.js internal webpack runtime identifiers for webpack 4 compatibility and removed unavailable source-map metadata. */\n'

const runtimeIdentifierPattern = /\b__webpack_(modules|module_cache|exports|require)__\b/g

export function isolatePdfJsWebpackRuntime(source) {
  let replacements = 0
  const output = removeRuntimeSourceReferences(source, 'pdfjs-runtime.mjs').output.replace(runtimeIdentifierPattern, (_match, name) => {
    replacements += 1
    return `__pdfjs_webpack_${name}__`
  })
  return {
    output: replacements > 0 ? `${pdfJsRuntimeModificationNotice}${output}` : output,
    replacements,
  }
}
