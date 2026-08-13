# BunBite Deployment-Runbook

Zielgruppe ist ein autorisierter Operator des Webdienstes. Dieses Runbook erteilt keine Deployment- oder Veröffentlichungsfreigabe. Die Chromium-Erweiterung wird in einem getrennten Distributions-Repository geprüft und veröffentlicht.

## Release-Datensatz

Für genau einen unveränderlichen Release festhalten:

- sauberer Git-Commit
- Container-Digest mit SHA-256
- Build-Werkzeuge und Runtime-Versionen
- Hashes von SBOM, Drittanbieterhinweisen, Scanner-Rohdaten und Build-Provenienz
- Ergebnis des exakten Laufzeitnachweises
- getestetes Backup und Rollback-Digest
- exakter kanonischer Ursprung und alle Abnahmeergebnisse

Frische deterministische Compliance-Erzeugung, Scanner-Evidenz und Laufzeitnachweis sind externe Release-Gates der privaten Release-Arbeitsumgebung. Das öffentliche Web-Repository enthält diese Toolchain und Evidenz nicht. Frühere Dossiers, Digests oder Risikoentscheidungen sind kein aktueller Nachweis und keine Zertifizierung.

## Quellcode-Gates

Mindestens ausführen:

```sh
node --check public/app.js
node --check public/i18n.js
node scripts/i18n-check.mjs .
node --experimental-websocket scripts/public-browser-smoke.mjs
bun server/test/core.ts
bun server/test/e2e.ts
```

Der Release-Build darf ausschließlich beabsichtigte und geprüfte Änderungen enthalten.

## Fly-Inventar

Die vollständigen, nur lesenden Befehle stehen in [DEPLOY.md](../DEPLOY.md). Erforderlich sind `flyctl auth whoami`, Organisations- und App-Liste sowie Status, Maschinen, Volumes, IPs, Zertifikate, Secret-Namen und Release-Historie für `--app bunbite`. Vor eindeutiger Zuordnung von Organisation, App und persistenten Daten darf kein mutierender Befehl laufen.

## Hosted-Service-Gates

1. Vorhandenes Ziel und Eigentümerschaft nur lesend bestätigen.
2. Persistente Daten per Provider-Snapshot oder SQLite-Online-Backup sichern.
3. Backup isoliert wiederherstellen; `PRAGMA integrity_check` muss `ok` liefern.
4. Unveränderlichen Digest auf das freigegebene Ziel deployen und das verifizierte Volume erhalten.
5. Health, lokale und Hosted-Verarbeitung, Fair-Use-Ablehnung, Lastabweisung, Neustartpersistenz und Graceful Shutdown prüfen.
6. Bestätigen, dass frühere kommerzielle Routen und Seiten 404 liefern.
7. Analytics prüfen:
   - nur die sechs dokumentierten Ereignisnamen;
   - Event-Body enthält nur `event`;
   - vollständige Same-Origin-Übereinstimmung einschließlich Schema, Host und Port;
   - keine öffentliche Summary;
   - Summary-Antworten besitzen auch bei 401 und 503 keine CORS-Freigabe;
   - ausschließlich aggregierte Tageszähler, keine Unique Visitors.
8. Quotenaufbewahrung prüfen: Beim Start sowie vor jedem Quoten-Lesen oder -Schreiben werden alle `usage`-Zeilen gelöscht, deren Tag nicht dem aktuellen UTC-Kalendertag entspricht. Gespeichert wird eine pseudonymisierte keyed-HMAC-Kennung, keine rohe Netzwerkadresse.
9. Datenschutz, Bedingungen, Support, Robots, Sitemap, Deutsch, Englisch und arabisches RTL am exakten Ursprung prüfen.

## Secrets

Nur diese Anwendungs-Secrets konfigurieren:

- `QUOTA_HASH_SECRET`
- `ANALYTICS_ADMIN_TOKEN`

Werte niemals in Release-Ticket oder Protokoll schreiben; während der Inventur nur Namen und Provider-Digests verifizieren. Keine Zahlungs-, Checkout-, Abo-, Portal-, E-Mail-Zustellungs- oder Zugangsschlüssel-Konfiguration hinzufügen.

## Browser-Erweiterung

Tests, Paketierung, Berechtigungsprüfung, Store-Signatur und Datenschutz-URL der Chromium-Erweiterung gehören in das separate Erweiterungs-Repository. Ein unsigniertes Prüfartefakt ist keine öffentliche Veröffentlichung. Dieses Web-Runbook enthält bewusst keine lokalen Erweiterungs-Buildbefehle und behauptet keinen Store-Status.

## Rollback

Bei einem Anwendungsfehler den zuvor protokollierten unveränderlichen Digest bereitstellen. Die aktuelle Datenbank bleibt erhalten, sofern die Schemas kompatibel sind. Daten nur bei nachgewiesener Beschädigung wiederherstellen, nachdem eine Vorfallkopie gesichert und das vorbereitete Backup validiert wurde.

## Release-Entscheidung

Release ist No-Go, solange eine erforderliche Prüfung, frische quellgebundene Evidenz, ein Backup-Nachweis, eine Ursprungsprüfung, eine Datenschutzoffenlegung oder ein unveränderlicher Artefaktbeleg fehlt. Lokale Quellcode-Nutzung bleibt möglich, während Deployment und Veröffentlichung offen sind.

## English summary

This runbook does not authorize deployment. Use the exact read-only Fly inventory, configure only the two documented application secrets, validate full same-origin analytics enforcement and current-day-only quota retention, and release only an immutable artifact with fresh source-bound evidence.
