import type {
  FileRenderContext,
  FileViewerPrettyPrintRule
} from '@file-viewer/core'

export const DEFAULT_FILE_VIEWER_PRETTY_PRINT_MAX_BYTES = 512 * 1024

export type FileViewerPrettierRuntimeModule =
  | 'babel'
  | 'estree'
  | 'glimmer'
  | 'graphql'
  | 'html'
  | 'markdown'
  | 'postcss'
  | 'typescript'
  | 'yaml'

export interface FileViewerPrettyPrintPlan {
  parser: string;
  modules: readonly FileViewerPrettierRuntimeModule[];
  options?: Readonly<Record<string, unknown>>;
}

export interface FileViewerPrettyPrintRequest {
  source: string;
  sourceByteLength: number;
  extension?: string;
  filename?: string;
  context?: FileRenderContext;
}

export interface FileViewerPrettyPrintResult {
  text: string;
  formatted: boolean;
  parser?: string;
}

type PrettierPlugin = Record<string, unknown>

type PrettierRuntime = {
  format: (
    source: string,
    options: Readonly<Record<string, unknown>>
  ) => string | Promise<string>;
}

type RuntimeModuleNamespace = Record<string, unknown> & {
  default?: unknown;
}

const javascriptPlan: FileViewerPrettyPrintPlan = {
  parser: 'babel',
  modules: ['babel', 'estree']
}

const jsonPlan: FileViewerPrettyPrintPlan = {
  parser: 'json',
  modules: ['babel', 'estree']
}

const typescriptPlan: FileViewerPrettyPrintPlan = {
  parser: 'typescript',
  modules: ['typescript', 'estree']
}

const htmlPlan: FileViewerPrettyPrintPlan = {
  parser: 'html',
  modules: ['html', 'babel', 'estree', 'typescript', 'postcss']
}

const vuePlan: FileViewerPrettyPrintPlan = {
  parser: 'vue',
  modules: ['html', 'babel', 'estree', 'typescript', 'postcss']
}

const xmlPlan: FileViewerPrettyPrintPlan = {
  // The bundled Prettier HTML parser is deliberately used in strict whitespace
  // mode. XML with xml:space="preserve" is rejected before the runtime loads.
  parser: 'html',
  modules: ['html'],
  options: {
    htmlWhitespaceSensitivity: 'strict'
  }
}

const prettierPlans: Readonly<Record<string, FileViewerPrettyPrintPlan>> = {
  cjs: javascriptPlan,
  js: javascriptPlan,
  jsx: javascriptPlan,
  mjs: javascriptPlan,
  react: javascriptPlan,
  json: jsonPlan,
  json5: {
    parser: 'json5',
    modules: ['babel', 'estree']
  },
  jsonc: {
    parser: 'jsonc',
    modules: ['babel', 'estree']
  },
  ipynb: {
    parser: 'json-stringify',
    modules: ['babel', 'estree']
  },
  cts: typescriptPlan,
  mts: typescriptPlan,
  ts: typescriptPlan,
  tsx: typescriptPlan,
  css: {
    parser: 'css',
    modules: ['postcss']
  },
  less: {
    parser: 'less',
    modules: ['postcss']
  },
  scss: {
    parser: 'scss',
    modules: ['postcss']
  },
  angular: {
    parser: 'angular',
    modules: ['html']
  },
  html: htmlPlan,
  htm: htmlPlan,
  vue: vuePlan,
  svg: xmlPlan,
  xhtml: xmlPlan,
  xml: xmlPlan,
  xsd: xmlPlan,
  xsl: xmlPlan,
  xslt: xmlPlan,
  md: {
    parser: 'markdown',
    modules: ['markdown']
  },
  markdown: {
    parser: 'markdown',
    modules: ['markdown']
  },
  mdx: {
    parser: 'mdx',
    modules: ['markdown']
  },
  yaml: {
    parser: 'yaml',
    modules: ['yaml']
  },
  yml: {
    parser: 'yaml',
    modules: ['yaml']
  },
  gql: {
    parser: 'graphql',
    modules: ['graphql']
  },
  graphql: {
    parser: 'graphql',
    modules: ['graphql']
  },
  handlebars: {
    parser: 'glimmer',
    modules: ['glimmer']
  },
  hbs: {
    parser: 'glimmer',
    modules: ['glimmer']
  }
}

const runtimeModuleLoaders: Record<
  FileViewerPrettierRuntimeModule,
  () => Promise<RuntimeModuleNamespace>
