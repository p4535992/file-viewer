import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageDir = realpathSync(resolve(process.env.ARCHIVE_PACKAGE_DIR || fileURLToPath(new URL('../', import.meta.url))));
const { loadArchiveEntriesWithoutWorker: load } = await import(pathToFileURL(`${packageDir}/dist/archiveFallback.js`));
const encoder = new TextEncoder();
const content = encoder.encode('hello!');

function paxRecord(payload) {
  let length = encoder.encode(payload).length + 3;
  for (;;) {
    const record = `${length} ${payload}\n`;
    const bytes = encoder.encode(record);
    if (bytes.length === length) return bytes;
    length = bytes.length;
  }
}

function header(tar, offset, name, bytes, type) {
  tar.set(encoder.encode(name), offset);
  tar.set(encoder.encode('0000644\0'), offset + 100);
  tar.set(encoder.encode('0000000\0'), offset + 108);
  tar.set(encoder.encode('0000000\0'), offset + 116);
  tar.set(encoder.encode(bytes.length.toString(8).padStart(11, '0') + '\0'), offset + 124);
  tar.set(encoder.encode('00000000000\0'), offset + 136);
  tar.fill(32, offset + 148, offset + 156);
  tar[offset + 156] = type.charCodeAt(0);
  tar.set(encoder.encode('ustar\0'), offset + 257);
  tar.set(encoder.encode('00'), offset + 263);
  const checksum = tar.subarray(offset, offset + 512).reduce((sum, value) => sum + value, 0);
  tar.set(encoder.encode(checksum.toString(8).padStart(6, '0') + '\0 '), offset + 148);
  tar.set(bytes, offset + 512);
}

for (const type of ['x', 'g']) {
  for (const compressed of [false, true]) {
    test(`PAX ${type} metadata is hidden in ${compressed ? 'TAR.GZ' : 'TAR'} without altering file bytes`, async () => {
      const tar = new Uint8Array(3072);
      header(tar, 0, 'PaxHeaders.0/tiny.txt', paxRecord('comment=normal metadata'), type);
      header(tar, 1024, 'tiny.txt', content, '0');
      const bytes = compressed ? gzipSync(tar) : tar;
      const entries = await load(Uint8Array.from(bytes).buffer, compressed ? 'small.tar.gz' : 'small.tar', { maxTotalUncompressedBytes: tar.length, maxEntryBytes: content.length });
      assert.equal(entries.length, 1);
      assert.equal(entries[0].path, 'tiny.txt');
      assert.equal(entries[0].size, content.length);
      const extracted = new Uint8Array(await (await entries[0].compressedFile.extract()).arrayBuffer());
      assert.deepEqual(extracted, content);
    });
  }
}
