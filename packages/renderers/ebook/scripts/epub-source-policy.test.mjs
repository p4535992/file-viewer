import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import posix from '../../../build-support/vendor/node-posix-path/path.js';
import { assertUnusedAnnotationDrawing, withoutAnnotationDrawing } from './epub-source-policy.mjs';
const IFRAME_SHA256 = 'ab700a110306c7e4716df790313b8055971cd92ca94b004289cded46ee283302';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const epubRoot = resolve(require.resolve('epubjs/package.json'), '..');

test('licensed POSIX path handles EPUB root, relative segments, names and suffixes', () => {
  for (const [input, expected] of [
    ['', '.'], ['/', '/'], ['a/./b/../c/', 'a/c/'], ['../a/../../b', '../../b'],
    ['/../../OPS//text/', '/OPS/text/'], ['a\\b', 'a\\b'],
  ]) assert.equal(posix.normalize(input), expected);
  for (const [args, expected] of [
    [['OPS/text', '../Images/cover.png'], '/OPS/Images/cover.png'],
    [['/OPS/text/', '../../cover.png?size=1#front'], '/cover.png?size=1#front'],
    [['a', '/OPS/content.opf'], '/OPS/content.opf'],
  ]) assert.equal(posix.resolve(...args), expected);
  assert.equal(posix.relative('/OPS/text/', '/OPS/Images/cover.png'), '../Images/cover.png');
  assert.equal(posix.relative('', '/'), '');
  assert.equal(posix.relative('/OPS/', '/OPS/'), '');
  assert.equal(posix.join('OPS', '', '../Images', 'cover.png'), 'Images/cover.png');
  assert.deepEqual(posix.parse('/OPS/text/chapter.xhtml'), {
    root: '/', dir: '/OPS/text', base: 'chapter.xhtml', ext: '.xhtml', name: 'chapter',
  });
  for (const value of [null, undefined, {}, 2]) assert.throws(() => posix.normalize(value), TypeError);
});

test('unused drawing specialization is bound to the exact upstream source and does not mutate it', async () => {
  const source = await readFile(resolve(epubRoot, 'src/managers/views/iframe.js'));
  const transformed = withoutAnnotationDrawing(source, ts);
  assert.equal(transformed.originalSha256, IFRAME_SHA256);
  assert.notEqual(transformed.compiledSourceSha256, IFRAME_SHA256);
  assert.deepEqual(transformed.removed.sort(), ['marks-pane import', 'highlight', 'underline', 'unhighlight', 'ununderline'].sort());
  assert.doesNotMatch(transformed.contents, /from ['"]marks-pane['"]/);
  assert.throws(() => withoutAnnotationDrawing(Buffer.concat([source, Buffer.from('\n')]), ts), /Unreviewed EPUB iframe/);
  assert.deepEqual(await readFile(resolve(epubRoot, 'src/managers/views/iframe.js')), source);
});

test('future drawing use fails explicitly instead of silently losing a product capability', () => {
  assertUnusedAnnotationDrawing('rendition.display(); rendition.themes.default({});', ts, 'product.ts');
  for (const source of ['rendition.annotations.highlight();', 'view.highlight();', 'view["underline"]();'])
    assert.throws(() => assertUnusedAnnotationDrawing(source, ts, 'product.ts'), /drawing is now used/);
});

test('both real engine graphs exclude unused forks and retain original lifecycle bytes and full Node permission text', async () => {
  for (const owner of ['packages/renderers/ebook', 'packages/thumbnail']) {
    const root = resolve(import.meta.dirname, '../../../..', owner);
    const graph = JSON.parse(await readFile(resolve(root, '.build/epub-inputs.json')));
    for (const name of ['marks-pane', 'path-webpack']) {
      assert.ok(!graph.packages.some(p => p.name === name), `${name} remains in the real graph`);
    }
    assert.equal(graph.sourceTransforms.length, 1);
    assert.equal(graph.sourceTransforms[0].input, 'epubjs/src/managers/views/iframe.js');
    assert.equal(graph.sourceTransforms[0].originalSha256, IFRAME_SHA256);
    for (const filename of ['archive.js', 'resources.js', 'managers/views/iframe.js']) {
      const bytes = await readFile(resolve(epubRoot, 'src', filename));
      const file = graph.files.find(f => f.path.endsWith(`/epubjs/src/${filename}`));
      assert.equal(file?.sha256, createHash('sha256').update(bytes).digest('hex'));
    }
    assert.ok(graph.files.some(f => f.path.endsWith('/epubjs/src/managers/views/iframe.js') && f.sha256 === IFRAME_SHA256));
    const manifest = JSON.parse(await readFile(resolve(root, 'dist/vendor/epubjs.manifest.json')));
    assert.doesNotMatch(JSON.stringify(manifest), /"(?:before|after)"\s*:/, 'Private edit hunks must remain outside the published manifest');
    const bundle = await readFile(resolve(root, 'dist/vendor/epubjs.js'));
    assert.equal(createHash('sha256').update(bundle).digest('hex'), manifest.sha256, 'Final engine was overwritten by a compiler bridge');
    assert.equal(manifest.sourcePolicy.mode, 'licensed-posix-without-unused-drawing');
    assert.ok(!manifest.bundledPackages.some(p => ['marks-pane', 'path-webpack'].includes(p.name)));
    const node = graph.packages.find(p => p.name === 'nodejs-posix-path');
    assert.equal(node.licenseFiles.LICENSE.sha256, '1914bfb950be8d576ce9e49c8a0e51c9f2402560fe3c19093e69bc1306a56e9e');
    assert.ok(manifest.bundledPackages.some(p => p.name === 'nodejs-posix-path'));
    const notices = await readFile(resolve(root, 'dist/vendor/epubjs.NOTICE.txt'), 'utf8');
    assert.match(notices, /Copyright Node\.js contributors/);
    assert.match(notices, /Copyright Joyent, Inc\. and other Node contributors/);
    assert.match(notices, /Permission is hereby granted, free of charge/);
    assert.doesNotMatch(notices, /SPDX MIT标准文本/);
    assert.doesNotMatch(notices, /Copyright \(c\) <year> <copyright holders>/);
    assert.doesNotMatch(notices, /Copyright[^\n]*Fred Chasen/);
    assert.doesNotMatch(notices, /No license file was present/);
  }
});
