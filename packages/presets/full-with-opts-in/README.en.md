# @file-viewer/preset-full-with-opts-in

Additive File Viewer preset for the **full-with-opts-in** release line.

It enables the historical non-CAD Full renderer set plus the explicit opt-ins currently shipped by the workspace: BPMN, DICOM, digital-signature/evidence containers, Adobe/design formats, binary inspector, and the enhanced IFC viewer.

The AGPL-only CAD runtime chain is intentionally absent: this package does **not** depend on `@file-viewer/renderer-cad`, `@flyfish-dev/cad-viewer`, `dwf-viewer`, or `@file-viewer/assets-cad`.

Install static assets with:

```sh
npx file-viewer-copy-assets-full-with-opts-in public/file-viewer
```

IFC assets and their license notices are installed under `vendor/ifc`. DICOM and signature runtimes stay package-local/lazy.
