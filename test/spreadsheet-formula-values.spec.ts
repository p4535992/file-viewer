import { describe, expect, it } from 'vitest'
import type { WorkBook, WorkSheet } from 'styled-exceljs'
import { recoverUncachedFormulaValues } from '../packages/renderers/spreadsheet/src/spreadsheet/worker/sheetjs/formulaValues'

const workbook = (sheets: Record<string, any>): WorkBook => ({
  SheetNames: Object.keys(sheets),
  Sheets: sheets
})
const formula = (f: string) => ({ t: 'z', v: 0, w: '0', f })
const number = (v: number) => ({ t: 'n', v })

describe('uncached spreadsheet formula preview (#414)', () => {
  it.each(['sparse', 'array', 'data'])(
    'converts logical values to Excel text during concatenation in %s storage',
    (shape) => {
      // Microsoft calculation operators: ="A"&TRUE yields ATRUE, not Atrue.
      const flags = { A1: { t: 'b', v: true }, A2: { t: 'b', v: false } }
      const cells = {
        A1: formula('"A"&TRUE'),
        A2: formula('FALSE&""'),
        A3: formula('Flags!A1&""'),
        A4: formula('Flags!A2&""'),
        A5: formula('IF(Flags!A1,TRUE,FALSE)&"X"'),
        A6: formula('IF(Flags!A2,TRUE,FALSE)&""'),
        A7: formula('A1&":"&A4'),
        A8: formula('"true"&FALSE'),
        A9: { t: 's', f: 'TRUE&""', v: 'authored', w: 'authored' },
        A10: formula('A9&Flags!A1'),
        A11: formula('IF(TRUE,"lower",UNKNOWN())&FALSE'),
        A12: formula('0&":"&Z1')
      }
      const deps = {
        A1: formula('Values!A7&Flags!A2'),
        A2: formula('IF(Values!A3="TRUE","yes","no")')
      }
      const storage = (source: Record<string, any>) => {
        const rows = [] as any[][]
        for (const [address, cell] of Object.entries(source))
          rows[Number(address.slice(1)) - 1] = [cell]
        return shape === 'sparse' ? source : shape === 'array' ? rows : { '!data': rows }
      }
      const cached = structuredClone(cells.A9),
        originalFlags = structuredClone(flags)
      expect(
        recoverUncachedFormulaValues(
          workbook({ Flags: storage(flags), Values: storage(cells), Deps: storage(deps) })
        )
      ).toEqual({ calculated: 13, unavailable: 0 })
      expect(Object.values(cells).map((cell) => cell.v)).toEqual([
        'ATRUE',
        'FALSE',
        'TRUE',
        'FALSE',
        'TRUEX',
        'FALSE',
        'ATRUE:FALSE',
        'trueFALSE',
        'authored',
        'authoredTRUE',
        'lowerFALSE',
        '0:'
      ])
      expect([deps.A1.v, deps.A2.v]).toEqual(['ATRUE:FALSEFALSE', 'yes'])
      expect(cells.A9).toEqual(cached)
      expect(flags).toEqual(originalFlags)
    }
  )
  it.each(['sparse', 'array', 'data'])(
    'preserves Excel zero-power errors and dependent formulas in %s storage',
    (shape) => {
      // Office MS-OI29500 section18.17.7.255: POWER(0,0) returns #NUM!.
      // Do not let JavaScript's finite0**0===1 become a fabricated preview.
      const power = {
        A1: formula('0^0'),
        A2: formula('A1+1'),
        A3: formula('SUM(A1,5)'),
        A4: formula('0^-1'),
        A5: formula('(-1)^0.5'),
        A6: formula('2^0'),
        A7: formula('0^2'),
        A8: formula('IF(FALSE,0^0,7)'),
        A9: formula('Z1^Z2'),
        A10: formula('(-0)^0'),
        A11: formula('"0"^"0"'),
        A12: { t: 'n', f: '0^0', v: 0, w: '0.0000' },
        A13: { t: 'e', f: '0^0', v: 36, w: '#NUM!' },
        A14: formula('A12+1'),
        A15: formula('IF(TRUE,1,0^0)'),
        A16: formula('IF(TRUE,0^0,1)')
      }
      const dependent = { A1: formula('Power!A1+9') }
      const storage = (cells: Record<string, any>) => {
        const rows = [] as any[][]
        for (const [address, cell] of Object.entries(cells))
          rows[Number(address.slice(1)) - 1] = [cell]
        return shape === 'sparse' ? cells : shape === 'array' ? rows : { '!data': rows }
      }
      const cached = [structuredClone(power.A12), structuredClone(power.A13)]
      expect(
        recoverUncachedFormulaValues(workbook({ Power: storage(power), Deps: storage(dependent) }))
      ).toEqual({ calculated: 5, unavailable: 10 })
      for (const address of ['A1', 'A2', 'A3', 'A4', 'A5', 'A9', 'A10', 'A11', 'A16']) {
        const cell = power[address as keyof typeof power]
        expect(cell.w).toBe(`=${cell.f}`)
      }
      expect(dependent.A1.w).toBe('=Power!A1+9')
      expect([power.A6.v, power.A7.v, power.A8.v, power.A14.v, power.A15.v]).toEqual([
        1, 0, 7, 1, 1
      ])
      expect([power.A12, power.A13]).toEqual(cached)
    }
  )
  it('distinguishes blanks from empty text and rejects JavaScript-only numeric coercions', () => {
    const cells = {
      A1: formula('Z1+1'),
      A2: formula('""+1'),
      A3: formula('"0x10"+1'),
      A4: { t: 's', v: '' },
      A5: formula('A4+1')
    }
    expect(recoverUncachedFormulaValues(workbook({ Sheet: cells }))).toEqual({
      calculated: 1,
      unavailable: 3
    })
    expect(cells.A1.v).toBe(1)
    for (const cell of [cells.A2, cells.A3, cells.A5]) expect(cell.w).toBe(`=${cell.f}`)
  })
  it('recovers nested IF/ROUND/ROW/SUM and cross-sheet results without cached values', () => {
    const source = {
      G2: { t: 's', v: 'ILF' },
      H2: formula('IF(G2="ILF",10,IF(G2="EIF",7,0))'),
      H3: number(1113),
      H211: formula('SUM(H2:H210)'),
      K2: formula('ROUND(H2*2/3,2)*0.8'),
      A2: formula('ROW()-1')
    }
    const target = {
      C2: formula('功能点计数表!H211'),
      C3: formula('功能点计数表!K2'),
      C4: formula('1.277*(C2/8/22)^0.404')
    }
    const book = workbook({ 功能点计数表: source, 费用测算表: target })
    expect(recoverUncachedFormulaValues(book)).toEqual({ calculated: 7, unavailable: 0 })
    expect(target.C2.v).toBe(1123)
    expect(target.C3.v).toBeCloseTo(5.336)
    expect(source.A2.v).toBe(1)
    expect(target.C4.v).toBeCloseTo(1.277 * (1123 / 8 / 22) ** 0.404)
  })
  it('keeps cached real zero, strings and stale-but-authored results authoritative', () => {
    const sheet = {
      A1: { t: 'n', f: '999', v: 0, w: '0.00' },
      A2: { t: 's', f: '"x"', v: '', w: '' },
      A3: { t: 'n', f: '1+1', v: 17, w: '17' },
      B1: formula('A1+1')
    }
    const before = structuredClone(sheet.A1)
    recoverUncachedFormulaValues(workbook({ Sheet: sheet }))
    expect(sheet.A1).toEqual(before)
    expect(sheet.A2.v).toBe('')
    expect(sheet.A3.v).toBe(17)
    expect(sheet.B1.v).toBe(1)
  })
  it('retains styles and number formats instead of displaying the synthetic zero', () => {
    const cell = { ...formula('1123'), z: '0.0000', s: { fill: { fgColor: { rgb: 'FF0000' } } } }
    const style = structuredClone(cell.s)
    recoverUncachedFormulaValues(workbook({ Sheet: { A1: cell } }))
    expect(cell.v).toBe(1123)
    expect(cell.w).toBe('1123.0000')
    expect(cell.s).toEqual(style)
  })
  it('resolves quoted Unicode/apostrophe sheet names, absolute cells and case insensitive names', () => {
    const cell = formula("'O''Brien 参数'!$B$2 + other!A1")
    recoverUncachedFormulaValues(
      workbook({
        "O'Brien 参数": { B2: number(4) },
        Other: { A1: number(5) },
        Target: { A1: cell }
      })
    )
    expect(cell.v).toBe(9)
  })
  it('selects IF lazily and preserves Excel text comparisons and negative ROUND ties', () => {
    const sheet = {
      A1: formula('IF("ilf"="ILF",ROUND(-1.005,2),1/0)'),
      A2: formula('IF(FALSE,UNKNOWN(),TRUE)'),
      A3: formula('IF(0,"bad","good")'),
      A4: formula('SUM(1,2,50%,-2^2)'),
      A5: formula('2^3^2')
    }
    recoverUncachedFormulaValues(workbook({ Sheet: sheet }))
    expect(sheet.A1.v).toBe(-1.01)
    expect(sheet.A2.v).toBe(true)
    expect(sheet.A3.v).toBe('good')
    expect(sheet.A4.v).toBe(7.5)
    expect(sheet.A5.v).toBe(64)
  })
  it.each(['sparse', 'array', 'data'])('works with %s worksheet storage', (shape) => {
    const cell = formula('SUM(A1:A2)')
    const rows = [[number(3)], [number(4)], [cell]]
    const sheet =
      shape === 'sparse'
        ? { A1: rows[0][0], A2: rows[1][0], A3: cell }
        : shape === 'array'
          ? rows
          : { '!data': rows }
    recoverUncachedFormulaValues(workbook({ Sheet: sheet as WorkSheet }))
    expect(cell.v).toBe(7)
  })
  it('shows cyclic, missing-sheet, unsupported, error and external formulas explicitly', () => {
    const formulas = [
      'B1+1',
      'A1+1',
      'NoSheet!A1',
      'SUM(A5)',
      'SUM(A6)',
      'NOW()',
      '[Book.xlsx]Sheet!A1',
      '1/0',
      'SUM(1+)',
      'UNKNOWN()'
    ]
    const cells = Object.fromEntries(
      formulas.map((f, i) => [i === 0 ? 'A1' : i === 1 ? 'B1' : `A${i + 1}`, formula(f)])
    )
    cells.A5 = { t: 'e', v: 7 } as any
    const result = recoverUncachedFormulaValues(workbook({ Sheet: cells }))
    expect(result.unavailable).toBe(9)
    for (const cell of Object.values(cells)) if (cell.f) expect(cell.w).toBe(`=${cell.f}`)
  })
  it('never evaluates JavaScript and bounds formula depth, length and enormous ranges', () => {
    const values = [
      'globalThis.fetch("https://invalid.test")',
      'SUM(A1:XFD1048576)',
      '('.repeat(150) + '1' + ')'.repeat(150),
      '1+'.repeat(5000) + '1'
    ]
    const cells = Object.fromEntries(values.map((f, i) => [`B${i + 1}`, formula(f)]))
    expect(recoverUncachedFormulaValues(workbook({ Sheet: cells }))).toEqual({
      calculated: 0,
      unavailable: values.length
    })
    for (const cell of Object.values(cells)) expect(cell.w).toBe(`=${cell.f}`)
  })
})
