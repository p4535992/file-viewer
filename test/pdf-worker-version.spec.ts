import { describe, expect, it } from 'vitest';
import { readPdfJsWorkerVersion } from '../packages/renderers/pdf/src/pdfWorkerVersion';

describe('@file-viewer/renderer-pdf worker version markers', () => {
  it('reads the official PDF.js bundle header', () => {
    expect(readPdfJsWorkerVersion(`/**\n * pdfjsVersion = 5.4.624\n */`)).toBe('5.4.624');
  });

  it('reads the worker runtime version constant', () => {
    expect(readPdfJsWorkerVersion('const workerVersion = "5.2.133";')).toBe('5.2.133');
  });

  it('does not guess a version from unrelated JavaScript', () => {
    expect(readPdfJsWorkerVersion('const packageVersion = "5.2.133";')).toBeNull();
  });
});
