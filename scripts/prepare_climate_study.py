#!/usr/bin/env python3
"""Build a German teaching project from an attributed image collection."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import shutil
import struct
import time
import zipfile


def image_size(data):
    if data.startswith(b'\x89PNG'):
        return struct.unpack('>II', data[16:24])
    stream = io.BytesIO(data)
    stream.read(2)
    while True:
        marker = stream.read(1)
        if not marker:
            raise ValueError('Cannot determine image dimensions')
        if marker != b'\xff':
            continue
        code = stream.read(1)
        if code in [b'\xff', b'\xd8', b'\xd9']:
            continue
        length = struct.unpack('>H', stream.read(2))[0]
        if code in [b'\xc0', b'\xc1', b'\xc2']:
            _, height, width = struct.unpack('>BHH', stream.read(5))
            return width, height
        stream.read(length - 2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--materials', type=Path, required=True, help='Directory containing bilder/ and quellen.csv')
    parser.add_argument('--output', type=Path, default=Path('output/seminar/climate-images.sortboard.zip'))
    parser.add_argument('--copy-to', type=Path, help='Optional course handoff directory')
    args = parser.parse_args()
    rows = list(csv.DictReader((args.materials / 'quellen.csv').open(encoding='utf-8-sig')))
    if len(rows) != 12 or [r['id'] for r in rows] != [f'{i:02}' for i in range(1, 13)]:
        raise ValueError('Expected the twelve numbered images, in order.')
    credits = []
    assets, cards, blobs = [], [], {}
    now = int(time.time() * 1000)
    capacities = [1, 1, 2, 4, 2, 1, 1]
    stage_id, widget_id = 'study-qsort', 'study-grid'
    for index, row in enumerate(rows):
        path = args.materials / row['datei']
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != row['sha256']:
            raise ValueError(f'Checksum mismatch: {path.name}')
        width, height = image_size(data)
        asset_id = 'climate-' + row['id']
        archive_path = 'assets/' + path.name
        license_name = row['lizenz'] if row['id'] != '10' else 'Ministry copyright notice: non-commercial reproduction with attribution, subject to stated special conditions. No Creative Commons licence asserted.'
        credit = f"Image {row['id']}: {row['urheber']}\nOriginal title: {row['originaltitel']}\nRights: {license_name}\nRights link: {row['lizenz_url']}\nSource: {row['quellseite']}\nTeaching copy: resized proportionally to at most 1800 pixels; no additional crop. Image 12 rendered on white.\nSHA-256: {row['sha256']}"
        credits.append(credit)
        assets.append({'id': asset_id, 'mime': 'image/png' if path.suffix == '.png' else 'image/jpeg', 'file': archive_path})
        cards.append({'id': row['id'], 'kind': 'image', 'assetId': asset_id, 'createdAt': now + index,
            'x': 24 + index * 10, 'y': 120, 'z': index + 1,
            'meta': {'name': row['id'], 'notes': credit, 'tags': [], 'aspectRatio': width / height, 'originalFileName': path.name},
            'widgetAssignments': {stage_id: {'widgetId': widget_id, 'zoneId': 'images', 'order': index}}})
        blobs[archive_path] = data
    study = {'version': 1, 'taskLanguage': 'de', 'id': 'climate-images', 'title': 'Klimabilder',
        'introduction': 'Dieselben zwölf Bilder unter zwei Perspektiven: Zuerst sortierst du nach der Wichtigkeit des Klimawandels, danach nach deiner eigenen Handlungsmöglichkeit. Nach jedem Durchgang besprecht ihr die Entscheidungen; am Ende vergleicht ihr beide Sortierungen und schaut ausgewählte Momente im Replay an.',
        'reference': 'Lehrübung nach Metag et al. (2016), Perceptions of Climate Change Imagery, Science Communication 38(2), 197–227. https://doi.org/10.1177/1075547016635181\nDie zwölf Bilder sind eine eigene Auswahl. Die Studie verwendete 40 Bilder und neun Skalenpositionen; hier sind es zwölf Bilder und sieben Positionen. Dies ist keine Replikation und keine Q-Faktorenanalyse. Ein Foto von trockenem Boden oder Hochwasser belegt für sich keine Klimawandel-Ursache.',
        'credits': '\n\n'.join(credits),
        'comparisonQuestions': ['Welche Bilder haben ihre Position besonders stark verändert? Warum?',
            'Welche Bilder vermitteln Wichtigkeit, aber wenig eigene Handlungsmöglichkeit? Wie erklärt ihr den Unterschied?'],
        'scale': [{'value': i - 3, 'label': f'{i - 3:+}' if i > 3 else str(i - 3), 'capacity': c} for i, c in enumerate(capacities)],
        'rounds': [
            {'id': 'importance', 'title': 'Wichtigkeit', 'prompt': 'Dieses Bild gibt mir das Gefühl, dass der Klimawandel wichtig ist.'},
            {'id': 'ability-to-act', 'title': 'Handlungsmöglichkeit', 'prompt': 'Dieses Bild gibt mir das Gefühl, dass ich etwas gegen den Klimawandel tun kann.'},
        ]}
    widget = {'id': widget_id, 'kind': 'qsort', 'stageId': stage_id, 'title': 'Starke Ablehnung ← Deine Zustimmung → Starke Zustimmung', 'createdAt': now,
        'x': 24, 'y': 80, 'w': 1100, 'h': 650, 'z': 1, 'lanes': [{'id': 'images', 'label': 'Bilder zum Einordnen'}],
        'buckets': [{'id': f'score-{i}', 'label': s['label'], 'capacity': s['capacity']} for i, s in enumerate(study['scale'])]}
    board = {'version': 2, 'id': 'climate-images', 'updatedAt': now,
        'sortConfig': {'type': 'qsort', 'stacksEnabled': False, 'zoomEnabled': False, 'startInFullscreen': True},
        'cardW': 200, 'cardH': 140, 'cardLayoutMode': 'as-is', 'stacks': [],
        'workflow': {'templateId': 'qsort', 'stages': [{'id': stage_id, 'kind': 'qsort', 'name': 'Q-Sort', 'order': 0}], 'widgets': [widget]},
        'activeStageId': stage_id, 'cards': cards}
    project = {'version': 1, 'id': 'climate-images', 'name': 'Klimabilder', 'createdAt': now, 'updatedAt': now, 'study': study}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, payload in {'manifest.json': {'format': 'sortboard-project-export', 'version': 1},
            'project.json': project, 'board.json': board, 'sessions.json': [], 'assets.json': assets}.items():
            archive.writestr(name, json.dumps(payload, ensure_ascii=False, indent=2))
        for name, data in blobs.items():
            archive.writestr(name, data)
        archive.writestr('image-credits.txt', study['credits'])
    args.output.with_name('climate-images-credits.txt').write_text(study['credits'], encoding='utf-8')
    if args.copy_to:
        args.copy_to.mkdir(parents=True, exist_ok=True)
        shutil.copy2(args.output, args.copy_to / args.output.name)
    print(f'Prepared {args.output}: 12 verified original image files; 2 tasks; capacities {capacities}.')


if __name__ == '__main__':
    main()
