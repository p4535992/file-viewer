import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Defaults to the built source package; an installed consumer can override it.
const packageDir = realpathSync(resolve(process.env.ARCHIVE_PACKAGE_DIR || fileURLToPath(new URL('../', import.meta.url))));
const require = createRequire(`${packageDir}/package.json`);
const { loadArchiveEntriesWithoutWorker: load } = await import(pathToFileURL(`${packageDir}/dist/archiveFallback.js`));
const JSZip = require('jszip');
const arrayBuffer = bytes => Uint8Array.from(bytes).buffer;
const text = new TextEncoder().encode('tiny archive bytes');
assert.equal(text.byteLength, 18);
const gzip = arrayBuffer(gzipSync(text));
const emptyGzip = arrayBuffer(gzipSync(new Uint8Array()));
const tar = new Uint8Array(1024);
tar.set(new TextEncoder().encode('tiny.txt'));
tar.set(new TextEncoder().encode('00000000006\0'), 124);
tar[156] = 48;
tar.set(new TextEncoder().encode('hello!'), 512);
const tgz = arrayBuffer(gzipSync(tar));
const extract = async entries => new Uint8Array(await (await entries[0].compressedFile.extract()).arrayBuffer());

test('baseline: default GZIP extraction preserves all 18 bytes', async () => {
  const entries = await load(gzip, 'tiny.txt.gz');
  assert.equal(entries[0].name, 'tiny.txt');
  assert.equal(entries[0].size, 18);
  assert.deepEqual(await extract(entries), text);
});
test('baseline: exact 18-byte GZIP budgets preserve content', async () => {
  assert.deepEqual(await extract(await load(gzip, 'tiny.txt.gz', { maxArchiveSize: 18, maxEntryPreviewSize: 18 })), text);
});
test('baseline: 17-byte aggregate budget rejects 18-byte GZIP output', async () => {
  await assert.rejects(load(gzip, 'tiny.txt.gz', { maxArchiveSize: 17, maxEntryPreviewSize: 18 }), /limit.*17|17.*limit/i);
});
test('baseline: 17-byte entry budget rejects 18-byte GZIP output', async () => {
  await assert.rejects(load(gzip, 'tiny.txt.gz', { maxArchiveSize: 18, maxEntryPreviewSize: 17 }), /limit.*17|17.*limit/i);
});
for (const filename of ['tiny.txt.gzip', 'tiny.txt.GZ']) {
  test(`${filename}: single-entry budget is honored`, async () => {
    await assert.rejects(load(gzip, filename, { maxEntryPreviewSize: 17 }), /limit/i);
    assert.deepEqual(await extract(await load(gzip, filename, { maxEntryPreviewSize: 18 })), text);
  });
}
test('zero budgets allow empty GZIP output', async () => {
  const entries = await load(emptyGzip, 'empty.gz', { maxArchiveSize: 0, maxEntryPreviewSize: 0 });
  assert.equal(entries[0].size, 0);
  assert.equal((await extract(entries)).byteLength, 0);
});
test('zero aggregate budget rejects nonempty output', async () => {
  await assert.rejects(load(gzip, 'tiny.gz', { maxArchiveSize: 0 }), /limit/i);
});
test('zero entry budget rejects nonempty output', async () => {
  await assert.rejects(load(gzip, 'tiny.gz', { maxEntryPreviewSize: 0 }), /limit/i);
});
for (const [filename, data] of [['tiny.tar', tar.buffer], ['tiny.tgz', tgz], ['tiny.tar.gz', tgz], ['tiny.TAR.GZ', tgz]]) {
  test(`${filename}: aggregate includes TAR headers and padding`, async () => {
    await assert.rejects(load(data, filename, { maxArchiveSize: 1023, maxEntryPreviewSize: 6 }), /limit.*1023|1023.*limit/i);
  });
  test(`${filename}: exact 1 KiB aggregate allows listing six-byte member despite five-byte preview budget`, async () => {
    const entries = await load(data, filename, { maxArchiveSize: 1024, maxEntryPreviewSize: 5 });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].size, 6);
    assert.equal(new TextDecoder().decode(await extract(entries)), 'hello!');
  });
}
for (const field of ['maxArchiveSize', 'maxEntryPreviewSize']) {
  for (const value of [-1, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, null, '18']) {
    test(`${field} rejects invalid ${String(value)}`, async () => {
      await assert.rejects(load(gzip, 'tiny.gz', { [field]: value }), { name: 'RangeError' });
    });
  }
}
test('explicit undefined limits retain defaults', async () => {
  assert.deepEqual(await extract(await load(gzip, 'tiny.gz', { maxArchiveSize: undefined, maxEntryPreviewSize: undefined })), text);
});
test('default limits are finite and shared with renderer', async () => {
  const { resolveArchiveLimits } = await import(pathToFileURL(`${packageDir}/dist/archiveLimits.js`));
  assert.deepEqual(resolveArchiveLimits(), { maxArchiveSize: 320 * 1024 * 1024, maxEntryPreviewSize: 64 * 1024 * 1024 });
});
test('unsupported format retains null fallback', async () => {
  assert.equal(await load(new ArrayBuffer(0), 'tiny.rar', { maxArchiveSize: NaN }), null);
});
test('missing DecompressionStream retains null GZIP fallback', async t => {
  t.mock.property(globalThis, 'DecompressionStream', undefined);
  assert.equal(await load(gzip, 'tiny.gz'), null);
  assert.equal(await load(tgz, 'tiny.tgz'), null);
  assert.equal((await load(tar.buffer, 'tiny.tar')).length, 1);
});
test('ZIP extraction and fallback ignore TAR/GZIP-specific budgets', async () => {
  const zip = new JSZip();
  zip.file('tiny.txt', text);
  const buffer = await zip.generateAsync({ type: 'arraybuffer' });
  assert.deepEqual(await extract(await load(buffer, 'tiny.zip', { maxArchiveSize: 0, maxEntryPreviewSize: NaN })), text);
});
test('corrupt small GZIP rejects', async () => {
  await assert.rejects(load(Uint8Array.of(1, 2, 3).buffer, 'tiny.gz'));
});

