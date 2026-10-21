"""Collect original grants from exact public Cargo archives, without a build.

This is a conservative locked source profile, never a post-link symbol census.
The build stages check the lock and final WASM identities again.
"""
import argparse
import hashlib
import json
import re
import subprocess
import tarfile
import tomllib
from pathlib import Path

sha = lambda b: hashlib.sha256(b).hexdigest()
parser = argparse.ArgumentParser()
parser.add_argument('config', type=Path)
parser.add_argument('--upstream-source', type=Path)
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
config = json.loads(args.config.read_text())
if config.get('generationEntrypoint'):
    assert config['generationEntrypoint'] == 'packages/renderers/design/scripts/collect-postscript-notices.mjs'
    if not args.upstream_source:
        raise SystemExit('Stet notices use the pinned upstream collector; pass --upstream-source <checkout> (and --check for read-only validation).')
    command = ['node', str(root / config['generationEntrypoint']), str(args.upstream_source)]
    if args.check:
        command.append('--check')
    subprocess.run(command, check=True)
    raise SystemExit(0)
lock_bytes = (root / config['lock']).read_bytes()
lock = tomllib.loads(lock_bytes.decode())
materials = {}
packages = []

def material(name, data):
    digest = sha(data)
    text = data.decode('utf-8')
    assert sha(text.encode()) == digest
    materials[digest] = {'text': text, 'bytes': len(data)}
    return {'name': name, 'sha256': digest}

for package in lock['package']:
    if not package.get('checksum'):
        continue
    name, version = package['name'], package['version']
    archives = list((Path.home() / '.cargo/registry/cache').glob(f'*/{name}-{version}.crate'))
    assert archives, f'Missing exact public crate: {name}@{version}'
    archive = next(p for p in archives if sha(p.read_bytes()) == package['checksum'])
    with tarfile.open(archive) as stream:
        prefix = f'{name}-{version}/'
        metadata_bytes = stream.extractfile(prefix + 'Cargo.toml').read()
        metadata = tomllib.loads(metadata_bytes.decode())['package']
        declared = metadata.get('license')
        assert isinstance(declared, str) and declared, f'Missing declaration: {name}@{version}'
        legal = []
        for item in sorted(stream.getmembers(), key=lambda x: x.name):
            relative = item.name[len(prefix):]
            if item.isfile() and re.search(r'(^|/)(?:LICEN[CS]E|COPYING|COPYRIGHT|NOTICE)(?:[._-]|$)', relative, re.I):
                legal.append(material(relative, stream.extractfile(item).read()))
        supplement = config.get('supplements', {}).get(f'{name}@{version}')
        if supplement:
            data = (root / supplement['path']).read_bytes()
            assert sha(data) == supplement['sha256']
            legal.append(material(supplement['name'], data))
        assert legal, f'Original notice or reviewed declaration supplement required: {name}@{version}'
        packages.append({'name': name, 'version': version, 'declaredLicense': declared,
            'checksum': package['checksum'], 'packageMetadataSha256': sha(metadata_bytes),
            'source': f'https://static.crates.io/crates/{name}/{name}-{version}.crate',
            'profiles': [config['profile']], 'legalFiles': legal})

for entry in config.get('localPublicPackages', []):
    files = []
    for original in entry['legalFiles']:
        data = (root / original['path']).read_bytes()
        assert sha(data) == original['sha256']
        files.append(material(original['name'], data))
    packages.append({**{k: v for k, v in entry.items() if k != 'legalFiles'},
        'profiles': [config['profile']], 'legalFiles': files})

standard = {k: v for k, v in config['standardLibrary'].items() if k != 'legalFiles'}
standard['legalFiles'] = []
for entry in config['standardLibrary']['legalFiles']:
    data = (root / entry['path']).read_bytes()
    assert sha(data) == entry['sha256']
    standard['legalFiles'].append(material(entry['name'], data))

runtime = []
for path in config['runtimeFiles']:
    data = (root / path).read_bytes()
    runtime.append({'path': Path(path).name, 'bytes': len(data), 'sha256': sha(data)})

book = {'schemaVersion': 1, 'scope': 'Conservative exact locked source profile including host/build alternatives; no post-link or bit-identical rebuild claim.',
    'source': config.get('source', {}), 'lockSha256': sha(lock_bytes),
    'runtimeFiles': runtime, 'packages': sorted(packages, key=lambda x: (x['name'], x['version'])),
    'standardLibrary': standard, 'materials': materials}
output = root / config['output']
output.parent.mkdir(parents=True, exist_ok=True)
encoded = (json.dumps(book, ensure_ascii=False, indent=2) + '\n').encode()
if args.check:
    assert output.read_bytes() == encoded, 'Native notices differ from their exact source profile'
else:
    output.write_bytes(encoded)
print(f'{output.relative_to(root)}: {len(packages)} public packages, {len(materials)} original or explicitly reviewed materials')
