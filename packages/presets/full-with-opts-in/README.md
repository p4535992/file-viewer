# @file-viewer/preset-full-with-opts-in

Additive File Viewer preset for the **full-with-opts-in** release line.

It enables the historical non-CAD Full renderer set plus the explicit opt-ins currently shipped by the workspace: BPMN, DICOM, digital-signature/evidence containers, Adobe/design formats, binary inspector, the enhanced IFC viewer, Geo3D LAS/LAZ/COPC/GeoTIFF/COG/CityJSON/3D Tiles/3TZ viewer, and XML XSD/XSLT profiles.

The AGPL-only CAD runtime chain is intentionally absent: this package does **not** depend on `@file-viewer/renderer-cad`, `@flyfish-dev/cad-viewer`, `dwf-viewer`, or `@file-viewer/assets-cad`.

For the complete offline Web distribution, use the matching GitHub release's `*-offline.tar.gz`. Its `web/` directory contains the precompiled production dependency closure and `file-viewer/` contains all enabled runtime assets. Do not run `npm install` inside this already-deployed archive. The ESM entry still requires a browser bundler; it is not a single script-tag IIFE.

IFC assets and their license notices are installed under `vendor/ifc`. DICOM and signature runtimes stay package-local/lazy.

Geo3D is enabled by default for its experimental supported formats, with self-hosted decoders at `/file-viewer/vendor/geo3d/` (including LAS/LAZ/COPC workers, laz-perf WASM, GeoTIFF/COG workers and DRACO/Basis decoders). The original Flyfish Geo3D integration's input size, security and format limits remain enforced.

XML XSD/XSLT profile support is registered lazily. Runtime assets are staged under `/file-viewer/xml/`. Provide `options.xml.profilesUrl` or `options.xml.profiles` and configure self-hosted paths when not serving at `/file-viewer/`:

```ts
const options = {
  xml: {
    profilesUrl: '/xml-profiles/profiles.json',
    runtime: {
      xsdWorkerUrl: '/file-viewer/xml/xmllint-browser.mjs',
      xsltModuleUrl: '/file-viewer/xml/xslt-wasm.js'
    }
  }
}
```

These are opt-in XML *profiles*, not automatic XSLT transformations for arbitrary XML. The AGPL CAD/DWG/DWF/DWFX runtime remains excluded.
