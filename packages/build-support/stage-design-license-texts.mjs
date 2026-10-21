import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { retainedBundleLicense } from './bundle-notices.mjs';

const workspace = resolve(import.meta.dirname, '../..');
const reviewed = [
  { name: 'ag-psd', version: '31.0.3', license: 'MIT', file: 'ag-psd-MIT.txt', sha256: '035430250509b801de02201d2f9bc9388a1220198f9276d38f4059df882e585c' },
  { name: 'fzstd', version: '0.1.1', license: 'MIT', file: 'fzstd-MIT.txt', sha256: '62249119bb7df6e54300f37a37145c26a6d4420410aac8881a119c5b427cf751' },
  { name: 'saxes', version: '6.0.0', license: 'ISC', file: 'saxes-ISC.txt', sha256: '0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e' },
];

/** Retain actual upstream texts, including inherited attribution; never synthesize copyright. */
export async function stageDesignLicenseTexts({ packageRoot = join(workspace, 'packages/renderers/design') } = {}) {
  const require = createRequire(join(packageRoot, 'package.json'));
  const writes = [];
  for (const entry of reviewed) {
    let directory = dirname(require.resolve(entry.name));
    let metadata;
    for (;;) {
      metadata = await readFile(join(directory, 'package.json')).then(bytes => JSON.parse(bytes)).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (metadata?.name === entry.name) break;
      assert.notEqual(directory, dirname(directory), `Design dependency owner not found: ${entry.name}`);
      directory = dirname(directory);
    }
    assert.equal(metadata.version, entry.version, `Unreviewed design dependency version: ${entry.name}`);
    assert.equal(metadata.license, entry.license, `Design dependency grant changed: ${entry.name}`);
    const retained = await retainedBundleLicense(metadata);
    const bytes = retained?.bytes || await readFile(join(directory, 'LICENSE'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `Original design license drift: ${entry.name}`);
    writes.push({ target: join(packageRoot, 'LICENSES', entry.file), bytes, ...entry });
  }
  for (const { target, bytes } of writes) await writeFile(target, bytes);
  return writes.map(({ target, name, version, sha256 }) => ({ target, name, version, sha256 }));
}
