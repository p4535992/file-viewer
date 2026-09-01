# @file-viewer/renderer-text

Base code, text, and Markdown renderer package for Flyfish File Viewer. Mermaid, side-by-side patch diff, and Git bundle inspection live in `@file-viewer/capability-mermaid` and `@file-viewer/capability-text-tools`; they are excluded from the standard/full default closure.

## Usage

```ts
import FileViewer from '@file-viewer/vue3'
import { textRenderer } from '@file-viewer/renderer-text'

const options = {
  builtinRenderers: 'none',
  renderers: textRenderer,
  text: {
    lineNumbers: true,
    wrapLongLines: true,
    wrapLongLinesToggle: true,
    prettyPrint: true,
    prettyPrintMaxBytes: 512 * 1024,
    prettyPrintOptions: {
      tabWidth: 2,
      useTabs: false,
      printWidth: 100,
      proseWrap: 'preserve',
      byExtension: {
        json: {
          printWidth: 120,
        },
        md: {
          printWidth: 80,
          proseWrap: 'always',
        },
      },
      byMimeType: {
        'application/ld+json': {
          tabWidth: 4,
          printWidth: 120,
        },
      },
    },
  },
}
```

`wrapLongLines` and `prettyPrint` are independent and default to `false`. `printWidth` is a Prettier formatting hint and never enables visual wrapping. The runtime wrap control changes only renderer layout and reuses the already formatted/highlighted representation; it does not invoke Prettier again.

When `prettyPrintMaxBytes` is omitted, it uses the effective `virtualizeAboveBytes` value, or 512 KiB when that option is also omitted.

`prettyPrintOptions` accepts `tabWidth`, `useTabs`, `printWidth`, and `proseWrap`. Rules are merged in this order:

```text
Prettier defaults < global values < extension rule < MIME rule
```

Extension keys accept `json`, `.json`, or `*.json`. MIME matching is case-insensitive and ignores parameters such as `charset`. Structured MIME suffixes such as `+json` and `+xml` use the corresponding parser. Invalid option values are ignored. `tabWidth` accepts integers from 1 to 16, `printWidth` accepts integers from 1 to 1000, and `proseWrap` accepts `preserve`, `always`, or `never`.

`proseWrap` primarily affects prose formats such as Markdown. Its default remains Prettier's conservative `preserve` behavior. Use `always` only when the formatted representation should contain real line breaks near `printWidth`; `wrapLongLines` still handles any remaining viewport overflow without changing text.

You can also compose it with other renderers:

```ts
import { textRenderer } from '@file-viewer/renderer-text'
import { pdfRenderer } from '@file-viewer/renderer-pdf'

const options = {
  builtinRenderers: 'none',
  renderers: [pdfRenderer, textRenderer],
}
```

## Capabilities

- Code and text preview uses `highlight.js` core with per-language dynamic imports instead of registering every language up front.
- `options.text.wrapLongLines: true` visually wraps long logical lines without inserting line breaks into the source. Regular and large virtualized text keep one line number per logical source line.
- `options.text.wrapLongLinesToggle: true` adds a renderer-local control. Regular previews switch layout in place; virtual source previews switch between bounded fixed-height and variable-height rendering. Neither path changes the original bytes.
- `options.text.prettyPrint: true` formats supported structured/source formats for display with the packaged Prettier standalone runtime. JSON, JSONC, JSON5, JavaScript, TypeScript, HTML, Vue, CSS, Markdown, YAML, GraphQL, Handlebars, and conservatively handled XML-family source use the same opt-in path.
- `options.text.prettyPrintOptions` configures indentation, preferred formatted width, and Markdown prose wrapping globally or by extension/MIME. It is separate from `wrapLongLines`.
- The renderer checks `prettyPrintMaxBytes` and parser support before importing Prettier. Unsupported, malformed, whitespace-sensitive, or oversized source falls back to the original display without a rendering error.
- A labelled `Formatted` / `Source` control lets readers switch between the formatted representation and the decoded original source. The original `ArrayBuffer` remains unchanged for download and other source operations.
- HTML, XML, Vue, and similar files are escaped and shown as source, never inserted as executable markup. Formatting is entirely self-hosted and never loads external resources.
- Code, text, and virtualized Markdown source views show their file type, indexing status, and line-count metadata bar by default. Set `options.text.toolbar: false` to hide this renderer-local bar without hiding the viewer-level download, search, or zoom toolbar.
- Regular code and text previews can show a line-number gutter with `options.text.lineNumbers: true`. The gutter is excluded from copied source, search matches, and assistive reading. Virtual large-text views keep their existing gutter unless it is explicitly set to `false`.
- With the text-tools capability installed, `patch` uses `diff2html` for side-by-side review and `bundle` / `bdl` enables Git bundle inspection.
- With the Mermaid capability installed, fenced Mermaid blocks render as diagrams. Without it, the source stays visible with the exact CLI enablement command.
- Markdown uses `marked` for a read-only reading surface with dark/light theme support, table scrolling, and a unified zoom provider.
- Markdown no longer falls back to source because of the general large-text threshold. Set `options.text.markdownVirtualizeAboveBytes` only when an application must bound exceptionally large Markdown files.
- Does not depend on any online service or public CDN, making it suitable for intranet logs, configs, snippets, README files, and knowledge-base attachments.

## Migration Note

Standard/full includes base code, text, and Markdown without installing `diff2html`, `pako`, or Mermaid. Optional uploads show `npx file-viewer-cli add text-tools --write` or `add mermaid-markdown --write`; `preset-all` is only for explicit all/debug use.
