import type { CellObject, WorkBook, WorkSheet } from 'styled-exceljs'
import { utils } from 'styled-exceljs'

// Preview recovery, not a replacement for Excel calculation. Cached values are
// authoritative. Unsupported or expensive uncached formulas remain visible as
// formula text, rather than displaying the reader's synthetic zero stub.
type Value = number | string | boolean | null
type Node =
  | { kind: 'value'; value: Value }
  | { kind: 'ref'; sheet?: string; address: string; end?: string }
  | { kind: 'unary'; op: string; value: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] }
type Token = { kind: string; text: string }
const MAX_STEPS = 2_000_000
const MAX_DEPTH = 128
const ADDRESS = /^\$?([A-Z]{1,3})\$?([1-9][0-9]*)$/i
const unavailable = (): never => {
  throw new Error('Formula value unavailable')
}

function tokenize(formula: string): Token[] {
  if (formula.length > 8192) return unavailable()
  const tokens: Token[] = []
  let rest = formula.replace(/^=/, '')
  while (rest.length) {
    const space = /^\s+/.exec(rest)
    if (space) {
      rest = rest.slice(space[0].length)
      continue
    }
    const match =
      /^(?:"(?:[^"]|"")*"|'(?:[^']|'')*'|(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?|[\p{L}_$\\][\p{L}\p{N}_.$\\]*|<>|<=|>=|[+\-*/^&=<>%(),!:])/u.exec(
        rest
      )
    if (!match || tokens.length >= 4096) return unavailable()
    const text = match[0]
    tokens.push({
      kind:
        text[0] === '"'
          ? 'string'
          : text[0] === "'"
            ? 'quoted'
            : /^[\d.]/.test(text)
              ? 'number'
              : /^[\p{L}_$\\]/u.test(text)
                ? 'name'
                : text,
      text
    })
    rest = rest.slice(text.length)
  }
  tokens.push({ kind: 'eof', text: '' })
  return tokens
}

class FormulaParser {
  private index = 0
  private depth = 0
  constructor(private tokens: Token[]) {}
  private current() {
    return this.tokens[this.index]
  }
  private take(kind: string) {
    if (this.current().kind !== kind) return false
    this.index++
    return true
  }
  parse(): Node {
    const result = this.expression()
    if (this.current().kind !== 'eof') return unavailable()
    return result
  }
  private expression(minimum = 0): Node {
    if (++this.depth > MAX_DEPTH) return unavailable()
    let left = this.primary()
    const precedence: Record<string, number> = {
      '=': 1,
      '<>': 1,
      '<': 1,
      '>': 1,
      '<=': 1,
      '>=': 1,
      '&': 2,
      '+': 3,
      '-': 3,
      '*': 4,
      '/': 4,
      '^': 5
    }
    while ((precedence[this.current().kind] ?? -1) >= minimum) {
      const op = this.tokens[this.index++].kind
      // Excel exponentiation is left associative.
      left = { kind: 'binary', op, left, right: this.expression(precedence[op] + 1) }
    }
    this.depth--
    return left
  }
  private primary(): Node {
    const token = this.tokens[this.index++]
    let result: Node
    if (token.kind === '+' || token.kind === '-') {
      result = { kind: 'unary', op: token.kind, value: this.expression(6) }
    } else if (token.kind === 'number') {
      const value = Number(token.text)
      if (!Number.isFinite(value)) return unavailable()
      result = { kind: 'value', value }
    } else if (token.kind === 'string') {
      result = { kind: 'value', value: token.text.slice(1, -1).replace(/""/g, '"') }
    } else if (token.kind === '(') {
      result = this.expression()
      if (!this.take(')')) return unavailable()
    } else if (token.kind === 'name' || token.kind === 'quoted') {
      if (token.kind === 'name' && this.take('(')) {
        const args: Node[] = []
        if (!this.take(')')) {
          do {
            args.push(this.expression())
          } while (this.take(','))
          if (!this.take(')')) return unavailable()
        }
        result = { kind: 'call', name: token.text.toUpperCase(), args }
      } else {
        let address = token.text
        let sheet: string | undefined
        if (this.take('!')) {
          sheet = token.kind === 'quoted' ? token.text.slice(1, -1).replace(/''/g, "'") : token.text
          address = this.tokens[this.index++].text
        } else if (/^(TRUE|FALSE)$/i.test(address)) {
          return { kind: 'value', value: address.toUpperCase() === 'TRUE' }
        }
        if (!ADDRESS.test(address)) return unavailable()
        let end: string | undefined
        if (this.take(':')) {
          end = this.tokens[this.index++].text
          if (!ADDRESS.test(end)) return unavailable()
        }
        result = { kind: 'ref', sheet, address, end }
      }
    } else return unavailable()
    while (this.take('%')) result = { kind: 'unary', op: '%', value: result }
    return result
  }
}

