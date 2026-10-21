import ts from 'typescript'

// Examine JavaScript comments rather than strings or regular expressions which
// legitimately mention the browser's sourceURL/sourceMappingURL API.
export function runtimeSourceReferenceComments(source, path = 'runtime.js') {
  if (!/\b(?:sourceMappingURL|sourceURL)\s*=/.test(source)) return []
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (parsed.parseDiagnostics.length) throw new Error(`Cannot inspect runtime JavaScript metadata: ${path}`)
  const ranges = new Map()
  const visit = node => {
    for (const range of [...(ts.getLeadingCommentRanges(source, node.pos) || []),
      ...(ts.getTrailingCommentRanges(source, node.end) || [])]) {
      if (/\b(?:sourceMappingURL|sourceURL)\s*=/.test(source.slice(range.pos, range.end))) ranges.set(range.pos, range)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return [...ranges.values()].sort((a, b) => a.pos - b.pos)
}

export function removeRuntimeSourceReferences(source, path) {
  const comments = runtimeSourceReferenceComments(source, path)
  let output = source
  for (const { pos, end } of comments.toReversed()) output = output.slice(0, pos) + output.slice(end)
  return { output, referencesRemoved: comments.length }
}
