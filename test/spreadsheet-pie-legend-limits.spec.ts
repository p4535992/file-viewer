import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { renderSpreadsheetChart } from '../packages/renderers/spreadsheet/src/spreadsheet/chartRenderer'
import type { SheetChart } from '../packages/renderers/spreadsheet/src/spreadsheet/worker/type'

describe('spreadsheet category legend limits', () => {
  it.each(['pie', 'doughnut'] as const)('%s only materializes visible category entries', type => {
    const dom = new JSDOM()
    try {
      let categoryReads = 0
      const categories = new Proxy(
        Array.from({ length: 10_000 }, (_, index) => `Category ${index + 1}`),
        {
          get(target, property, receiver) {
            if (typeof property === 'string' && /^\d+$/.test(property)) categoryReads++
            return Reflect.get(target, property, receiver)
          }
        }
      )
      const chart: SheetChart = {
        id: 'large-category-cache', type, left: 0, top: 0, width: 640, height: 360, row: 0, col: 0,
        legendPosition: 'right',
        series: [{ name: 'Revenue', categories, values: Array(10_000).fill(0) }]
      }
      const element = renderSpreadsheetChart(dom.window.document, chart)
      const labels = Array.from(element.querySelectorAll('text[x="528"]')).map(node => node.textContent)

      expect(labels).toEqual(Array.from({ length: 8 }, (_, index) => `Category ${index + 1}`))
      // Zero-valued slices need no category lookup; these reads belong to the legend.
      expect(element.querySelectorAll('path')).toHaveLength(0)
      expect(categoryReads).toBe(8)
    } finally {
      dom.window.close()
    }
  })
})