> = {
  babel: () => import('./prettier/babel.mjs'),
  estree: () => import('./prettier/estree.mjs'),
  glimmer: () => import('./prettier/glimmer.mjs'),
  graphql: () => import('./prettier/graphql.mjs'),
  html: () => import('./prettier/html.mjs'),
  markdown: () => import('./prettier/markdown.mjs'),
  postcss: () => import('./prettier/postcss.mjs'),
  typescript: () => import('./prettier/typescript.mjs'),
  yaml: () => import('./prettier/yaml.mjs')
}

let prettierRuntimePromise: Promise<PrettierRuntime> | null = null
const prettierPluginPromises = new Map<FileViewerPrettierRuntimeModule, Promise<PrettierPlugin>>()

const mimeTypeAliases: Readonly<Record<string, string>> = {
  'application/graphql': 'graphql',
  'application/javascript': 'js',
  'application/json': 'json',
  'application/json5': 'json5',
  'application/ld+json': 'json',
  'application/typescript': 'ts',
  'application/x-javascript': 'js',
  'application/xhtml+xml': 'xhtml',
  'application/xml': 'xml',
  'application/x-yaml': 'yaml',
  'image/svg+xml': 'svg',
  'text/css': 'css',
  'text/html': 'html',
  'text/json': 'json',
  'text/javascript': 'js',
  'text/markdown': 'md',
  'text/typescript': 'ts',
  'text/xml': 'xml',
  'text/yaml': 'yaml'
}

const normalizeMimeType = (value: string | undefined) => {
  const normalized = String(value || '').trim().toLowerCase().split(';', 1)[0] || ''
  return normalized.includes('/') ? normalized : ''
}

