"""Restore the Unity data file from Git-sized parts before Pages deployment."""
from pathlib import Path
import hashlib
import json

build = Path(__file__).resolve().parent.parent / 'museum' / 'Build'
parts = build / 'data-parts'
manifest = json.loads((parts / 'manifest.json').read_text())
target = build / 'WebMuseum.data.unityweb'
digest = hashlib.sha256()
size = 0
with target.open('wb') as output:
    for item in manifest['parts']:
        block = (parts / item['name']).read_bytes()
        if len(block) != item['size'] or hashlib.sha256(block).hexdigest() != item['sha256']:
            raise ValueError(f"Invalid museum part: {item['name']}")
        output.write(block)
        digest.update(block)
        size += len(block)
if size != manifest['size'] or digest.hexdigest() != manifest['sha256']:
    raise ValueError('Restored museum data does not match manifest')
print(f'Restored and verified {size} bytes of Unity museum data')