const position = (address: string) => {
  const match = ADDRESS.exec(address)
  if (!match) return unavailable()
  let col = 0
  for (const char of match[1].toUpperCase()) col = col * 26 + char.charCodeAt(0) - 64
  const row = Number(match[2])
  if (col > 16384 || row > 1048576) return unavailable()
  return { row: row - 1, col: col - 1 }
}
const key = (row: number, col: number) => `${row}:${col}`
const numeric = (value: Value): number => {
  if (value === null) return 0
  if (typeof value === 'boolean') return value ? 1 : 0
  // Blank cells use null. Empty strings and JavaScript-only hexadecimal text
  // are not Excel arithmetic numbers and must not silently become 0 or 16.
  if (
    typeof value === 'string' &&
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(value.trim())
  )
    return unavailable()
  const number = typeof value === 'string' ? Number(value.trim()) : value
  if (!Number.isFinite(number)) return unavailable()
  return number
}
const scalar = (value: Value | Value[]): Value => (Array.isArray(value) ? unavailable() : value)
const textValue = (value: Value): string =>
  typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value ?? '')
const needsValue = (cell: CellObject) =>
  !!cell.f && (cell.t === 'z' || cell.v === undefined || cell.v === null)

function cellsOf(sheet: WorkSheet): Map<string, CellObject> {
  const result = new Map<string, CellObject>()
  const data = Array.isArray(sheet)
    ? sheet
    : (sheet as WorkSheet & { '!data'?: CellObject[][] })['!data']
  if (data) {
    for (const rowKey of Object.keys(data)) {
      const row = Number(rowKey)
      if (!Number.isInteger(row) || row < 0 || !Array.isArray(data[row])) continue
      for (const colKey of Object.keys(data[row])) {
        const col = Number(colKey),
          cell = data[row][col]
        if (Number.isInteger(col) && col >= 0 && cell && needsValue(cell))
          result.set(key(row, col), cell)
      }
    }
  } else {
    for (const address of Object.keys(sheet)) {
      if (!ADDRESS.test(address)) continue
      const { row, col } = position(address)
      if (sheet[address] && needsValue(sheet[address])) result.set(key(row, col), sheet[address])
    }
  }
  return result
}

