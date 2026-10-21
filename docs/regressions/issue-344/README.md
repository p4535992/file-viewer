# Stet upstream migration regression

The runtime uses the pinned upstream source and dependency graph recorded in
[`upstream.json`](../../../packages/renderers/design/source/postscript/upstream.json).
The previous patch's font/profile substitutions are removed. Its embedded-font
loader and host VM cap are replaced by upstream implementations. JavaScript
retains the 16–512 MiB clamp and terminable Worker boundary.

After building core, renderer-design and vite-plugin, and staging viewer assets:

```sh
node scripts/verify-postscript-wasm.mjs
node scripts/verify-postscript-upstream-assets.mjs
node scripts/verify-postscript-upstream-browser.mjs
POSTSCRIPT_BUNDLE_FORMAT=vite node scripts/verify-postscript-upstream-browser.mjs
POSTSCRIPT_BUNDLE_FORMAT=iife node scripts/verify-postscript-upstream-browser.mjs
POSTSCRIPT_BUNDLE_FORMAT=webpack node scripts/verify-postscript-upstream-browser.mjs
node scripts/verify-postscript-upstream-source.mjs /path/to/pinned/stet
```

Webpack mode needs Webpack 5 installed, or `POSTSCRIPT_WEBPACK_MODULE` pointing
to its Node entry. `POSTSCRIPT_EVIDENCE_DIR` selects screenshot and JSON output.
The browser fixture server rejects external requests. It tests both desktop
and 390px layouts, actual page-two pixels after navigation, zoom, the served
WASM hash and MIME type, license bytes, a catchable VMerror, loop timeout and
abort. A narrow desktop viewport is not evidence of an iPhone Simulator run.

The WASM test compares twelve standard Latin font widths with the original URW
AFMs, checks Symbol/ZapfDingbats encodings and nonempty distinct glyph rasters,
and compares six CMYK swatches with an independent LittleCMS/sRGB oracle. It
also checks that local/global allocations honor the host ceiling and that a
document cannot raise it. These checks reject the former Carlito-based build.
The source test uses synthetic embedded sfnt resources and verifies both
TrueType-to-Type42 and CFF OpenType-to-Type2 registration through the actual
upstream operator; it does not read system fonts.

The asset test checks required core declarations, exact notice bytes across
all offline payloads, and the production Vite copy hook in an isolated
consumer. Removing each new license from the source package must make copying
fail. Renderer and assets-design tarballs must contain the full OFL provenance,
CMYK provenance and CC0 legal text alongside the same runtime bytes.

The native legal book is bound to the exact source, lock and runtime hashes.
Every package has complete original legal material; all material digests must
round-trip from their text bytes. The book preserves the independent IJG and
Unicode requirements and records the later upstream fax grant used for crate
archives that declare MIT but omit a grant file. Missing this book must fail
the same copy gate as missing the font or profile notices.

Full release matrices, native Windows checks, deployment and production
postchecks remain part of the unified release workflow. Local regression
success alone does not authorize closing the issue as released.
