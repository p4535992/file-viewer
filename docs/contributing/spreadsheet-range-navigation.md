# Spreadsheet coordinate navigation

External search and citations often already know a cell range. Searching for its text is ambiguous when values repeat and cannot address blank cells. The spreadsheet renderer now registers the existing core view-state provider and accepts an optional typed range:

```ts
const result = await viewer.applyViewState({
  spreadsheet: {
    range: { sheetId: 1, startRow: 29, startCol: 3, endRow: 29, endCol: 4 }
  }
})
if (result?.spreadsheet?.status === 'applied') {
  // The renderer switched sheets, loaded the target virtual window and applied the scroll.
}
```

This works through the framework-neutral viewer and the React/Vue handles that already expose `applyViewState`. No framework-specific prop or new dependency is required. `initialViewState` can use the same shape where supported by the wrapper. Coordinates are zero-based, inclusive, and use the parser's workbook sheet id (not the visible-tab index). This API is scoped to the currently loaded workbook, not a durable file identity/revision scheme.

The range is highlighted independently of the grid's copy/edit selection. Existing text search stays separate. The top-left cell is scrolled into view; ranges larger than a viewport are not zoomed to fit. Bounds outside the parsed used rectangle, negative/fractional coordinates, inverted rectangles, and hidden/unknown sheets are rejected. Hidden rows/columns and merged-cell focus normalization need additional design; this is not an Excel editing or selection API.

Awaited range status is `applied`, `rejected`, `cancelled`, `failed`, or `disposed`. A new request or manual sheet/search action cancels the old request and clears its highlight. Cancellation settles even before workbook parsing completes. Late search responses, parser failures and animation callbacks cannot replace a newer request or revive a disposed renderer.

`getViewState()` also records the active `spreadsheet.sheetId`, zoom and scroll position. Applying a state without a range restores those fields and returns `idle`; a range supplies its own final scroll. The provider preserves fit support and emits view-state changes for applied navigation, zoom and scroll. Pass `{ notify: false }` as the second `applyViewState` argument for silent restoration. Returned states and subscribed range values are defensive copies. `scrollToAnchor` retains its existing behavior.

## Validation

Unit tests: `pnpm exec vitest run test/spreadsheet-range-navigation.spec.ts test/view-state-concurrency.spec.ts`.

For the browser reproduction, first build core/spreadsheet packages, then start Vite using the demo's existing Vite dependency:

```sh
pnpm --filter @flyfish-group/file-viewer-demo exec vite --config ../../test/spreadsheet-range.vite.config.mjs
# In another terminal at the repository root:
node test/spreadsheet-range.browser.mjs
```

Set `CHROME_PATH` to use an installed Chrome, or use Playwright's installed Chromium. The fixture is entirely synthetic, with repeated text at D8/D30, a blank D20:E20, a hidden sheet and a separate target at D600 beyond the first 500-row window. Assertions check real target visibility/highlight, three round trips after layout retries, cross-window navigation, invalid/hidden/out-of-bounds rejection, request supersession, a deliberately delayed Worker search, scale/sheet/scroll restoration and view-state subscriptions. Unit coverage also checks failure/destruction while loading, replaced providers and defensive copies.

The maintained source is integrated through the complete open-source main history. Applications should consume a published release containing this API. No runtime CDN or Worker path changes are introduced.
