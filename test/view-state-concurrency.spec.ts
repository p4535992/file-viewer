import { describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  createFileViewerViewStateController,
  registerFileViewerViewStateProvider,
  type FileViewerViewState,
  type FileViewerViewStateChange,
  type FileViewerViewStateProvider,
} from '../packages/core/src/index';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const host = () => parseHTML('<html><body><div id="viewer"></div></body></html>')
  .document.getElementById('viewer')! as unknown as HTMLElement;

describe('view-state controller request ownership', () => {
  it('does not commit a late result over the latest completed request', async () => {
    const root = host();
    const first = deferred<FileViewerViewState>();
    const second = deferred<FileViewerViewState>();
    let current: FileViewerViewState = { scale: 1 };
    registerFileViewerViewStateProvider(root, {
      getState: () => current,
      applyState: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    });
    const controller = createFileViewerViewStateController({ root: () => root });
    const old = controller.applyState({ scale: 2 });
    const latest = controller.applyState({ scale: 3 });
    current = { scale: 3 };
    second.resolve(current);
    await latest;
    first.resolve({ scale: 2 });
    await old;
    expect(controller.state?.scale).toBe(3);
  });

  it('ignores results and subscription callbacks from a replaced provider', async () => {
    const root = host();
    const result = deferred<FileViewerViewState>();
    let staleListener!: (change: FileViewerViewStateChange) => void;
    const provider: FileViewerViewStateProvider = {
      getState: () => ({ renderer: 'old' }),
      applyState: () => result.promise,
      subscribe: listener => { staleListener = listener; return () => {}; },
    };
    registerFileViewerViewStateProvider(root, provider);
    const changes = vi.fn();
    const controller = createFileViewerViewStateController({ root: () => root, onChange: changes });
    const old = controller.applyState({ scale: 2 });
    registerFileViewerViewStateProvider(root, { getState: () => ({ renderer: 'new' }) });
    controller.refreshProvider();
    staleListener({ state: { renderer: 'old' }, action: 'restore', source: 'api', timestamp: 1 });
    result.resolve({ renderer: 'old', scale: 2 });
    expect((await old)?.renderer).toBe('new');
    expect(controller.state?.renderer).toBe('new');
    expect(changes).not.toHaveBeenCalled();
  });

  it('does not resurrect a provider after destruction', async () => {
    const root = host();
    const result = deferred<FileViewerViewState>();
    registerFileViewerViewStateProvider(root, { getState: () => ({ scale: 1 }), applyState: () => result.promise });
    const controller = createFileViewerViewStateController({ root: () => root });
    const apply = controller.applyState({ scale: 2 });
    controller.destroy();
    result.resolve({ scale: 2 });
    expect(await apply).toBeNull();
    expect(controller.getState()).toBeNull();
    expect(controller.hasProvider()).toBe(false);
  });

  it('snapshots nested spreadsheet input before asynchronous provider work', async () => {
    const root = host();
    let received!: FileViewerViewState;
    const result = deferred<FileViewerViewState>();
    registerFileViewerViewStateProvider(root, {
      getState: () => ({}),
      applyState: state => { received = state; return result.promise; },
    });
    const controller = createFileViewerViewStateController({ root: () => root });
    const range = { sheetId: 1, startRow: 10, endRow: 12, startCol: 1, endCol: 2 };
    const apply = controller.applyState({ spreadsheet: { range } });
    range.startRow = 0;
    expect(received.spreadsheet?.range?.startRow).toBe(10);
    result.resolve(received);
    const returned = (await apply)!;
    returned.spreadsheet!.range!.startRow = 5;
    expect(controller.state?.spreadsheet?.range?.startRow).toBe(10);
  });
});
