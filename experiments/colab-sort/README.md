# CoLab Sort — together, locally.

Experimenteller Zwei-Personen-Prototyp für kollaboratives Sortieren unveränderlicher JPG-/PNG-Dateien auf einer freien Fläche.

## Eigenschaften

- vollständig clientseitig; kein App-Backend, kein Account, keine Cloud-Datenbank
- manuelles WebRTC-Offer/Answer per Copy/Paste-Code
- absichtlich keine STUN-/TURN-Server (`iceServers: []`)
- Originalbilder bleiben unverändert und werden per SHA-256 adressiert
- lokale Persistenz in einer eigenen IndexedDB (`colab-sort-demo-v1`)
- nur fehlende Bilder werden P2P angefordert; bereits vorhandene Hashes werden wiederverwendet
- drei DataChannels: Control, Files und verlusttolerante Presence
- benannte, farbige Live-Cursor und Positions-Puls
- exklusive kurzlebige Drag-Leases verhindern, dass zwei Personen dasselbe Bild gleichzeitig ziehen
- deterministischer Merge lokaler Layoutänderungen nach Wiederverbindung
- Canvas-Renderer mit Viewport-Culling und begrenztem Thumbnail-Cache für viele kleine Bilder

Die Demo übernimmt aus Sortboard/FolderSort vor allem das Local-First-Datenmodell, die Trennung von Metadaten und Bild-Blobs, Weltkoordinaten/Kamera, natürliche Bildproportionen sowie Look & Feel. Sie verwendet bewusst keinen Closed-Sort-, Q-Sort- oder Hierarchie-Workflow.

## Start

`CoLabSort.html` ist die vollständige Demo in einer Datei. Lokal in einem aktuellen Desktop-Browser öffnen. Falls ein Browser sicherheitsrelevante APIs für `file://` einschränkt, kann dieselbe Datei statisch per HTTPS ausgeliefert werden; dafür ist weiterhin kein Collaboration-Backend nötig.

### Verbinden

1. Person A: Bilder hinzufügen → **Gemeinsam sortieren** → **Einladungscode erzeugen**.
2. Person B: **Einladung annehmen**, Code einfügen, Antwortcode zurückgeben.
3. Person A: Antwortcode einfügen → **Verbindung herstellen**.

Ohne STUN/TURN gibt es keine Erreichbarkeitsgarantie. Das Experiment ist primär für dasselbe LAN/WLAN gedacht; Gastnetz-Isolation, VPNs, Firewalls oder Browser-Richtlinien können auch dort direkte Verbindungen verhindern.

## Performance-Modell

Metadaten werden paginiert synchronisiert. Fehlende Originale werden per Hash erkannt, nach Nähe zur aktuellen Ansicht priorisiert und in höchstens 16-KiB-Blöcken über den geordneten Datei-Channel übertragen. `bufferedAmount` begrenzt den Sende-Puffer; höchstens vier Bildanforderungen sind gleichzeitig offen.

Der Canvas erzeugt keine tausenden DOM-Bildknoten. Es werden nur sichtbare Karten gezeichnet und höchstens 160 dekodierte Thumbnails im Cache gehalten.

Demo-Limits: 20.000 Bilder / 512 MiB pro Board, maximal 32 MiB und 40 Megapixel pro Bild.

## Status

Implementierter Demo-Prototyp. Protokoll, Mengenverhalten und UI wurden automatisiert geprüft; eine echte Zwei-Geräte-WebRTC-Abnahme war in der verwalteten Entwicklungsumgebung wegen Netzwerk-/Browser-Richtlinien nicht möglich. Details: [TESTING.md](./TESTING.md).

MIT, wie das Hauptprojekt.
