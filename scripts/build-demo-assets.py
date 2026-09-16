"""Build browser-sized demo assets from the locally curated source package.
Run with Python + Pillow. Source PNGs stay unchanged in output/demo-projects.
"""
from pathlib import Path
import hashlib
import json
import zipfile
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'output/demo-projects'
target = root / 'public/demo'
(target / 'images').mkdir(parents=True, exist_ok=True)
records = json.loads((source / 'metadata/images.json').read_text())['images']
presets = json.loads((source / 'metadata/presets.json').read_text())
with zipfile.ZipFile(source / 'projects/open-sort-60.sortboard.zip') as archive:
    cards = {c['id']: c for c in json.loads(archive.read('board.json'))['cards']}
images = []
for record in records:
    original = source / record['file']
    assert hashlib.sha256(original.read_bytes()).hexdigest() == record['metadata']['sha256']
    image = Image.open(original).convert('RGB')
    image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    destination = target / 'images' / (record['id'] + '.webp')
    image.save(destination, 'WEBP', quality=88, method=6)
    checksum = hashlib.sha256(destination.read_bytes()).hexdigest()
    meta = dict(cards[record['id']]['meta'])
    meta['originalFileName'] = record['name'].lower().replace(' ', '-') + '.webp'
    meta['aspectRatio'] = image.width / image.height
    meta['notes'] = meta['notes'].replace('Image SHA-256:', 'Source PNG SHA-256:')
    meta['notes'] += f'\nDemo copy: WebP, {image.width} x {image.height}, resized without cropping\nDemo copy SHA-256: {checksum}'
    images.append(dict(id=record['id'], pairId=record['pair_id'], title=record['metadata']['title'],
                       source='DiffusionDB / 2022' if record['variant']=='diffusiondb' else 'Imagegen / 2026',
                       file='images/' + destination.name, bytes=destination.stat().st_size,
                       sha256=checksum, meta=meta))
catalog = dict(version=1, images=images, presets=[dict(id=p['id'], name=p['name'], type=p['type'],
              imageIds=p['image_ids'], instructions=p['instructions'].replace('Arrange all 60 images', 'Arrange the images'), distribution=p.get('distribution')) for p in presets])
(target / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2)+'\n')
print(f'{len(images)} demo images: {sum(i["bytes"] for i in images)/1024/1024:.1f} MiB')