const normalizeExtension = (value: string | undefined) => {
  const raw = String(value || '').trim().toLowerCase()
  const mimeType = normalizeMimeType(raw)
  if (mimeType) {
    if (mimeTypeAliases[mimeType]) {
      return mimeTypeAliases[mimeType]
    }
    if (mimeType.endsWith('+json')) {
      return 'json'
    }
    if (mimeType.endsWith('+xml')) {
      return 'xml'
    }
    return ''
  }
  const clean = raw.split(/[?#]/, 1)[0] || ''
  const filename = clean.split(/[\\/]/).pop() || clean
  const extension = filename.includes('.')
    ? filename.slice(filename.lastIndexOf('.') + 1)
    : filename
  return extension.replace(/^\*?\./, '')
}

const extensionFromFilename = (filename: string | undefined) => {
  return normalizeExtension(filename)
}

const resolveFileViewerPrettyPrintExtension = (
  extension?: string,
  filename?: string
) => {
  const normalized = normalizeExtension(extension)
  if (prettierPlans[normalized]) {
    return normalized
  }
  const filenameExtension = extensionFromFilename(filename)
  return prettierPlans[filenameExtension] ? filenameExtension : normalized || filenameExtension
}

const normalizePrettyPrintRule = (
  value: FileViewerPrettyPrintRule | undefined
): FileViewerPrettyPrintRule => {
  const result: FileViewerPrettyPrintRule = {}
  if (
    Number.isInteger(value?.tabWidth) &&
    Number(value?.tabWidth) >= 1 &&
    Number(value?.tabWidth) <= 16
  ) {
    result.tabWidth = Number(value?.tabWidth)
  }
  if (typeof value?.useTabs === 'boolean') {
    result.useTabs = value.useTabs
  }
  if (
    Number.isInteger(value?.printWidth) &&
    Number(value?.printWidth) >= 1 &&
    Number(value?.printWidth) <= 1000
  ) {
    result.printWidth = Number(value?.printWidth)
  }
  if (
    value?.proseWrap === 'always' ||
    value?.proseWrap === 'never' ||
    value?.proseWrap === 'preserve'
  ) {
    result.proseWrap = value.proseWrap
  }
  return result
}

const findPrettyPrintRule = (
  rules: Readonly<Record<string, FileViewerPrettyPrintRule>> | undefined,
  value: string,
  normalizeKey: (key: string) => string
) => {
  if (!rules || !value) {
    return undefined
  }
  for (const [key, rule] of Object.entries(rules)) {
    if (normalizeKey(key) === value) {
      return rule
    }
  }
  return undefined
}

export const resolveFileViewerPrettyPrintOptions = (
  extension?: string,
  filename?: string,
  context?: FileRenderContext
): FileViewerPrettyPrintRule => {
  const configuration = context?.options?.text?.prettyPrintOptions
  if (!configuration) {
    return {}
  }

  const resolvedExtension = resolveFileViewerPrettyPrintExtension(extension, filename)
  const mimeType = [extension, context?.sourceFile?.type]
    .map(normalizeMimeType)
    .find(Boolean) || ''
  const extensionRule = findPrettyPrintRule(
    configuration.byExtension,
    resolvedExtension,
    normalizeExtension
  )
  const mimeTypeRule = findPrettyPrintRule(
    configuration.byMimeType,
    mimeType,
    normalizeMimeType
  )

  return {
    ...normalizePrettyPrintRule(configuration),
    ...normalizePrettyPrintRule(extensionRule),
    ...normalizePrettyPrintRule(mimeTypeRule)
  }
}

const isRuntime = (value: unknown): value is PrettierRuntime => {
  return Boolean(value && typeof (value as PrettierRuntime).format === 'function')
}

const normalizeRuntime = (module: RuntimeModuleNamespace): PrettierRuntime => {
  if (isRuntime(module)) {
    return module
  }
  if (isRuntime(module.default)) {
    return module.default
  }
  throw new Error('The packaged Prettier standalone runtime does not expose format().')
}

const normalizePlugin = (module: RuntimeModuleNamespace): PrettierPlugin => {
  const candidate = module.default
  return candidate && typeof candidate === 'object'
    ? candidate as PrettierPlugin
    : module
}

const loadPrettierRuntime = () => {
  if (!prettierRuntimePromise) {
    prettierRuntimePromise = import('./prettier/standalone.mjs').then(normalizeRuntime)
  }
  return prettierRuntimePromise
}

const loadPrettierPlugin = (name: FileViewerPrettierRuntimeModule) => {
  const cached = prettierPluginPromises.get(name)
  if (cached) {
    return cached
  }
  const promise = runtimeModuleLoaders[name]().then(normalizePlugin)
  prettierPluginPromises.set(name, promise)
  return promise
}

const isConservativeXmlFallback = (extension: string, source: string) => {
  return ['svg', 'xhtml', 'xml', 'xsd', 'xsl', 'xslt'].includes(extension) &&
    /\bxml:space\s*=\s*(["'])preserve\1/i.test(source)
}

export const resolveFileViewerPrettyPrintPlan = (
  extension?: string,
  filename?: string
): FileViewerPrettyPrintPlan | null => {
  return prettierPlans[resolveFileViewerPrettyPrintExtension(extension, filename)] || null
}

export const resolveFileViewerPrettyPrintMaxBytes = (context?: FileRenderContext) => {
  const configured = context?.options?.text?.prettyPrintMaxBytes
  if (Number.isFinite(configured)) {
    return Math.max(0, Number(configured))
  }
  const virtualizationThreshold = context?.options?.text?.virtualizeAboveBytes
  return Number.isFinite(virtualizationThreshold)
    ? Math.max(0, Number(virtualizationThreshold))
    : DEFAULT_FILE_VIEWER_PRETTY_PRINT_MAX_BYTES
}

export const shouldAttemptFileViewerPrettyPrint = (
  sourceByteLength: number,
  extension?: string,
  context?: FileRenderContext,
  filename?: string
) => {
  return context?.options?.text?.prettyPrint === true &&
    Number.isFinite(sourceByteLength) &&
    sourceByteLength >= 0 &&
    sourceByteLength <= resolveFileViewerPrettyPrintMaxBytes(context) &&
    resolveFileViewerPrettyPrintPlan(extension, filename) !== null
}

export const formatFileViewerTextForDisplay = async ({
  source,
  sourceByteLength,
  extension,
  filename,
  context
}: FileViewerPrettyPrintRequest): Promise<FileViewerPrettyPrintResult> => {
  const normalizedExtension = resolveFileViewerPrettyPrintExtension(extension, filename)
  const plan = resolveFileViewerPrettyPrintPlan(normalizedExtension, filename)
  if (
    !plan ||
    !shouldAttemptFileViewerPrettyPrint(sourceByteLength, normalizedExtension, context, filename) ||
    isConservativeXmlFallback(normalizedExtension, source)
  ) {
    return { text: source, formatted: false }
  }

  try {
    // Both the standalone runtime and parser modules stay outside the normal
    // text path. The size and format gates above run before these imports.
    const [prettier, plugins] = await Promise.all([
      loadPrettierRuntime(),
      Promise.all(plan.modules.map(loadPrettierPlugin))
    ])
    const formattingOptions = resolveFileViewerPrettyPrintOptions(
      extension,
      filename,
      context
    )
    const text = await prettier.format(source, {
      parser: plan.parser,
      plugins,
      filepath: filename,
      endOfLine: 'lf',
      ...formattingOptions,
      // Parser-specific safety settings, such as strict XML whitespace
      // sensitivity, remain authoritative.
      ...plan.options
    })
    return typeof text === 'string'
      ? { text, formatted: true, parser: plan.parser }
      : { text: source, formatted: false }
  } catch {
    return { text: source, formatted: false }
  }
}