export function recoverUncachedFormulaValues(workbook: WorkBook) {
  const sheets = new Map(
    workbook.SheetNames.map((name) => [
      name.toLowerCase(),
      { name, sheet: workbook.Sheets[name], cells: cellsOf(workbook.Sheets[name]) }
    ])
  )
  const results = new Map<CellObject, Value>()
  const failed = new Set<CellObject>()
  const visiting = new Set<CellObject>()
  let steps = 0
  const tick = () => {
    if (++steps > MAX_STEPS) return unavailable()
  }
  const resolveSheet = (name: string) => sheets.get(name.toLowerCase()) ?? unavailable()
  const readCell = (name: string, row: number, col: number, depth: number): Value => {
    tick()
    if (depth > MAX_DEPTH) return unavailable()
    const { sheet } = resolveSheet(name)
    const data = Array.isArray(sheet)
      ? sheet
      : (sheet as WorkSheet & { '!data'?: CellObject[][] })['!data']
    const cell: CellObject | undefined = data
      ? data[row]?.[col]
      : sheet[utils.encode_cell({ r: row, c: col })]
    if (!cell) return null
    if (results.has(cell)) return results.get(cell)!
    if (failed.has(cell) || visiting.has(cell) || cell.t === 'e') return unavailable()
    if (!needsValue(cell)) {
      if (cell.v instanceof Date) return unavailable()
      const value = cell.v ?? null
      return typeof value === 'number' && !Number.isFinite(value) ? unavailable() : value
    }
    visiting.add(cell)
    try {
      const tree = new FormulaParser(tokenize(cell.f!)).parse()
      const value = scalar(evaluate(tree, name, row, depth + 1))
      if (typeof value === 'number' && !Number.isFinite(value)) return unavailable()
      results.set(cell, value)
      return value
    } catch {
      failed.add(cell)
      return unavailable()
    } finally {
      visiting.delete(cell)
    }
  }
  const evaluate = (node: Node, sheet: string, row: number, depth: number): Value | Value[] => {
    tick()
    if (depth > MAX_DEPTH) return unavailable()
    const run = (child: Node) => evaluate(child, sheet, row, depth + 1)
    if (node.kind === 'value') return node.value
    if (node.kind === 'ref') {
      const start = position(node.address)
      if (!node.end) return readCell(node.sheet ?? sheet, start.row, start.col, depth + 1)
      const end = position(node.end)
      const minRow = Math.min(start.row, end.row),
        maxRow = Math.max(start.row, end.row)
      const minCol = Math.min(start.col, end.col),
        maxCol = Math.max(start.col, end.col)
      if ((maxRow - minRow + 1) * (maxCol - minCol + 1) > MAX_STEPS - steps) return unavailable()
      const values: Value[] = []
      for (let r = minRow; r <= maxRow; r++)
        for (let c = minCol; c <= maxCol; c++)
          values.push(readCell(node.sheet ?? sheet, r, c, depth + 1))
      return values
    }
    if (node.kind === 'unary') {
      const number = numeric(scalar(run(node.value)))
      return node.op === '-' ? -number : node.op === '%' ? number / 100 : number
    }
    if (node.kind === 'binary') {
      const left = scalar(run(node.left)),
        right = scalar(run(node.right))
      if (node.op === '&') return textValue(left) + textValue(right)
      if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) {
        // Excel compares text without case sensitivity. Different value types
        // are ordered number < text < logical; empty cells take the other type.
        const normalize = (value: Value, other: Value): number | string | boolean =>
          value === null
            ? typeof other === 'string'
              ? ''
              : typeof other === 'boolean'
                ? false
                : 0
            : typeof value === 'string'
              ? value.toUpperCase()
              : value
        const a = normalize(left, right),
          b = normalize(right, left)
        const rank = (value: unknown) =>
          typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : 2
        const comparison =
          typeof a === typeof b ? (a === b ? 0 : a < b ? -1 : 1) : rank(a) - rank(b)
        return node.op === '='
          ? comparison === 0
          : node.op === '<>'
            ? comparison !== 0
            : node.op === '<'
              ? comparison < 0
              : node.op === '>'
                ? comparison > 0
                : node.op === '<='
                  ? comparison <= 0
                  : comparison >= 0
      }
      const a = numeric(left),
        b = numeric(right)
      if (node.op === '/' && b === 0) return unavailable()
      // Office POWER(0,0) is an error, unlike JavaScript's finite result1.
      if (node.op === '^' && a === 0 && b === 0) return unavailable()
      const value =
        node.op === '+'
          ? a + b
          : node.op === '-'
            ? a - b
            : node.op === '*'
              ? a * b
              : node.op === '/'
                ? a / b
                : a ** b
      return Number.isFinite(value) ? value : unavailable()
    }
    if (node.name === 'IF' && (node.args.length === 2 || node.args.length === 3)) {
      const condition = scalar(run(node.args[0]))
      if (typeof condition === 'string' && !/^(TRUE|FALSE)$/i.test(condition)) return unavailable()
      const truthy =
        typeof condition === 'string' ? condition.toUpperCase() === 'TRUE' : !!condition
      return truthy ? run(node.args[1]) : node.args[2] ? run(node.args[2]) : false
    }
    if (node.name === 'ROW' && node.args.length <= 1) {
      if (!node.args.length) return row + 1
      const ref = node.args[0]
      if (ref.kind !== 'ref') return unavailable()
      if (ref.sheet) resolveSheet(ref.sheet)
      return position(ref.address).row + 1
    }
    if (node.name === 'ROUND' && node.args.length === 2) {
      const value = numeric(scalar(run(node.args[0])))
      const digits = Math.trunc(numeric(scalar(run(node.args[1]))))
      if (Math.abs(digits) > 100) return unavailable()
      const scale = 10 ** digits,
        magnitude = Math.abs(value) * scale
      const rounded = Math.floor(magnitude + 0.5 + Number.EPSILON * magnitude) / scale
      return Number.isFinite(rounded) ? Math.sign(value) * rounded : unavailable()
    }
    if (node.name === 'SUM' && node.args.length > 0) {
      let total = 0
      for (const arg of node.args) {
        const value = run(arg)
        if (Array.isArray(value)) {
          for (const entry of value) if (typeof entry === 'number') total += entry
        } else if (arg.kind === 'ref') {
          if (typeof value === 'number') total += value
        } else total += numeric(value)
      }
      return Number.isFinite(total) ? total : unavailable()
    }
    return unavailable()
  }
  let calculated = 0,
    unavailableCount = 0
  for (const { name, cells } of sheets.values())
    for (const [location, cell] of cells) {
      if (!needsValue(cell)) continue
      const [row, col] = location.split(':').map(Number)
      try {
        readCell(name, row, col, 0)
      } catch {
        /* keep the original formula visible */
      }
    }
  for (const { cells } of sheets.values())
    for (const cell of cells.values()) {
      if (!needsValue(cell)) continue
      if (results.has(cell)) {
        const value = results.get(cell) ?? 0
        cell.v = value
        cell.t = typeof value === 'boolean' ? 'b' : typeof value === 'string' ? 's' : 'n'
        // The parser may have produced w="0" for an empty cached value.
        delete cell.w
        try {
          cell.w = utils.format_cell(cell)
        } catch {
          /* plain value is still available */
        }
        calculated++
      } else {
        cell.w = `=${cell.f}`
        unavailableCount++
      }
    }
  return { calculated, unavailable: unavailableCount }
}
