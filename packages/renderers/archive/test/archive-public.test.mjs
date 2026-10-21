import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The workspace supplies jsdom. Installed-consumer runs supply their own root.
const consumerDir = resolve(process.env.CONSUMER_DIR || fileURLToPath(new URL('../../../../', import.meta.url)));
const require = createRequire(`${consumerDir}/package.json`);
const { JSDOM } = require('jsdom');
const packageDir = resolve(process.env.ARCHIVE_PACKAGE_DIR || fileURLToPath(new URL('../', import.meta.url)));
const archiveRequire = createRequire(`${packageDir}/package.json`);
const { renderFileViewerArchive } = await import(pathToFileURL(archiveRequire.resolve('@file-viewer/renderer-archive')));
const arrayBuffer = bytes => Uint8Array.from(bytes).buffer;
const text = new TextEncoder().encode('tiny archive bytes');
const gzip = arrayBuffer(gzipSync(text));
const repeatedGzip = arrayBuffer(gzipSync(new Uint8Array(96).fill(120)));
assert.ok(repeatedGzip.byteLength < 95);
const tar = new Uint8Array(1024);
tar.set(new TextEncoder().encode('tiny.txt'));
tar.set(new TextEncoder().encode('00000000006\0'), 124);
tar[156] = 48;
tar.set(new TextEncoder().encode('hello!'), 512);
const tgz = arrayBuffer(gzipSync(tar));

async function waitFor(predicate) {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Controlled public render did not settle in 1.5 seconds.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
async function render(t, buffer, filename, limits = {}) {
  const dom = new JSDOM('<div id="viewer"></div>', { url: 'https://archive.invalid/' });
  const target = dom.window.document.getElementById('viewer');
  const nested = mock.fn(async (data, type, child) => {
    child.textContent = new TextDecoder().decode(data);
    return { $el: child };
  });
  t.mock.method(console, 'error', () => {});
  const fetchSpy = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  t.after(() => dom.window.close());
  const instance = await renderFileViewerArchive(buffer, target, undefined, {
    filename,
    options: { locale: 'en', archive: { cache: false, workerUrl: 'https://archive.invalid/worker.js', ...limits } },
    renderNestedBuffer: nested,
  });
  t.after(async () => { await instance.unmount(); assert.equal(fetchSpy.mock.callCount(), 0); });
  await waitFor(() => target.querySelector('.archive-state')?.classList.contains('archive-hidden'));
  return {
    target, nested,
    entries: () => target.querySelectorAll('.archive-entry'),
    error: () => target.querySelector('.archive-error:not(.archive-hidden)')?.textContent || '',
  };
}

test('public entry forwards configured single-file GZIP entry budget', async t => {
  const result = await render(t, gzip, 'tiny.txt.gz', { maxArchiveSize: 100, maxEntryPreviewSize: 17 });
  assert.equal(result.entries().length, 0);
  assert.match(result.error(), /limit.*17/i);
  assert.equal(result.nested.mock.callCount(), 0);
});
test('public entry permits exact GZIP entry budget and selected content', async t => {
  const result = await render(t, gzip, 'tiny.txt.gz', { maxArchiveSize: 100, maxEntryPreviewSize: 18 });
  assert.equal(result.entries().length, 1);
  assert.equal(result.error(), '');
  result.entries()[0].click();
  await waitFor(() => result.nested.mock.callCount() === 1);
  assert.deepEqual(new Uint8Array(result.nested.mock.calls[0].arguments[0]), text);
});
test('public entry forwards aggregate expansion budget above compressed input size', async t => {
  const result = await render(t, repeatedGzip, 'tiny.gz', { maxArchiveSize: 95, maxEntryPreviewSize: 100 });
  assert.equal(result.entries().length, 0);
  assert.match(result.error(), /limit.*95/i);
});
test('public entry permits exact aggregate expansion budget', async t => {
  const result = await render(t, repeatedGzip, 'tiny.gz', { maxArchiveSize: 96, maxEntryPreviewSize: 100 });
  assert.equal(result.entries().length, 1);
  assert.equal(result.error(), '');
});
test('public entry honors zero single-file preview budget', async t => {
  const result = await render(t, gzip, 'tiny.gz', { maxEntryPreviewSize: 0 });
  assert.equal(result.entries().length, 0);
  assert.match(result.error(), /limit.*0/i);
});
test('public input cutoff remains enforced before fallback', async t => {
  const result = await render(t, gzip, 'tiny.gz', { maxArchiveSize: gzip.byteLength - 1 });
  assert.equal(result.entries().length, 0);
  assert.ok(result.error());
});
for (const filename of ['tiny.tgz', 'tiny.tar.gz']) {
  test(`${filename}: public entry rejects aggregate TAR output including padding`, async t => {
    const result = await render(t, tgz, filename, { maxArchiveSize: 1023, maxEntryPreviewSize: 6 });
    assert.equal(result.entries().length, 0);
    assert.match(result.error(), /limit.*1023/i);
  });
  test(`${filename}: public listing uses aggregate budget and selection enforces member budget`, async t => {
    const result = await render(t, tgz, filename, { maxArchiveSize: 1024, maxEntryPreviewSize: 5 });
    assert.equal(result.entries().length, 1);
    assert.equal(result.error(), '');
    result.entries()[0].click();
    assert.ok(result.error());
    assert.equal(result.nested.mock.callCount(), 0);
  });
  test(`${filename}: exact public member budget allows selected preview`, async t => {
    const result = await render(t, tgz, filename, { maxArchiveSize: 1024, maxEntryPreviewSize: 6 });
    result.entries()[0].click();
    await waitFor(() => result.nested.mock.callCount() === 1);
    assert.equal(new TextDecoder().decode(result.nested.mock.calls[0].arguments[0]), 'hello!');
  });
}
for (const limits of [{ maxArchiveSize: NaN }, { maxEntryPreviewSize: Infinity }, { maxArchiveSize: -1 }]) {
  test(`public entry rejects invalid options ${Object.keys(limits)[0]}=${Object.values(limits)[0]}`, async t => {
    const dom = new JSDOM('<div></div>');
    t.after(() => dom.window.close());
    const target = dom.window.document.querySelector('div');
    await assert.rejects(renderFileViewerArchive(gzip, target, undefined, { filename: 'tiny.gz', options: { archive: limits } }), { name: 'RangeError' });
    assert.equal(target.childElementCount, 0);
  });
}
