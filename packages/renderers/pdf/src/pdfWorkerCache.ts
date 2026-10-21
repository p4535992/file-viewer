type WorkerHandlerCacheScope = {
  handler: unknown;
  promise: Promise<unknown>;
  previous: PropertyDescriptor | undefined;
  enumerable: boolean;
  users: number;
};

const workerHandlerScopes = new WeakMap<object, WorkerHandlerCacheScope>();
const cacheProperty = '_setupFakeWorkerGlobal';

/**
 * PDF.js caches a failed worker import on its PDFWorker class. Installing the
 * bundled global handler alone cannot replace that rejected Promise. Scope the
 * matching handler Promise until our workers have captured it, then restore the
 * host descriptor. Overlapping initializations share ownership of the scope.
 */
export const scopePdfJsWorkerHandlerCache = (
  workerClass: object,
  handler: unknown
) => {
  const current = Object.getOwnPropertyDescriptor(workerClass, cacheProperty);
  let scope = workerHandlerScopes.get(workerClass);
  if (!scope || scope.handler !== handler || current?.value !== scope.promise) {
    const promise = Promise.resolve(handler);
    const enumerable = current?.enumerable ?? true;
    Object.defineProperty(workerClass, cacheProperty, {
      value: promise,
      configurable: true,
      writable: true,
      enumerable,
    });
    scope = { handler, promise, previous: current, enumerable, users: 0 };
    workerHandlerScopes.set(workerClass, scope);
  }
  const ownedScope = scope;
  ownedScope.users += 1;
  let released = false;

  return {
    restore: () => {
      if (released) return false;
      released = true;
      ownedScope.users -= 1;
      if (ownedScope.users > 0) return false;
      if (workerHandlerScopes.get(workerClass) === ownedScope) {
        workerHandlerScopes.delete(workerClass);
      }
      const installed = Object.getOwnPropertyDescriptor(workerClass, cacheProperty);
      if (installed?.value !== ownedScope.promise ||
          installed.configurable !== true || installed.writable !== true ||
          installed.enumerable !== ownedScope.enumerable) return false;
      if (ownedScope.previous) {
        Object.defineProperty(workerClass, cacheProperty, ownedScope.previous);
      } else {
        Reflect.deleteProperty(workerClass, cacheProperty);
      }
      return true;
    },
  };
};
