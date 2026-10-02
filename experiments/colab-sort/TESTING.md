# CoLab Sort 0.2.0 · Teststand

2. Oktober 2026. Die Mehrpersonen-Implementierung wurde erneut getestet.

## Bestanden

**22/22 Node-Protokolltests** (`npm test`): echte Node-WebCrypto-Hashes und Blobs, ausdrücklich simulierte DataChannels und In-Memory-Persistenz. Abgedeckt sind fünf Teilnehmer, Bildtransfer, konkurrierende Claims, parallele Drags verschiedener Bilder, Gast-zu-Gast-Cursor/Profile/Pulse, verlorene und verspätete Presence, Live-Imports, gleiche Hashes, Gästeaustritt, Gastgeberverlust, Personenlimit inklusive Einladungen, falsche Antwortcodes ohne Sitzungsverlust, später Beitritt während Drags/Snapshots, Offline-Merge, Resume, fehlerhafte Peers, korrupte Dateien, Lease-Ablauf und Backpressure-Abbruch.

**Synthetischer Mengentest mit fünf Teilnehmern** (`npm run test:scale`):

| Messgröße | Ergebnis |
|---|---:|
| Unterschiedliche Originaldateien | 3.100 PNGs |
| Originalbytes im Board | 110.050.000 |
| Empfangen von jedem der vier leeren Gäste | 110.050.000 Bytes |
| Insgesamt vom Gastgeber gesendet | 440.200.000 Bytes |
| Geprüfte SHA-256-Empfänge | 12.400 |
| Maximal offene Anforderungen pro Browser-Modell | 4 |
| Erneute Bildbytes beim vollständigen Reconnect aller Gäste | 0 |

Die Dateien sind gültige, eindeutig gepolsterte synthetische PNGs, nicht der reale Nutzerdatensatz. Transport und Speicher sind simuliert: kein Netzwerk-, Browser-Speicher- oder IndexedDB-Benchmark.

**Chromium-UI-Test** (`npm run test:ui`): echter DOM/Canvas, Pointer-/Tastatur-Drag, Import/Deduplizierung, Originalvorschau, Zoom/Fit, vier benannte Cursor, Sprung zur Person, Teilnehmerliste, Fünf-Personen-Grenze, einzelner Gästeaustritt, zusätzliche Einladung ohne Verbindungsabbruch, falscher Antwortcode ohne Sitzungsverlust, Session-Aufräumen und 430-Pixel-Layout ohne horizontalen Seiten-Overflow. Keine JavaScript-Fehler.

Der UI-Test verwendet ausdrücklich einen In-Memory-Storage-/Hash-Adapter und synthetische Peer-Records/Signaling-Ausgabe. Screenshots sind UI-Testansichten, kein Beweis einer echten Netzwerkverbindung. Die Test-Harnesses sind nicht Bestandteil der ausgelieferten Demo.

## Hier nicht verifiziert

Der native Fünf-Browser-Kontext-Test wurde versucht, aber bereits beim Laden durch `net::ERR_BLOCKED_BY_ADMINISTRATOR` blockiert. Der verwaltete Browser hat eine URL-Blockliste und deaktiviert nicht-proxied WebRTC-UDP. Ein separater Playwright-Testbrowser ließ sich wegen fehlender DNS-Erreichbarkeit der Download-Hosts nicht installieren.

Somit nicht bestätigt: echte WebRTC-Verbindungen zwischen Browsern/Geräten, Browser-Kompatibilität, native IndexedDB-Persistenz über Reload und reale Übertragungsleistung. `tests/browser-native.py` ersetzt diese APIs nicht durch Mocks und meldet Blockierung/Fehler statt Erfolg.

## Manuelle Abnahme auf drei bis fünf Geräten

1. Auf allen Geräten dieselbe neue COLAB2-Version öffnen. Zunächst normales LAN/WLAN ohne Gastnetz-Isolation verwenden.
2. Einige Bilder importieren. Jeden Gast mit eigenem Offer/Answer verbinden; vorhandene Gäste müssen verbunden bleiben.
3. Namen/Farben, alle fremden Cursor, Sprung zur Person und „Hier!“-Pulse prüfen.
4. Verschiedene Bilder parallel ziehen, danach dasselbe Bild greifen: nur eine Person erhält die Sperre. Endpositionen auf allen Boards vergleichen.
5. Auf mehreren Gästen Bilder ergänzen, auch dieselbe Datei gleichzeitig. Keine doppelten Asset-Einträge; alle erhalten die Originale.
6. Vierten/fünften Gast während eines Drags verbinden. Er darf die Sperre nicht übernehmen und muss die gleiche Endposition sehen.
7. Einen Gast schließen/trennen: andere arbeiten weiter, Cursor/Sperren verschwinden, Platz wird frei.
8. Neu verbinden: vorhandene Hashes nicht erneut übertragen. Nach Reload lokale Kopie prüfen; neue Codes erforderlich.
9. Gastgeber schließen: alle werden lokal, Kopien bleiben. Keine automatische Gastgeber-Übernahme erwarten.
10. Mit dem echten Bestand (>3.000 Bilder, ca. 110 MB) Reaktionszeit, Upload, Speicherung und langsamere Geräte prüfen.
