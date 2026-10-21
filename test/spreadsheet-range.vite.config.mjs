import { fileURLToPath } from 'node:url';

const local = path => fileURLToPath(new URL(path, import.meta.url));
export default {
  root: local('../'),
  server: { host: '127.0.0.1', port: 43141, strictPort: true },
  resolve: {
    dedupe: ['@file-viewer/core'],
    alias: [
      { find: /^@file-viewer\/core$/, replacement: local('../packages/core/src/index.ts') },
      { find: '@file-viewer/renderer-spreadsheet/worker/sheet.worker.js', replacement: local('../packages/renderers/spreadsheet/dist/worker/sheet.worker.js') },
    ],
  },
};
