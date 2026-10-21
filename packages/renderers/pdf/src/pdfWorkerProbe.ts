export const isPdfWorkerVersionMismatch = (error: unknown, apiVersion: string) =>
  typeof error === 'object' && error !== null && 'message' in error &&
  typeof error.message === 'string' &&
  error.message.startsWith(`The API version "${apiVersion}" does not match the Worker version "`);

export const hasNativePdfWorkerPort = (port: unknown, constructors: Array<typeof Worker | undefined>) =>
  constructors.some(WorkerClass => typeof WorkerClass === 'function' && port instanceof WorkerClass);