function fakeDecodedReader(t, chunks, { readError, cancelError } = {}) {
  let index = 0;
  const reader = {
    read: mock.fn(async () => {
      if (index < chunks.length) return { done: false, value: Uint8Array.from(chunks[index++]) };
      if (readError) throw readError;
      return { done: true };
    }),
    cancel: mock.fn(async () => { if (cancelError) throw cancelError; }),
    releaseLock: mock.fn(),
  };
  t.mock.method(Blob.prototype, 'stream', () => ({ pipeThrough: () => ({ getReader: () => reader }) }));
  return reader;
}
test('bounded stream accepts exact limit across chunks and releases lock without cancellation', async t => {
  const reader = fakeDecodedReader(t, [[1, 2], [], [3, 4]]);
  assert.deepEqual(await extract(await load(gzip, 'tiny.gz', { maxArchiveSize: 4, maxEntryPreviewSize: 4 })), Uint8Array.of(1, 2, 3, 4));
  assert.equal(reader.read.mock.callCount(), 4);
  assert.equal(reader.cancel.mock.callCount(), 0);
  assert.equal(reader.releaseLock.mock.callCount(), 1);
});
test('bounded stream stops at cross-chunk overflow, cancels once, and releases lock', async t => {
  const reader = fakeDecodedReader(t, [[1, 2], [3, 4, 5], [6]]);
  await assert.rejects(load(gzip, 'tiny.gz', { maxArchiveSize: 4 }), /limit.*4|4.*limit/i);
  assert.equal(reader.read.mock.callCount(), 2);
  assert.equal(reader.cancel.mock.callCount(), 1);
  assert.equal(reader.releaseLock.mock.callCount(), 1);
});
test('bounded stream rejects first over-budget chunk before reading again', async t => {
  const reader = fakeDecodedReader(t, [[1, 2], [3]]);
  await assert.rejects(load(gzip, 'tiny.gz', { maxEntryPreviewSize: 1 }), /limit/i);
  assert.equal(reader.read.mock.callCount(), 1);
  assert.equal(reader.cancel.mock.callCount(), 1);
  assert.equal(reader.releaseLock.mock.callCount(), 1);
});
test('bounded stream accepts empty output at zero and releases lock', async t => {
  const reader = fakeDecodedReader(t, []);
  assert.equal((await load(emptyGzip, 'empty.gz', { maxEntryPreviewSize: 0 }))[0].size, 0);
  assert.equal(reader.cancel.mock.callCount(), 0);
  assert.equal(reader.releaseLock.mock.callCount(), 1);
});
test('bounded stream preserves read failure, cancels and releases lock', async t => {
  const failure = new Error('tiny controlled read failure');
  const reader = fakeDecodedReader(t, [[1]], { readError: failure });
  await assert.rejects(load(gzip, 'tiny.gz'), error => error === failure);
  assert.equal(reader.cancel.mock.callCount(), 1);
  assert.equal(reader.cancel.mock.calls[0].arguments[0], failure);
  assert.equal(reader.releaseLock.mock.callCount(), 1);
});
test('bounded stream preserves overflow when cancellation rejects and still releases lock', async t => {
  const reader = fakeDecodedReader(t, [[1, 2]], { cancelError: new Error('tiny cancel failure') });
  await assert.rejects(load(gzip, 'tiny.gz', { maxArchiveSize: 1 }), /limit/i);
  assert.equal(reader.cancel.mock.callCount(), 1);
  assert.equal(reader.releaseLock.mock.callCount(), 1);
});
