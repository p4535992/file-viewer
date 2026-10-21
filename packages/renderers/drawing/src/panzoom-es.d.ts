// Panzoom's root "main" points to UMD despite type=module. Use its published
// ESM entry for both browser and server consumers, with the upstream API types.
declare module '@panzoom/panzoom/dist/panzoom.es.js' {
  import Panzoom from '@panzoom/panzoom'
  export default Panzoom
}
