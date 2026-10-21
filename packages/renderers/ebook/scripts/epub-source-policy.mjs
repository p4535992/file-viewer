import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const IFRAME_SHA256 = 'ab700a110306c7e4716df790313b8055971cd92ca94b004289cded46ee283302';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const annotationMethods = ['highlight', 'underline', 'unhighlight', 'ununderline'];

export function assertUnusedAnnotationDrawing(source, ts, filename) {
  const ast = ts.createSourceFile(filename, source.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = node => {
    const name = ts.isPropertyAccessExpression(node) ? node.name.text
      : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text
      : null;
    assert.ok(!['annotations', ...annotationMethods].includes(name), `EPUB drawing is now used by ${filename}; retain it with a reviewed implementation`);
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

/** Remove only the pinned engine interface unused by both File Viewer products. */
export function withoutAnnotationDrawing(source, ts) {
  assert.equal(hash(source), IFRAME_SHA256, 'Unreviewed EPUB iframe source; review before specializing');
  const ast = ts.createSourceFile('iframe.js', source.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [];
  const removed = [];
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === 'marks-pane') {
      edits.push([statement.getFullStart(), statement.end]);
      removed.push('marks-pane import');
    }
    if (ts.isClassDeclaration(statement) && statement.name?.text === 'IframeView') {
      for (const member of statement.members) {
        if (ts.isMethodDeclaration(member) && annotationMethods.includes(member.name.getText(ast))) {
          edits.push([member.getFullStart(), member.end]);
          removed.push(member.name.getText(ast));
        }
      }
    }
  }
  assert.deepEqual(removed.sort(), ['marks-pane import', ...annotationMethods].sort());
  let contents = source.toString();
  for (const [start, end] of edits.sort((a, b) => b[0] - a[0])) contents = contents.slice(0, start) + contents.slice(end);
  return { contents, removed, originalSha256: hash(source), compiledSourceSha256: hash(contents) };
}

export async function epubSourcePolicy({ epubRoot, workspaceRoot, ts }) {
  const iframe = await realpath(join(epubRoot, 'src/managers/views/iframe.js'));
  const nodeRoot = join(workspaceRoot, 'packages/build-support/vendor/node-posix-path');
  const adapter = join(nodeRoot, 'path.js');
  const provenance = JSON.parse(await readFile(join(nodeRoot, 'SOURCE.json')));
  assert.equal(provenance.sourceSha256, 'c1c71083021675d1af30fa23861d383c3a3f84578ce6f6b16bc34d0a49d0d6b0');
  assert.equal(provenance.licenseSha256, '1914bfb950be8d576ce9e49c8a0e51c9f2402560fe3c19093e69bc1306a56e9e');
  for (const [file, digest] of [
    ['path.js', provenance.adapterSha256],
    ['upstream/path.js', provenance.sourceSha256],
    ['LICENSE', provenance.licenseSha256],
  ]) assert.equal(hash(await readFile(join(nodeRoot, file))), digest, `Node POSIX source drift: ${file}`);
  for (const file of ['packages/renderers/ebook/src/epub.ts', 'packages/thumbnail/src/embedded/epub.ts']) {
    assertUnusedAnnotationDrawing(await readFile(join(workspaceRoot, file)), ts, file);
  }
  const transforms = [];
  return {
    nodeRoot, adapter, provenance, transforms,
    plugin: {
      name: 'licensed-file-viewer-epub-sources',
      setup(context) {
        context.onResolve({ filter: /^path-webpack$/ }, args => {
          const importer = relative(epubRoot, args.importer).replaceAll('\\', '/');
          assert.ok(!isAbsolute(importer) && importer.startsWith('src/'), 'Unexpected path-webpack importer');
          return { path: adapter };
        });
        context.onResolve({ filter: /^marks-pane$/ }, () => {
          throw new Error('marks-pane reached the drawing-free EPUB graph; review original permission text before enabling drawing');
        });
        context.onLoad({ filter: /managers[\\/]views[\\/]iframe\.js$/ }, async args => {
          if (await realpath(args.path) !== iframe) return;
          const { contents, ...proof } = withoutAnnotationDrawing(await readFile(iframe), ts);
          transforms.push({ input: 'epubjs/src/managers/views/iframe.js', ...proof });
          return { contents, loader: 'js', resolveDir: resolve(epubRoot, 'src/managers/views') };
        });
      },
    },
  };
}
