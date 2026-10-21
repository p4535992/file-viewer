import { describe, expect, it } from 'vitest';
import { hasNativePdfWorkerPort, isPdfWorkerVersionMismatch } from '../packages/renderers/pdf/src/pdfWorkerProbe';

describe('PDF worker compatibility handshake', () => {
  it('retries only an actual PDF.js API/Worker version mismatch', () => {
    expect(isPdfWorkerVersionMismatch(new Error('The API version "5.4.624" does not match the Worker version "3.11.174".'), '5.4.624')).toBe(true);
    expect(isPdfWorkerVersionMismatch({ message: 'Invalid PDF structure.' }, '5.4.624')).toBe(false);
    expect(isPdfWorkerVersionMismatch(new Error('The API version "other" does not match the Worker version "3.11.174".'), '5.4.624')).toBe(false);
    expect(isPdfWorkerVersionMismatch(null, '5.4.624')).toBe(false);
  });

  it('recognizes native workers from either the module or target document realm', () => {
    class ModuleWorker {}
    class DocumentWorker {}
    const constructors = [ModuleWorker, DocumentWorker] as unknown as Array<typeof Worker>;
    expect(hasNativePdfWorkerPort(new ModuleWorker(), constructors)).toBe(true);
    expect(hasNativePdfWorkerPort(new DocumentWorker(), constructors)).toBe(true);
    expect(hasNativePdfWorkerPort({ postMessage() {}, terminate() {} }, constructors)).toBe(false);
    expect(hasNativePdfWorkerPort({}, [undefined])).toBe(false);
  });
});
