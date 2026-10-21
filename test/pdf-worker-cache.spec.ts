import { describe, expect, it } from 'vitest';
import { scopePdfJsWorkerHandlerCache } from '../packages/renderers/pdf/src/pdfWorkerCache';

const property = '_setupFakeWorkerGlobal';
const descriptor = (owner: object) => Object.getOwnPropertyDescriptor(owner, property);

describe('PDF.js bundled worker cache ownership', () => {
  it('recovers from a rejected static import with the matching bundled handler', async () => {
    const rejected = Promise.reject(new Error('Worker URL returned HTML'));
    void rejected.catch(() => undefined);
    const workerClass = { [property]: rejected };
    const previous = descriptor(workerClass);
    const bundledHandler = { version: '5.4.624' };
    const scope = scopePdfJsWorkerHandlerCache(workerClass, bundledHandler);
    await expect(descriptor(workerClass)?.value).resolves.toBe(bundledHandler);
    expect(scope.restore()).toBe(true);
    expect(descriptor(workerClass)).toEqual(previous);
  });

  it('restores an unevaluated getter without invoking it', () => {
    let calls = 0;
    const workerClass = {};
    Object.defineProperty(workerClass, property, {
      configurable: true,
      get() { calls += 1; return Promise.resolve('host-handler'); },
    });
    const previous = descriptor(workerClass);
    const scope = scopePdfJsWorkerHandlerCache(workerClass, {});
    expect(scope.restore()).toBe(true);
    expect(descriptor(workerClass)).toEqual(previous);
    expect(calls).toBe(0);
  });

  it.each([false, true])('keeps overlapping workers scoped until both finish: reverse=%s', async reverse => {
    const hostHandler = Promise.resolve({ version: 'host' });
    const workerClass = { [property]: hostHandler };
    const handler = { version: '5.4.624' };
    const a = scopePdfJsWorkerHandlerCache(workerClass, handler);
    const installed = descriptor(workerClass)?.value;
    const b = scopePdfJsWorkerHandlerCache(workerClass, handler);
    expect(descriptor(workerClass)?.value).toBe(installed);
    const [first, last] = reverse ? [b, a] : [a, b];
    expect(first.restore()).toBe(false);
    await expect(descriptor(workerClass)?.value).resolves.toBe(handler);
    expect(last.restore()).toBe(true);
    expect(descriptor(workerClass)?.value).toBe(hostHandler);
  });

  it('releases each initialization once, including a rejected or canceled one', () => {
    const workerClass = {};
    const handler = {};
    const canceled = scopePdfJsWorkerHandlerCache(workerClass, handler);
    const running = scopePdfJsWorkerHandlerCache(workerClass, handler);
    expect(canceled.restore()).toBe(false);
    expect(canceled.restore()).toBe(false);
    expect(running.restore()).toBe(true);
    expect(descriptor(workerClass)).toBeUndefined();
  });

  it('preserves a replacement made by the host while initialization is pending', () => {
    const workerClass = {};
    const scope = scopePdfJsWorkerHandlerCache(workerClass, {});
    const hostPromise = Promise.resolve('new-host-handler');
    Object.defineProperty(workerClass, property, { value: hostPromise });
    expect(scope.restore()).toBe(false);
    expect(descriptor(workerClass)?.value).toBe(hostPromise);
  });

  it('does not change a host descriptor that makes the scoped value read-only', () => {
    const workerClass = {};
    const scope = scopePdfJsWorkerHandlerCache(workerClass, {});
    Object.defineProperty(workerClass, property, { writable: false });
    const hostDescriptor = descriptor(workerClass);
    expect(scope.restore()).toBe(false);
    expect(descriptor(workerClass)).toEqual(hostDescriptor);
  });

  it('keeps separate PDFWorker classes and their handlers independent', async () => {
    const a = {}, b = {};
    const handlerA = {}, handlerB = {};
    const scopeA = scopePdfJsWorkerHandlerCache(a, handlerA);
    const scopeB = scopePdfJsWorkerHandlerCache(b, handlerB);
    await expect(descriptor(a)?.value).resolves.toBe(handlerA);
    await expect(descriptor(b)?.value).resolves.toBe(handlerB);
    expect(scopeA.restore()).toBe(true);
    await expect(descriptor(b)?.value).resolves.toBe(handlerB);
    expect(scopeB.restore()).toBe(true);
  });
});
