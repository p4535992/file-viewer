# EPS/PostScript WebAssembly build

The browser engine is built from unmodified Stet commit `58c7066817f7939789c6f030515c02e94fb0353b` (workspace version 0.8.7; `stet-wasm` 0.2.0). It is an experimental renderer, not a claim of Adobe PostScript Level 3 conformance.

## Redistribution boundary

The engine embeds Stet's 35 URW Base35 Type 1 fonts under Stet's SIL Open Font License 1.1 election. The complete upstream provenance and license text is copied unchanged as `LICENSES/Stet-URW-Fonts-OFL-1.1.txt`. It records URW++'s triple licensing of Core 35 Version 2.00 in 2017, the archived license commit `1b5267a9a14d8d5bcf261e067187e382df40c520`, and the subsequent URW revisions supplied to Artifex. All 35 font files were checked against the Git blobs in `ArtifexSoftware/urw-base35-fonts` commit `3c0ba3b5687632dfc66526544a4e811fe0ec0cd9`. Exact SHA-256 values are pinned in `source/postscript/upstream.json`.

The embedded `default_cmyk.icc` is **not** Ghostscript's profile. It is the CC0 `CGATS001Compat-v2-micro.icc` from `saucecontrol/Compact-ICC-Profiles` commit `1fabe4a41bef9bac6e8300748177f783773571cb`: 8,464 bytes, SHA-256 `73e1ba37d2bad5bab2a964f40a9eed96209666efc067c3322626214bbef234a0`. The upstream provenance is copied unchanged as `LICENSES/Stet-CMYK-Profile.txt`; the collection's complete CC0 legal text is `LICENSES/CC0-1.0.txt`. The native and WASM profile copies have identical bytes.

Nimbus Sans, Nimbus Roman and Nimbus Mono PS restore the standard Helvetica, Times and Courier metrics; StandardSymbolsPS and D050000L provide Symbol and ZapfDingbats encodings. Carlito, Tinos, Cousine and Noto Sans Symbols 2 are no longer embedded. Their existing license URLs remain available for compatibility. Color output now uses the embedded CC0 profile; it can still differ from Adobe applications and document-specific print conditions.

## Rebuild

Required tools are pinned and checked by the script:

- Rust/Cargo 1.94.1 with `wasm32-unknown-unknown`
- wasm-bindgen CLI 0.2.127
- Binaryen wasm-opt 132

Run from the repository root:

```sh
node packages/renderers/design/scripts/build-postscript-wasm.mjs
pnpm --filter @file-viewer/renderer-design build
node scripts/verify-postscript-wasm.mjs
```

The script checks out the pinned commit, verifies all font, ICC and notice hashes, and builds without applying any source patch or deleting or substituting any upstream resource. The only checkout change is supplying the checked-in `source/postscript/Cargo.lock` (SHA-256 `828105d370044c45bd761c529c7f23a4d0822ff29ef32e82d201e9dbd6595793`) to pin the wasm-bindgen 0.2.127 dependency family to the installed CLI. Cargo runs `--locked` with fixed locale/time settings, incremental compilation disabled, one codegen unit, and path-prefix remapping for both the temporary checkout and the local toolchain home. The output scan rejects leaked local paths and verifies that every font and the exact ICC bytes exist in initialized WASM memory, including data split across zero-filled segments by the optimizer.

Two clean builds produced identical glue, declarations and WASM. WASM SHA-256: `b8d72531ec41ca497d67a79589a1dbb44748a4fefd088aa122007fbb28e06b20` (14,706,940 bytes).

The build also regenerates `LICENSES/Stet_NATIVE_THIRD_PARTY_LICENSES.json` from the exact Cargo lock. The collector verifies registry crate archive checksums and original legal-file bytes, records source grants for the original Rust standard library, and preserves the IJG and Unicode notices in addition to MIT/Apache texts. The source profile is conservative and includes host/build alternatives; it does not claim a post-link inventory. `source/postscript/upstream.json` records immutable license sources for Rust and for the fax crates whose archives omit license files. The same book is required in Vite and offline asset copies. To regenerate it for an existing pinned checkout with the downstream lock:

```sh
cargo +1.94.1 fetch --locked --manifest-path /path/to/stet/crates/stet-wasm/Cargo.toml
node packages/renderers/design/scripts/collect-postscript-notices.mjs /path/to/stet
```

The original Type 1 fonts' encrypted charstrings compress less than the former TTF substitutes. The larger lazy-loaded payload is accounted for in the renderer's explicit install-size budget; its size is checked again after packing.

`verify-postscript-wasm.mjs` executes the existing EPS/PS fixtures plus `verify-postscript-upstream.mjs`: twelve Latin face metrics against source AFMs, Symbol and ZapfDingbats encodings and raster output, CMYK swatches against a LittleCMS oracle, and host VM limits. To exercise embedded TrueType and CFF-flavoured OpenType loading through the unmodified upstream operator with synthetic fonts:

```sh
node scripts/verify-postscript-upstream-source.mjs /path/to/pinned/stet
```

## Runtime safety boundary

File Viewer clamps VM overrides to 16–512 MiB in JavaScript and passes the result to upstream `set_max_vm`. A document can lower its limit with `setuserparams`, but cannot raise it past the host ceiling; both local and global allocations count. This ceiling covers PostScript VM, not the entire WebAssembly heap. File size, page count, source dimensions, output dimensions, output pixels, render DPI, decoded print bytes, and retained canvas bytes have separate bounds. Wall-clock cancellation remains outside the interpreter: every operation runs in a dedicated Worker that the client terminates on timeout or abort. This prevents a non-terminating PostScript program from blocking the browser UI; it does not make arbitrary PostScript trusted input.
