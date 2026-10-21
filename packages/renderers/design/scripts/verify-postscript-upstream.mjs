import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolvePostscriptSafetyLimits } from '../dist/postscriptLimits.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const gluePath = resolve(root, process.env.POSTSCRIPT_GLUE_PATH || 'packages/renderers/design/src/postscriptRuntime/stet_wasm.js')
const wasmPath = resolve(root, process.env.POSTSCRIPT_WASM_PATH || 'packages/renderers/design/runtime/postscript/stet_wasm_bg.wasm')
const stet = await import(pathToFileURL(gluePath).href)
stet.initSync({ module: await readFile(wasmPath) })
const maxVm = stet.set_max_vm ?? stet.configure_limits
assert.equal(typeof maxVm, 'function')

const raster = (name, program, vmBytes = 256 * 1024 * 1024) => {
  const interpreter = stet.create_interpreter()
  maxVm(interpreter, vmBytes)
  try {
    const source = `%!PS-Adobe-3.0\n<< /PageSize [192 96] >> setpagedevice\n${program}\nshowpage\n`
    stet.render(interpreter, new TextEncoder().encode(source), 72, `${name}.ps`)
    let steps = 0
    while (stet.ps_stream_active(interpreter)) {
      assert.ok(++steps < 5, `${name}: unexpected extra pages`)
      stet.step_ps_page(interpreter)
    }
    assert.equal(stet.page_count(interpreter), 1, `${name}: page count`)
    const [width, height] = stet.page_dimensions(interpreter, 0)
    const page = stet.render_viewport(interpreter, 0, 0, 0, width, height, 192, 96)
    try { return Uint8Array.from(page.rgba) } finally { page.free() }
  } finally { interpreter.free() }
}
const pixel = (rgba, x, y) => [...rgba.slice((y * 192 + x) * 4, (y * 192 + x) * 4 + 4)]
const condition = (name, expression, vmBytes) => {
  const rgba = raster(name, `${expression} { 0 1 0 } { 1 0 0 } ifelse setrgbcolor 0 0 192 96 rectfill`, vmBytes)
  assert.deepEqual(pixel(rgba, 96, 48), [0, 255, 0, 255], name)
  console.log(`[postscript-upstream] ${name}: passed`)
}

// AFM widths at 1000 units/em from Artifex urw-base35-fonts commit
// 3c0ba3b5687632dfc66526544a4e811fe0ec0cd9; Carlito fails Helvetica.
for (const [font, width] of [
  ['Helvetica', 2055], ['Helvetica-Bold', 2055],
  ['Helvetica-Oblique', 2055], ['Helvetica-BoldOblique', 2055],
  ['Times-Roman', 2166], ['Times-Bold', 2333],
  ['Times-Italic', 1999], ['Times-BoldItalic', 2167],
  ['Courier', 1800], ['Courier-Bold', 1800],
  ['Courier-Oblique', 1800], ['Courier-BoldOblique', 1800],
]) {
  condition(`metrics-${font}`, `/${font} findfont 1000 scalefont setfont (IWM) stringwidth pop ${width} sub abs 0.2 lt`)
}
condition('Symbol-encoding', '/Symbol findfont /Encoding get dup 65 get /Alpha eq exch 97 get /alpha eq and')
condition('ZapfDingbats-encoding', '/ZapfDingbats findfont /Encoding get dup 33 get /a1 eq exch 34 get /a2 eq and')
const glyphs = new Map()
for (const [font, text] of [['Helvetica', 'abc'], ['Symbol', 'abc'], ['ZapfDingbats', '!"#']]) {
  const rgba = raster(`glyphs-${font}`, `/${font} findfont 48 scalefont setfont 0 setgray 12 24 moveto (${text}) show`)
  let ink = 0
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i] < 128 && rgba[i + 3] > 0) ink++
  assert.ok(ink > 250, `${font}: empty glyphs (${ink})`)
  glyphs.set(font, rgba)
  console.log(`[postscript-upstream] glyphs-${font}: ${ink} ink pixels`)
}
assert.notDeepEqual(glyphs.get('Helvetica'), glyphs.get('Symbol'))
assert.notDeepEqual(glyphs.get('Symbol'), glyphs.get('ZapfDingbats'))

// Independent LittleCMS 2 / Pillow oracle using the exact upstream CC0 ICC,
// sRGB output, relative colorimetric intent. Allow small interpolation error.
const swatches = [
  { cmyk: [255, 0, 0, 0], rgb: [0, 174, 239] },
  { cmyk: [0, 255, 0, 0], rgb: [236, 0, 140] },
  { cmyk: [0, 0, 255, 0], rgb: [255, 242, 0] },
  { cmyk: [0, 0, 0, 255], rgb: [35, 31, 32] },
  { cmyk: [0, 128, 255, 0], rgb: [248, 148, 29] },
  { cmyk: [128, 64, 0, 64], rgb: [99, 134, 173] },
]
for (const [i, { cmyk, rgb }] of swatches.entries()) {
  const components = cmyk.map(x => (x / 255).toFixed(9)).join(' ')
  const rgba = raster(`CMYK-vector-${i}`, `${components} setcmykcolor 0 0 192 96 rectfill`)
  const actual = pixel(rgba, 96, 48)
  assert.ok(rgb.every((v, ch) => Math.abs(v - actual[ch]) <= 5), `CMYK ${cmyk}: ${actual} vs ICC ${rgb}`)
  assert.equal(actual[3], 255)
  console.log(`[postscript-upstream] CMYK ${cmyk} -> ${actual.slice(0, 3)}`)
}

assert.equal(resolvePostscriptSafetyLimits({ maxVmBytes: 1 }).maxVmBytes, 16 * 1024 * 1024)
assert.equal(resolvePostscriptSafetyLimits({ maxVmBytes: 2 ** 32 }).maxVmBytes, 512 * 1024 * 1024)
assert.equal(resolvePostscriptSafetyLimits({ maxVmBytes: NaN }).maxVmBytes, 256 * 1024 * 1024)
for (const [name, setup] of [
  ['local', ''], ['global', 'true setglobal'],
  ['cannot-raise', '<< /MaxLocalVM 1073741824 >> setuserparams'],
]) {
  condition(`VM-${name}`, `${setup} { 20000000 string pop false } stopped { $error /errorname get /VMerror eq } if`, 16 * 1024 * 1024)
}
condition('VM-effective-ceiling', '<< /MaxLocalVM 1073741824 >> setuserparams currentuserparams /MaxLocalVM get 16777216 eq', 16 * 1024 * 1024)
condition('VM-small-allocation', '1024 string length 1024 eq', 16 * 1024 * 1024)
console.log('[postscript-upstream] Verified font metrics, symbol encodings and pixels, ICC CMYK, and host VM ceilings.')
