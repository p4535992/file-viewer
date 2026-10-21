import type { HLJSApi, LanguageFn } from 'highlight.js'

const languageMap: Record<string, string> = {
  xhtml: 'xml',
  rss: 'xml',
  atom: 'xml',
  xjb: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  plist: 'xml',
  wsf: 'xml',
  svg: 'xml',
  zsh: 'bash',
  'c++': 'cpp',
  'h++': 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cxx: 'cpp',
  'c#': 'csharp',
  mkdown: 'markdown',
  mkd: 'markdown',
  gemspec: 'ruby',
  podspec: 'ruby',
  thor: 'ruby',
  irb: 'ruby',
  golang: 'go',
  jsp: 'java',
  kts: 'kotlin',
  ktm: 'kotlin',
  ktx: 'kotlin',
  pluto: 'lua',
  mk: 'makefile',
  mak: 'makefile',
  make: 'makefile',
  pl: 'perl',
  pm: 'perl',
  mm: 'objectivec',
  objc: 'objectivec',
  'obj-c': 'objectivec',
  'obj-c++': 'objectivec',
  'objective-c++': 'objectivec',
  text: 'plaintext',
  gyp: 'python',
  ipython: 'python',
  pycon: 'python-repl',
  console: 'shell',
  shellsession: 'shell',
  mts: 'typescript',
  cts: 'typescript',
  vb: 'vbnet',
  bash: 'bash',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  diff: 'diff',
  patch: 'diff',
  bundle: 'plaintext',
  bdl: 'plaintext',
  gv: 'plaintext',
  go: 'go',
  graphql: 'graphql',
  gql: 'graphql',
  h: 'c',
  hcl: 'plaintext',
  hpp: 'cpp',
  html: 'xml',
  htm: 'xml',
  http: 'http',
  ini: 'ini',
  ipynb: 'json',
  java: 'java',
  js: 'javascript',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  log: 'plaintext',
  md: 'markdown',
  markdown: 'markdown',
  mjs: 'javascript',
  php: 'php',
  proto: 'protobuf',
  py: 'python',
  rb: 'ruby',
  react: 'javascript',
  rs: 'rust',
  sh: 'bash',
  sql: 'sql',
  swift: 'swift',
  tex: 'latex',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'plaintext',
  vue: 'xml',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml'
}

type GrammarFamily = {
  names: string[]
  load: () => Promise<{ default: Record<string, LanguageFn> }>
}

// Defer by language family without turning every small grammar into a request.
const grammarFamilies: GrammarFamily[] = [
  {
    names: ['c', 'cpp', 'objectivec', 'rust', 'swift', 'go', 'wasm'],
    load: () => import('./syntaxGrammars/native.js')
  },
  {
    names: ['java', 'kotlin', 'csharp', 'vbnet'],
    load: () => import('./syntaxGrammars/managed.js')
  },
  {
    names: ['javascript', 'typescript', 'css', 'less', 'scss'],
    load: () => import('./syntaxGrammars/web.js')
  },
  {
    names: ['python', 'python-repl', 'ruby', 'perl', 'lua', 'r'],
    load: () => import('./syntaxGrammars/scripting.js')
  },
  {
    names: ['bash', 'shell', 'makefile', 'ini', 'diff'],
    load: () => import('./syntaxGrammars/tooling.js')
  },
  {
    names: ['json', 'yaml', 'xml', 'http', 'protobuf', 'graphql', 'sql'],
    load: () => import('./syntaxGrammars/data.js')
  },
  { names: ['php', 'php-template'], load: () => import('./syntaxGrammars/php.js') },
  { names: ['markdown', 'latex'], load: () => import('./syntaxGrammars/documents.js') }
]

const languageLoaders: Record<string, () => Promise<{ default: LanguageFn }>> = Object.fromEntries(
  grammarFamilies.flatMap(({ names, load }) =>
    names.map((name) => [name, async () => ({ default: (await load()).default[name] })])
  )
)

let highlighterPromise: Promise<HLJSApi> | null = null
const registeredLanguages = new Set<string>()

export const resolveLanguage = (type: string) => {
  const normalized = type.trim().toLowerCase()
  return languageMap[normalized] || (languageLoaders[normalized] ? normalized : 'plaintext')
}

export const escapeHtml = (value: string) => {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return entities[char]
  })
}

export const loadHighlighter = async () => {
  if (!highlighterPromise) {
    highlighterPromise = import('highlight.js/lib/core').then((module) => module.default)
  }
  return highlighterPromise
}

export const registerLanguageOnce = async (hljs: HLJSApi, name: string) => {
  if (registeredLanguages.has(name)) {
    return true
  }
  const loader = languageLoaders[name]
  if (!loader) {
    return false
  }
  const { default: language } = await loader()
  hljs.registerLanguage(name, language)
  registeredLanguages.add(name)
  return true
}
