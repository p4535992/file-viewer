// Runtime-only artifacts must not retain esbuild's physical module-path labels.
// Legal comments remain in the output, and complete grants retain their notices.
export function browserRuntimeOptions(mode = process.env.FILE_VIEWER_DISTRIBUTION_MODE) {
  return { minify: mode === 'runtime-only', legalComments: 'eof' }
}

export function browserLibraryDefines() {
  // Deployment URLs belong to explicit library options, not the host bundler.
  return { 'process.env.PUBLIC_URL': 'undefined' }
}
