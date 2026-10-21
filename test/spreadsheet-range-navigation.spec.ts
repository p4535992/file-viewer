import { describe, expect, it, vi } from 'vitest'
import { createSpreadsheetRangeNavigation } from '../packages/renderers/spreadsheet/src/spreadsheet/rangeNavigation'
const range = { sheetId: 1, startRow: 29, startCol: 3, endRow: 29, endCol: 4 }
function fixture(ready = Promise.resolve()) {
  const jump = vi.fn(); const clearJump = vi.fn()
  const nav = createSpreadsheetRangeNavigation({ ready, jump, clearJump, getScale: () => 1,
    isVisibleSheet: id => id === 0 || id === 1 })
  return { nav, jump }
}
describe('coordinate navigation lifecycle', () => {
  it('passes exact coordinates without a text search and completes only after scrolling', async () => {
    const {nav,jump} = fixture()
    const result = nav.provider.applyState!({ spreadsheet: { range } })
    await Promise.resolve()
    expect(jump).toHaveBeenCalledWith(range)
    const done = nav.prepare(34,16)
    expect(nav.contains(1,29,3)).toBe(true)
    expect(nav.contains(1,7,3)).toBe(false)
    done!()
    expect((await result).spreadsheet?.status).toBe('applied')
  })
  it.each([{...range,sheetId:2},{...range,startRow:-1},{...range,endRow:1},{...range,endCol:16384},{...range,startCol:1.5}])('rejects hidden or invalid coordinates %j', async target => {
    const {nav,jump}=fixture()
    expect((await nav.provider.applyState!({spreadsheet:{range:target}})).spreadsheet?.status).toBe('rejected')
    expect(jump).not.toHaveBeenCalled()
  })
  it('rejects ranges outside the used sheet without reporting success', async () => {
    const {nav}=fixture(); const result=nav.provider.applyState!({spreadsheet:{range}})
    await Promise.resolve(); expect(nav.prepare(20,16)).toBeNull()
    expect((await result).spreadsheet?.status).toBe('rejected')
  })
  it('cancels an older request and ignores its deferred paint callback', async () => {
    const {nav}=fixture(); const first=nav.provider.applyState!({spreadsheet:{range}})
    await Promise.resolve(); const stale=nav.prepare(34,16)
    const second=nav.provider.applyState!({spreadsheet:{range:{...range,startRow:19,endRow:19}}})
    await Promise.resolve(); stale!()
    expect((await first).spreadsheet?.status).toBe('cancelled')
    expect(nav.provider.getState().spreadsheet?.status).toBe('pending')
    nav.prepare(34,16)!(); expect((await second).spreadsheet?.status).toBe('applied')
  })
  it.each(['cancelled','failed','disposed'] as const)('settles requests on %s', async status => {
    const {nav}=fixture(); const result=nav.provider.applyState!({spreadsheet:{range}})
    await Promise.resolve(); nav.cancel(status)
    expect((await result).spreadsheet?.status).toBe(status)
    expect(nav.contains(1,29,3)).toBe(false)
  })
  it('pre-load requests cannot replace a later request or survive disposal', async () => {
    let resolve!:()=>void; const {nav,jump}=fixture(new Promise<void>(r=>{resolve=r}))
    const first=nav.provider.applyState!({spreadsheet:{range}})
    const second=nav.provider.applyState!({spreadsheet:{range}})
    nav.cancel('disposed'); resolve()
    expect((await first).spreadsheet?.status).toBe('cancelled')
    expect((await second).spreadsheet?.status).toBe('disposed')
    expect(jump).not.toHaveBeenCalled()
  })
  it('copies caller input and returned range state', async () => {
    const {nav}=fixture(); const input={...range}
    const result=nav.provider.applyState!({spreadsheet:{range:input}})
    input.endCol=200; await Promise.resolve(); nav.prepare(34,16)!()
    const state=await result; state.spreadsheet!.range!.startRow=0
    expect(nav.provider.getState().spreadsheet?.range).toEqual(range)
  })
  it.each(['cancelled', 'failed', 'disposed'] as const)('settles %s before workbook parsing completes', async status => {
    const {nav,jump}=fixture(new Promise<void>(()=>{}))
    const result=nav.provider.applyState!({spreadsheet:{range}})
    nav.cancel(status)
    expect((await result).spreadsheet?.status).toBe(status)
    expect(jump).not.toHaveBeenCalled()
  })
  it('consumes parser rejection and preserves terminal disposal', async () => {
    let reject!: (reason: Error)=>void
    const {nav,jump}=fixture(new Promise<void>((_,r)=>{reject=r}))
    const result=nav.provider.applyState!({spreadsheet:{range}})
    nav.cancel('disposed'); reject(new Error('late parser failure'))
    await Promise.resolve()
    expect((await result).spreadsheet?.status).toBe('disposed')
    expect(nav.provider.getState().spreadsheet?.status).toBe('disposed')
    expect(jump).not.toHaveBeenCalled()
  })
  it('reports parser failure without leaving a rejected ready promise unhandled', async () => {
    const {nav}=fixture(Promise.reject(new Error('parse failed')))
    await Promise.resolve()
    expect((await nav.provider.applyState!({spreadsheet:{range}})).spreadsheet?.status).toBe('failed')
  })
  it('notifies subscribers with isolated state and respects silent restoration', async () => {
    const {nav}=fixture();const changes: string[]=[]
    const unsubscribe=nav.provider.subscribe!(change=>{
      changes.push(change.state.spreadsheet!.status!)
      if(change.state.spreadsheet?.range)change.state.spreadsheet.range.startRow=0
    })
    const result=nav.provider.applyState!({spreadsheet:{range}})
    await Promise.resolve();nav.prepare(34,16)!();await result
    expect(changes).toEqual(['applied'])
    expect(nav.provider.getState().spreadsheet?.range).toEqual(range)
    const silent=nav.provider.applyState!({spreadsheet:{range}}, {notify:false})
    await Promise.resolve();nav.prepare(34,16)!();await silent
    expect(changes).toEqual(['applied'])
    unsubscribe();nav.notify('scroll');expect(changes).toEqual(['applied'])
  })
  it('restores ordinary state and cancels an unfinished restore without waiting for it', async () => {
    let current: (()=>boolean) | undefined
    const restoreState=vi.fn((state,valid)=>{current=valid;return new Promise<void>(()=>{})})
    const nav=createSpreadsheetRangeNavigation({ready:Promise.resolve(),getScale:()=>1,
      getState:()=>({scroll:{top:120,left:40},spreadsheet:{sheetId:1}}),restoreState,
      isVisibleSheet:()=>true,jump:vi.fn(),clearJump:vi.fn()})
    const result=nav.provider.applyState!({scale:1.5,scroll:{top:200,left:90}})
    await Promise.resolve();expect(current!()).toBe(true)
    nav.cancel();expect(current!()).toBe(false)
    expect((await result).spreadsheet?.status).toBe('cancelled')
    const state=nav.provider.getState();state.scroll!.top=0
    expect(nav.provider.getState().scroll?.top).toBe(120)
  })
})
