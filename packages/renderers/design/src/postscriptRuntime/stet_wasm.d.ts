/* tslint:disable */
/* eslint-disable */

/**
 * A fully initialized PostScript interpreter context.
 *
 * Created once via `create_interpreter()`, reused across `render()` calls.
 */
export class Interpreter {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
}

/**
 * A single rendered page with dimensions and RGBA pixel data.
 */
export class Page {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Page height in pixels.
     */
    readonly height: number;
    /**
     * RGBA pixel data (4 bytes per pixel, row-major).
     */
    readonly rgba: Uint8Array;
    /**
     * Page width in pixels.
     */
    readonly width: number;
}

export function create_interpreter(): Interpreter;

/**
 * Open a PDF file and parse its structure (xref, page tree, page sizes).
 *
 * Does **not** interpret page content streams — those are built on demand by
 * `render_pdf_page` (or implicitly by the first `render_viewport` /
 * `render_viewport_band` call for that page). This keeps the initial call
 * fast on large documents: a 500-page PDF returns its page count and
 * per-page dimensions in milliseconds instead of seconds.
 *
 * Returns the number of pages, or throws on parse error.
 */
export function open_pdf(interp: Interpreter, pdf_data: Uint8Array, dpi: number): any;

/**
 * Get the number of pages available for viewport rendering.
 */
export function page_count(interp: Interpreter): number;

/**
 * Get page dimensions and DPI for a specific page.
 * Returns [width, height, dpi] or null if page index is out of range.
 */
export function page_dimensions(interp: Interpreter, page_index: number): any;

/**
 * True while a PS program has more pages to interpret. JS can stop its
 * step-loop as soon as this goes false.
 */
export function ps_stream_active(interp: Interpreter): boolean;

/**
 * Get the initial reference DPI used during interpretation.
 */
export function reference_dpi(interp: Interpreter): number;

/**
 * Render PostScript or EPS data at the specified DPI.
 *
 * Interprets the PostScript, renders an overview of each page, and retains
 * display lists for viewport re-rendering via `render_viewport()`.
 * The interpreter state is reset after rendering so it can be reused.
 */
export function render(interp: Interpreter, ps_data: Uint8Array, dpi: number, filename: string): any;

/**
 * Build the display list for a single PDF page.
 *
 * Idempotent: if the page is already rendered, returns immediately.
 * Called implicitly by `render_viewport`/`render_viewport_band` on first
 * access, but exposed to JS so callers can prefetch future pages during
 * idle time.
 */
export function render_pdf_page(interp: Interpreter, page_index: number): void;

/**
 * Render a rectangular viewport region of a stored display list.
 *
 * Arguments:
 * - `page_index`: Which page's display list to render
 * - `vp_x, vp_y, vp_w, vp_h`: Viewport rectangle in device-space pixels
 *   (at the reference DPI used during interpretation)
 * - `pixel_w, pixel_h`: Output pixel dimensions
 *
 * Returns a `Page` with the rendered RGBA data.
 */
export function render_viewport(interp: Interpreter, page_index: number, vp_x: number, vp_y: number, vp_w: number, vp_h: number, pixel_w: number, pixel_h: number): Page;

/**
 * Render a single horizontal band of a viewport region.
 *
 * This is the per-band counterpart to `render_viewport()`. The JS worker
 * loops over `band_idx` in `0..num_bands`, collecting RGBA strips.
 */
export function render_viewport_band(interp: Interpreter, page_index: number, vp_x: number, vp_y: number, vp_w: number, vp_h: number, pixel_w: number, pixel_h: number, band_idx: number, band_h: number, num_bands: number): Page;

/**
 * Set the ceiling on PostScript VM — strings, arrays, dictionaries — in bytes.
 *
 * The browser counterpart of the CLI's `--max-vm`: a program that would
 * exceed it gets a `VMerror` it can catch, where an allocation the module
 * cannot satisfy aborts it. The default is a quarter of the address space,
 * which is 1 GiB here; a page embedding the viewer will usually want less.
 *
 * A program can lower its own limit with `setuserparams` but cannot raise it
 * past this.
 *
 * The interpreter's own start-up state counts against the ceiling, so a
 * value below what `create_interpreter` has already allocated refuses every
 * further allocation. The ceiling bounds PostScript VM only, not the
 * renderer's image and band buffers, and holds for the life of the
 * interpreter.
 */
export function set_max_vm(interp: Interpreter, max_bytes: number): void;

/**
 * Resume PS interpretation up to the next `showpage`, appending any new
 * pages to the interpreter's page tables. Returns the total page count so
 * far. Returns the same count when the program has already completed — JS
 * can poll this to learn when streaming is finished (the returned count
 * stops increasing and `ps_stream_active` reads false).
 */
export function step_ps_page(interp: Interpreter): any;

/**
 * Compute the number of bands and band height for viewport banding.
 *
 * Returns a JS array `[num_bands, band_height]`.
 */
export function viewport_band_params(pixel_w: number, pixel_h: number): Array<any>;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_interpreter_free: (a: number, b: number) => void;
    readonly __wbg_page_free: (a: number, b: number) => void;
    readonly create_interpreter: () => number;
    readonly open_pdf: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly page_count: (a: number) => number;
    readonly page_dimensions: (a: number, b: number) => any;
    readonly page_height: (a: number) => number;
    readonly page_rgba: (a: number) => [number, number];
    readonly page_width: (a: number) => number;
    readonly ps_stream_active: (a: number) => number;
    readonly reference_dpi: (a: number) => number;
    readonly render: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly render_pdf_page: (a: number, b: number) => [number, number];
    readonly render_viewport: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly render_viewport_band: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number];
    readonly set_max_vm: (a: number, b: number) => void;
    readonly step_ps_page: (a: number) => [number, number, number];
    readonly viewport_band_params: (a: number, b: number) => any;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
