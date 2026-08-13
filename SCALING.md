# BunBite: Kapazität und Skalierung

Die Hosted-Engine ist ein gemeinsam genutzter, kostenloser Dienst mit Fair-Use-Grenzen. Lokale Verarbeitung in Weboberfläche und Browser-Erweiterung verbraucht keine Hosted-Kapazität.

## Aktuelles Modell

Bilddekodierung und -kodierung belasten CPU und Arbeitsspeicher. SQLite speichert kleine Zähler für die aktuelle UTC-Tagesquote sowie aggregierte Analytics-Ereignisse. Die Bildpipeline erreicht typischerweise CPU- oder Speicherdruck, bevor die Zähler-Schreiblast zum Hauptengpass wird.

Der Server begrenzt Parallelität, Warteschlange, Burst-Rate, Payload, Dateigröße und Tagesnutzung. Die eingecheckten Werte sind Sicherheitsgrenzen, kein Benchmark und keine Produktionsgarantie:

- 50 erfolgreiche Hosted-Konvertierungen pro UTC-Tag und pseudonymisierter keyed-HMAC-Kennung
- höchstens 20 MiB pro Datei
- höchstens 10 Bilder pro Hosted-Stapel

## Zu beobachtende Signale

- Optimierungslatenz und 503-Lastabweisung
- 429-Antworten für Burst- oder Fair-Use-Grenzen
- Warteschlangentiefe und Prozessspeicher
- Ablehnung fehlerhafter oder zu großer Uploads
- SQLite-Wartezeit und Integritätsprüfung
- Volumen aggregierter Ereigniszähler, ohne neue Nutzerkennungen einzuführen

Analytics-Zähler sind keine Unique-Visitor-Messung. Die pseudonymisierte Quotenkennung gehört nicht in Analytics und wird in SQLite ausschließlich für den aktuellen UTC-Kalendertag behalten.

## Skalierungspfad

1. Das exakt bereitgestellte Artefakt mit repräsentativen Bildern messen.
2. CPU und Arbeitsspeicher erhöhen, bevor die Bildparallelität angehoben wird.
3. Warteschlangen- und Burst-Grenzen anhand gemessener Latenz und Speichernutzung abstimmen.
4. Bei SQLite bei einem Writer bleiben, solange der Speicher nicht bewusst neu entworfen wurde.
5. Vor mehreren Maschinen Quoten und Analytics in einen gemeinsamen Store verlagern oder eine SQLite-Replikation mit eindeutigem Primary einführen.

Jede Architektur-, Runtime- oder Basis-Image-Änderung benötigt frische, an Commit und Image-Digest gebundene Evidenz. Frühere Messungen oder Risikoentscheidungen werden nicht vererbt.

## English summary

Hosted image work is CPU- and memory-bound before aggregate counters become the main constraint. Measure the exact artifact, scale up first, and redesign shared state before adding machines. Local processing does not consume hosted capacity.
