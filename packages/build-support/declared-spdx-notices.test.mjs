import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { declaredSpdxNotice } from './declared-spdx-notices.mjs';

const require = createRequire(new URL('../renderers/ebook/package.json', import.meta.url));
const epubRequire = createRequire(require.resolve('epubjs/package.json'));

test('SPDX supplements bind to published bytes and distinguish authors from copyright holders', async () => {
  for (const name of ['marks-pane', 'path-webpack']) {
    const directory = dirname(epubRequire.resolve(`${name}/package.json`));
    const metadata = JSON.parse(await readFile(join(directory, 'package.json')));
    const value = await declaredSpdxNotice(metadata, { directory });
    assert.equal(value.independentLicenseFile, 'absent');
    assert.equal(value.originalLicenseRecovered, false);
    assert.match(value.text, /not extracted from a separate LICENSE/);
    assert.match(value.text, /author metadata \(not a copyright-holder assertion\)/);
    assert.match(value.text, /Copyright \(c\) <year> <copyright holders>/);
    assert.doesNotMatch(value.text, /Copyright[^\n]*Fred Chasen/);
    if (name === 'marks-pane') assert.match(value.text, /Nick Stenning/);
    else { assert.match(value.text, /Copyright Node\.js contributors/); assert.match(value.text, /Copyright Joyent, Inc\./); }
    await assert.rejects(() => declaredSpdxNotice({ ...metadata, license: 'ISC' }), /SPDX declaration changed/);
    await assert.rejects(() => declaredSpdxNotice({ ...metadata, author: 'fabricated holder' }), /author metadata changed/);
  }
  assert.equal(await declaredSpdxNotice({ name: 'unreviewed', version: '1.0.0', license: 'MIT' }), null);
});

test('a declaration supplement cannot replace an existing original LICENSE', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'declared-mit-existing-'));
  try {
    const original = await readFile(new URL('./licenses/declarations/marks-pane-1.0.9.PACKAGE.json', import.meta.url));
    await writeFile(join(directory, 'package.json'), original);
    await writeFile(join(directory, 'LICENSE'), 'real independently supplied upstream text');
    await assert.rejects(() => declaredSpdxNotice(JSON.parse(original), { directory }), /Preserve the newly present original LICENSE/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
