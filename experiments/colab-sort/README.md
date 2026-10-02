# CoLab Sort · 0.2.0

Serverfreies, local-first Sortieren unveränderlicher JPG-/PNG-Dateien auf einem gemeinsamen Board — **bis zu fünf Personen inklusive Gastgeber**.

## Mehrpersonen-Sitzung

Ein Gastgeber-Browser verbindet bis zu vier Gäste in einer Sternstruktur. Alle können Bilder hinzufügen und verschieben. Teilnehmerliste, benannte farbige Live-Cursor, Drag-Vorschauen und „Hier!“-Pulse zeigen, wer wo arbeitet. Ein Klick auf eine Person springt zu deren letzter Cursor-Position.

Der Gastgeber verteilt Layout, Presence und Originaldateien und vergibt raumweite Drag-Sperren. Es gibt weiterhin keinen App-, Signaling-, STUN- oder TURN-Server (`iceServers: []`). **Der Gastgeber muss geöffnet bleiben.** Verlässt ein Gast die Sitzung, arbeiten die anderen weiter. Geht der Gastgeber verloren, endet die Live-Sitzung; bereits lokal gespeicherte Kopien bleiben erhalten. Kein vollständiges Mesh und keine automatische Gastgeber-Übernahme.

## Start und Verbindung

Die Quellfassung besteht jetzt aus mehreren lesbaren Dateien. Den gesamten Ordner herunterladen/auschecken und `CoLabSort.html` öffnen. Alle Skripte und Styles werden relativ aus demselben Ordner geladen; keine Runtime-Pakete, CDN-, Schrift- oder Analytics-Anfragen.

Für eine einzelne portable Datei:

```sh
node build-single.cjs
# Ausgabe: dist/CoLabSort.html
```

Diese erzeugte HTML-Datei enthält alle Skripte und Styles. Browser-Regeln für lokale Dateien können variieren; alternativ dieselben Dateien statisch per HTTPS bereitstellen, weiterhin ohne Collaboration-Backend.

1. Gastgeber: Bilder hinzufügen → **Gemeinsam sortieren** → **Einladungscode erzeugen**.
2. Gast: neue Demo öffnen → **Einladung annehmen** → Code einfügen → Antwortcode zurückgeben.
3. Gastgeber: Antwort einfügen → **Verbindung herstellen**.
4. Für jeden weiteren Gast **Nächste Person einladen** und einen **neuen** Code erzeugen. Bestehende Gäste bleiben verbunden.

Jede Einladung gilt für genau eine Verbindung. Eine neue offene Einladung ersetzt nur die vorherige noch unbeantwortete Einladung. Auch aufbauende Verbindungen reservieren einen Platz. Im Teilnehmerdialog kann der Gastgeber einen einzelnen Gast trennen.

Alle benötigen diese neue Version mit **`COLAB2.`-Codes**. Alte `COLAB1.`-Codes werden ausdrücklich abgewiesen. Das lokale IndexedDB-Format bleibt unverändert (`colab-sort-demo-v1`). Nach Reload oder Verbindungsabbruch neue Codes austauschen.

## Performance und Konsistenz

Originale sind SHA-256-adressierte, unveränderliche Blobs in IndexedDB. Nur fehlende Hashes werden übertragen. Der Gastgeber fordert denselben Hash nicht gleichzeitig von mehreren Gästen an und verteilt ihn erst nach Integritätsprüfung und Speicherung weiter. Vorab übergebene Dateien lassen sich lokal importieren, ohne das geteilte Layout zu überschreiben.

Pro Verbindung gibt es geordnete Control-/Dateikanäle und einen verlusttoleranten Presence-Kanal. Header und Dateiblöcke laufen auf demselben Datei-Channel. Die Blöcke sind höchstens 16 KiB groß; `maxMessageSize` und `bufferedAmount` werden berücksichtigt. Pro Browser höchstens vier offene Download-Anforderungen, üblicherweise höchstens 1 MiB angeforderte Bilddaten; eine einzelne größere Datei darf allein übertragen werden. Jeder Gast hat eigene Sende-Warteschlangen. Sichtbare bzw. nahe Bilder werden bevorzugt. Beim Reconnect werden gespeicherte Originale übersprungen; nur ein unvollständiges Einzelbild wird neu übertragen.

Bei 110 MB Originalen und vier leeren Gästen sendet der Gastgeber ungefähr vier Kopien, also 440 MB. Vorheriges lokales Importieren identischer Dateien spart diese Transfers.

Raumweite, zeitlich begrenzte Drag-Leases erlauben parallele Bewegungen unterschiedlicher Bilder, aber nur eine Person pro Bild. Cursor und Vorschauen dürfen Pakete verlieren. Die endgültige Position wird zuverlässig vom Gastgeber bestätigt und erst dann auf Gästen dauerhaft übernommen. Neue Gäste erhalten einen paginierten Snapshot plus währenddessen gepufferte Änderungen. Offline-Stände werden deterministisch zusammengeführt; ein beitretender Gast übernimmt keine aktive Drag-Sperre.

Canvas mit Viewport-Culling und höchstens 160 dekodierten Thumbnails im Cache; keine tausenden DOM-Bildknoten. Demo-Limits: 20.000 Bilder / 512 MiB pro Board, maximal 32 MiB und 40 Megapixel pro Bild.

## Dateien und Tests

`core.js`: Modell, Hashes, Codes. `store.js`: IndexedDB und Thumbnail-Cache. `peer.js`: einzelne WebRTC-Verbindung und Datei-Transport. `room.js`: Mehrpersonen-Sitzung, Relaying, Join-Abgleich, Leases und Download-Scheduler. `board.js`, `app.js`, `style.css`: Darstellung und Bedienung.

```sh
npm test                  # Node-Protokolltests, keine externen Pakete nötig
npm run test:scale        # 3.100 synthetische PNGs und fünf Teilnehmer
npm run build:single      # portable Einzeldatei
```

Optionale Browser-Tests benötigen Python, Playwright und Pillow:

```sh
python -m pip install playwright pillow
python -m playwright install chromium
npm run test:ui           # echte UI, ausdrücklich simulierte Storage-/Peer-Adapter
npm run test:e2e          # native WebRTC-/IndexedDB-Abnahme ohne Mocks
```

`CHROMIUM_PATH` wählt eine Browser-Binärdatei, `COLAB_URL` optional eine statisch bereitgestellte Demo für den nativen Test. `COLAB_TEST_OUT` bestimmt den Berichtspfad. Test-Adapter werden nie in die ausgelieferte HTML-Datei eingebunden. Details und Einschränkungen: **TESTING.md**.

## Grenzen

Ohne STUN/TURN keine Erreichbarkeitsgarantie. LAN/WLAN ist der Ausgangspunkt; Gastnetz-Isolation, Firewalls, VPNs oder Browser-Richtlinien können auch dort blockieren. Codes nur vertrauenswürdig austauschen: Jeder Gast kann das gesamte Board erhalten und verändern. Keine Accounts oder rollenbasierten Rechte. Experiment, kein gehärteter Mehrbenutzerdienst.

Look & Feel, Weltkoordinaten, natürliche Bildproportionen und die Trennung von Metadaten/Blobs basieren auf Sortboard/FolderSort. Keine Closed-Sort-, Q-Sort- oder Hierarchiefunktionen. MIT wie das Hauptprojekt.
