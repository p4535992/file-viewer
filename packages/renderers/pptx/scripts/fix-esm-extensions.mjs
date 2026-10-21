import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(packageDir, 'dist');
const relativeSpecifierPattern = /(\bfrom\s*['"]|\bimport\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"])/g;

const hasKnownExtension = specifier => extname(specifier) !== '';

const resolveJsSpecifier = (fileDir, specifier) => {
  if (hasKnownExtension(specifier)) {
    return specifier;
  }

  const candidate = resolve(fileDir, `${specifier}.js`);
  if (existsSync(candidate)) {
    return `${specifier}.js`;
  }

  const indexCandidate = resolve(fileDir, specifier, 'index.js');
  return existsSync(indexCandidate) ? `${specifier}/index.js` : specifier;
};

async function collectModuleFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectModuleFiles(path));
      continue;
    }
    // Declarations use the same ESM module specifiers as the runtime files.
    // NodeNext consumers resolve .js specifiers to their adjacent .d.ts files.
    if (entry.isFile() && (extname(entry.name) === '.js' || entry.name.endsWith('.d.ts'))) {
      files.push(path);
    }
  }

  return files;
}

let changedCount = 0;

for (const file of await collectModuleFiles(distDir)) {
  const source = await readFile(file, 'utf8');
  const fileDir = dirname(file);
  const fixed = source.replace(relativeSpecifierPattern, (_match, prefix, specifier, suffix) => {
    return `${prefix}${resolveJsSpecifier(fileDir, specifier)}${suffix}`;
  });

  if (fixed !== source) {
    await writeFile(file, fixed, 'utf8');
    changedCount += 1;
  }
}

console.log(`[pptx-esm] Normalized relative import extensions in ${changedCount} file${changedCount === 1 ? '' : 's'}.`);
