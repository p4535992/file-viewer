import { describe, expect, it } from 'vitest';
import {
  capturePdfJsWorkerGlobal,
  scopePdfJsWorkerMessageHandler,
  type PdfJsWorkerGlobal,
} from '../packages/renderers/pdf/src/pdfWorkerGlobal';

describe('@file-viewer/renderer-pdf worker global ownership', () => {
  it('replaces a stale handler from another PDF.js version', () => {
    const staleHandler = { version: '3.11.174' };
    const bundledHandler = { version: '5.4.624' };
    const hostNamespace = {
      WorkerMessageHandler: staleHandler,
      hostMarker: 'vue-office',
    };
    const workerGlobal: PdfJsWorkerGlobal = {
      pdfjsWorker: hostNamespace,
    };

    const scope = scopePdfJsWorkerMessageHandler(workerGlobal, bundledHandler);
    expect(scope.installResult).toBe('replaced');
    expect(workerGlobal.pdfjsWorker).toEqual({
      WorkerMessageHandler: bundledHandler,
      hostMarker: 'vue-office',
    });
    expect(scope.restore()).toBe(true);
    expect(workerGlobal.pdfjsWorker).toBe(hostNamespace);
    expect(workerGlobal.pdfjsWorker?.WorkerMessageHandler).toBe(staleHandler);
    expect(scope.restore()).toBe(false);
  });

  it('keeps an already installed bundled handler stable', () => {
    const bundledHandler = { version: '5.4.624' };
    const namespace = { WorkerMessageHandler: bundledHandler };
    const workerGlobal: PdfJsWorkerGlobal = { pdfjsWorker: namespace };

    const scope = scopePdfJsWorkerMessageHandler(workerGlobal, bundledHandler);
    expect(scope.installResult).toBe('unchanged');
    expect(workerGlobal.pdfjsWorker).toBe(namespace);
    expect(scope.restore()).toBe(false);
  });

  it('restores the host snapshot when the worker module overwrites the global during import', () => {
    const staleHandler = { version: '3.11.174' };
    const bundledHandler = { version: '5.4.624' };
    const hostNamespace = { WorkerMessageHandler: staleHandler, hostMarker: true };
    const workerGlobal: PdfJsWorkerGlobal = { pdfjsWorker: hostNamespace };
    const hostSnapshot = capturePdfJsWorkerGlobal(workerGlobal);

    // pdf.worker.mjs performs this assignment as a top-level side effect.
    workerGlobal.pdfjsWorker = { WorkerMessageHandler: bundledHandler };
    const scope = scopePdfJsWorkerMessageHandler(
      workerGlobal,
      bundledHandler,
      hostSnapshot
    );

    expect(scope.installResult).toBe('unchanged');
    expect(scope.restore()).toBe(true);
    expect(workerGlobal.pdfjsWorker).toBe(hostNamespace);
  });

  it('does not overwrite a host namespace that changes while the scope is active', () => {
    const bundledHandler = { version: '5.4.624' };
    const workerGlobal: PdfJsWorkerGlobal = {};
    const scope = scopePdfJsWorkerMessageHandler(workerGlobal, bundledHandler);
    const installedNamespace = workerGlobal.pdfjsWorker;
    const newerHostNamespace = { WorkerMessageHandler: { version: 'host-newer' } };

    workerGlobal.pdfjsWorker = newerHostNamespace;

    expect(scope.restore()).toBe(false);
    expect(workerGlobal.pdfjsWorker).toBe(newerHostNamespace);
    workerGlobal.pdfjsWorker = installedNamespace;
    expect(scope.restore()).toBe(false);
  });
});
