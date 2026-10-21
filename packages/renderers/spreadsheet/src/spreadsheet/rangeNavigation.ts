import type {
  FileViewerApplyViewStateOptions,
  FileViewerSpreadsheetRange,
  FileViewerSpreadsheetNavigationStatus,
  FileViewerViewState,
  FileViewerViewStateChange,
  FileViewerViewStateProvider,
} from '@file-viewer/core';

type Options = {
  ready: Promise<void>;
  isVisibleSheet: (sheetId: number) => boolean;
  getScale: () => number;
  getState?: () => FileViewerViewState;
  restoreState?: (state: FileViewerViewState, isCurrent: () => boolean) => void | Promise<void>;
  fit?: FileViewerViewStateProvider['fit'];
  onNavigate?: () => void;
  jump: (range: FileViewerSpreadsheetRange) => void;
  clearJump: () => void;
};

const validRange = (range: FileViewerSpreadsheetRange) =>
  ['sheetId', 'startRow', 'startCol', 'endRow', 'endCol'].every(key => {
    const value = range[key as keyof FileViewerSpreadsheetRange];
    return Number.isSafeInteger(value) && value >= 0;
  }) && range.startRow <= range.endRow && range.startCol <= range.endCol &&
  range.endRow < 1048576 && range.endCol < 16384;

const cloneState = (state: FileViewerViewState): FileViewerViewState => ({
  ...state,
  zoom: state.zoom ? { ...state.zoom } : undefined,
  scroll: state.scroll ? { ...state.scroll } : undefined,
  navigation: state.navigation ? { ...state.navigation } : undefined,
  extra: state.extra ? { ...state.extra } : undefined,
  spreadsheet: state.spreadsheet ? {
    ...state.spreadsheet,
    range: state.spreadsheet.range ? { ...state.spreadsheet.range } : undefined,
  } : undefined,
});

/** Own requests from registration through parsing, virtual-window loading and paint. */
export const createSpreadsheetRangeNavigation = (options: Options) => {
  let stopped: 'failed' | 'disposed' | undefined;
  let status: FileViewerSpreadsheetNavigationStatus = 'idle';
  let highlighted: FileViewerSpreadsheetRange | undefined;
  type Request = {
    range?: FileViewerSpreadsheetRange;
    options: FileViewerApplyViewStateOptions;
    resolve: (state: FileViewerViewState) => void;
  };
  let pending: Request | undefined;
  let suppressEventsUntil = 0;
  const listeners = new Set<(change: FileViewerViewStateChange) => void>();
  const snapshot = (result = status): FileViewerViewState => {
    const state = cloneState(options.getState?.() || {});
    return {
      ...state,
      renderer: 'spreadsheet-openxml',
      scale: options.getScale(),
      spreadsheet: {
        ...state.spreadsheet,
        range: highlighted ? { ...highlighted } : undefined,
        status: result,
      },
    };
  };
  const emit = (
    action: FileViewerViewStateChange['action'],
    source: FileViewerViewStateChange['source'] = 'viewer',
    notify = pending?.options.notify !== false && Date.now() >= suppressEventsUntil,
  ) => {
    if (!notify) return;
    for (const listener of listeners) {
      listener({ state: snapshot(), action, source, timestamp: Date.now() });
    }
  };
  const settle = (result: FileViewerSpreadsheetNavigationStatus) => {
    status = result;
    const request = pending;
    pending = undefined;
    if (request) {
      request.resolve(snapshot());
      emit(request.options.action || 'restore', request.options.source || 'api', request.options.notify !== false);
    }
  };
  const cancel = (result: 'cancelled' | 'failed' | 'disposed' = 'cancelled') => {
    // Disposal is terminal, including when a late parser rejection arrives.
    if (stopped === 'disposed') return;
    const hadHighlight = !!highlighted;
    const hadPending = !!pending;
    if (result !== 'cancelled') stopped = result;
    highlighted = undefined;
    options.clearJump();
    settle(result);
    if (hadHighlight && !hadPending) emit('restore', 'viewer');
    if (result === 'disposed') listeners.clear();
  };
  // Consume failure even when no API request was made before parsing failed.
  void options.ready.catch(() => { if (!stopped) cancel('failed'); });
  const provider: FileViewerViewStateProvider = {
    getState: snapshot,
    fit: options.fit,
    subscribe(listener) {
      if (stopped !== 'disposed') listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    applyState(input, applyOptions = {}) {
      if (stopped) return snapshot(stopped);
      if (applyOptions.notify === false) suppressEventsUntil = Date.now() + 180;
      const state = cloneState(input);
      const range = state.spreadsheet?.range;
      cancel();
      if (range && !validRange(range)) {
        status = 'rejected';
        return snapshot();
      }
      const sheetId = range?.sheetId ?? state.spreadsheet?.sheetId;
      if (sheetId !== undefined && (!Number.isSafeInteger(sheetId) || sheetId < 0)) {
        status = 'rejected';
        return snapshot();
      }
      options.onNavigate?.();
      status = 'pending';
      return new Promise<FileViewerViewState>(resolve => {
        const request: Request = { range, options: { ...applyOptions }, resolve };
        pending = request;
        const isCurrent = () => pending === request && !stopped;
        const failed = () => { if (isCurrent()) cancel('failed'); };
        const jump = () => {
          if (!isCurrent()) return;
          try {
            if (range) options.jump(range);
            else settle('idle');
          } catch { failed(); }
        };
        void options.ready.then(() => {
          if (!isCurrent()) return;
          if (sheetId !== undefined && !options.isVisibleSheet(sheetId)) {
            settle('rejected');
            return;
          }
          try {
            const restored = options.restoreState?.(state, isCurrent);
            if (restored) void Promise.resolve(restored).then(jump, failed);
            else jump();
          } catch { failed(); }
        }, failed);
      });
    },
  };
  return {
    provider, cancel, notify: emit,
    isPending: () => !!pending?.range,
    /** Called after the target virtual window loads, before drawing the highlight. */
    prepare(totalRows: number, totalCols: number) {
      const request = pending;
      if (!request?.range) return null;
      if (request.range.endRow >= totalRows || request.range.endCol >= totalCols) {
        highlighted = undefined;
        options.clearJump();
        settle('rejected');
        return null;
      }
      highlighted = { ...request.range };
      return () => { if (pending === request) settle('applied'); };
    },
    contains(sheetId: number, row: number, col: number) {
      return !!highlighted && highlighted.sheetId === sheetId &&
        row >= highlighted.startRow && row <= highlighted.endRow &&
        col >= highlighted.startCol && col <= highlighted.endCol;
    },
  };
};
