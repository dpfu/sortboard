# CoLab Sort — Teststatus

Stand: 2. Oktober 2026.

## Bestanden

- **11/11 Protokolltests**: Content-IDs, Signal-Code-Validierung, Kamera-Koordinaten, Chunking, SHA-256-Integrität, Drag-Leases, verlorene Presence-Pakete, Duplikate, Resume, Live-Imports in beide Richtungen, Offline-Merge und Backpressure-Abbruch.
- **Synthetischer Mengentest**: 3.100 gültige kleine PNG-Objekte, insgesamt 110.050.000 Bytes; alle 3.100 Hashes geprüft; Wiederverbindung mit 0 erneut übertragenen Bildbytes. Das ist ein simulierter In-Memory-Transport, kein Netzwerk-Benchmark und nicht der reale Nutzerdatensatz.
- **Chromium-UI-Test**: Import, Pointer-/Keyboard-Drag, Zoom/Fit, Originalvorschau, Deduplizierung, Presence-Rendering, ungültige Signaling-Codes und 430-Pixel-Layout; keine JavaScript-Fehler.

## Hier nicht verifiziert

Die verwaltete Chromium-Umgebung blockiert Web-Adressen und nicht-proxied WebRTC-UDP. Deshalb konnten eine echte Browser-zu-Browser-Verbindung, native IndexedDB-Persistenz über Reload und reale Datei-/Netzwerkgeschwindigkeit hier nicht vollständig ausgeführt werden.

Das ist ausdrücklich **kein** Nachweis für NAT-/Firewall-Kompatibilität oder zwei physische Geräte.

## Manuelle Abnahme auf zwei Geräten

1. Beide Geräte in dasselbe normale LAN/WLAN bringen; Gastnetz/Client-Isolation vermeiden.
2. Kleines Bildset importieren und Offer/Answer-Codes austauschen.
3. In beide Richtungen Bilder ziehen, dasselbe Bild gleichzeitig greifen, Cursor-Namen/Farben und „Hier!“ prüfen.
4. Während der Sitzung auf beiden Seiten Bilder ergänzen.
5. Danach den echten Datensatz (>3.000 Bilder, ca. 110 MB) prüfen: Reaktionszeit, Speicher, Transferfortschritt und Fit/Zoom.
6. Verbindung unterbrechen und neu verbinden; bereits gespeicherte Bild-Hashes dürfen nicht erneut übertragen werden.
7. Browser neu laden, lokale Kopie prüfen und mit neuen Codes erneut verbinden.
