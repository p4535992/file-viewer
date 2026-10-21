import type { FileViewerArchiveOptions } from '@file-viewer/core';

export type ArchiveLimits = Pick<FileViewerArchiveOptions, 'maxArchiveSize' | 'maxEntryPreviewSize'>;

const DEFAULT_MAX_ARCHIVE_SIZE = 320 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_PREVIEW_SIZE = 64 * 1024 * 1024;

const resolveByteLimit = (value: number | undefined, fallback: number, name: string) => {
  const limit = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer byte limit.`);
  }
  return limit;
};

export const resolveArchiveLimits = (options?: ArchiveLimits) => ({
  maxArchiveSize: resolveByteLimit(options?.maxArchiveSize, DEFAULT_MAX_ARCHIVE_SIZE, 'maxArchiveSize'),
  maxEntryPreviewSize: resolveByteLimit(options?.maxEntryPreviewSize, DEFAULT_MAX_ENTRY_PREVIEW_SIZE, 'maxEntryPreviewSize'),
});
