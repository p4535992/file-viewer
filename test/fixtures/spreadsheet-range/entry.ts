import { createViewer } from '@file-viewer/core';
import { spreadsheetRenderer } from '../../../packages/renderers/spreadsheet/src/index';
import workerUrl from '@file-viewer/renderer-spreadsheet/worker/sheet.worker.js?url';
// Hold a real Worker request so a late text-search response races navigation.
let holdSearch = false;
let releaseSearch: (() => void) | null = null;
const originalPost = Worker.prototype.postMessage;
Worker.prototype.postMessage = function (message, ...args) {
  const send = () => Reflect.apply(originalPost, this, [message, ...args]);
  if (holdSearch && message?.type === 'searchWorkbook') {
    holdSearch = false;
    releaseSearch = send;
    return;
  }
  send();
};
const viewChanges: unknown[] = [];
(window as any).rangeHarness = {
  changes: viewChanges,
  holdSearch: () => { holdSearch = true; },
  isSearchHeld: () => !!releaseSearch,
  releaseSearch: () => { const send = releaseSearch; releaseSearch = null; send?.(); },
};
const bytes = await (await fetch(new URL('./range-navigation.xlsx', import.meta.url))).arrayBuffer();
const handle=createViewer(document.getElementById('viewer')!, {onEvent:event=>{
  if(event.type==='view-state-change')viewChanges.push(event.payload);
},options:{rendererMode:'replace',renderers:[spreadsheetRenderer],styleIsolation:'none',toolbar:false,spreadsheet:{worker:true,workerUrl}}});
(window as any).rangeTest = handle;

await handle.load({buffer:bytes,filename:'synthetic.xlsx'});
