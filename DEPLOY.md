# BunBite bereitstellen

Der Deployment-Status ist offen. Dieses Dokument beschreibt ein Verfahren; es belegt weder einen laufenden Produktionsdienst noch eine kanonische Domain oder einen aktuellen Release.

## 1. Fly-Bestand nur lesend prüfen

Vor jeder Änderung muss ein autorisierter Operator das Ziel eindeutig identifizieren:

```sh
flyctl auth whoami
flyctl orgs list
flyctl apps list
flyctl status --app bunbite --all
flyctl machines list --app bunbite
flyctl volumes list --app bunbite --all
flyctl ips list --app bunbite
flyctl certs list --app bunbite
flyctl secrets list --app bunbite
flyctl releases --app bunbite --image
```

Zu protokollieren sind Organisation, App, Maschinen, Volumes, Netzwerkidentität, Zertifikatsstatus, aktueller Image-Digest, Release-Historie sowie Namen und Provider-Digests der Secrets. `flyctl secrets list` zeigt keine Secret-Werte. Bei unklarer Identität oder Datenhoheit darf nichts erstellt, skaliert, neu gestartet, ersetzt oder bereitgestellt werden.

Die eingecheckte `fly.toml` beschreibt lediglich Konfigurationsabsicht und ist kein Nachweis des Live-Zustands.

## 2. Unveränderlichen Release qualifizieren

Aus einem sauberen, geprüften Quellstand:

1. Web-, Server-, i18n- und Browser-Prüfungen ausführen.
2. Das Container-Image exakt aus diesem Commit bauen.
3. Frische Build-Provenienz, Scanner-Rohdaten, SBOM und Drittanbieterhinweise an Commit und Image-Digest binden.
4. Deterministische Compliance-Ausgaben außerhalb des Repositorys erzeugen und vergleichen.
5. Den Laufzeitnachweis am exakten Image ausführen.
6. Commit, Registry-Digest, Evidenz-Hashes, getestetes Backup und Rollback-Digest im Release-Datensatz festhalten.

Historische Evidenz oder frühere Risikoentscheidungen gelten nicht automatisch für einen Neubau. Dieses öffentliche Web-Repository enthält keine aktuelle private Release-Evidenz und behauptet keine Compliance-Zertifizierung.

## 3. Secrets

Für das öffentliche Produktmodell sind ausschließlich diese Anwendungs-Secrets erforderlich:

- `QUOTA_HASH_SECRET`: mindestens 32 Zeichen, bildet pseudonymisierte keyed-HMAC-Kennungen für die UTC-Tagesquote.
- `ANALYTICS_ADMIN_TOKEN`: schützt die private Zusammenfassung aggregierter Ereigniszähler.

Werte gehören ausschließlich in den Secret Manager des Providers, niemals in Quellcode, Tickets, Screenshots oder Befehlsausgaben. Keine Zahlungs-, Checkout-, Abo-, Portal-, E-Mail-Zustellungs- oder Zugangsschlüssel-Secrets konfigurieren.

## 4. Deployment-Grenze

Eine Bereitstellung benötigt ausdrückliche Freigabe, ein getestetes Datenbackup, aktuelle Release-Evidenz und ein protokolliertes Rollback-Ziel. Bereitgestellt wird ein unveränderlicher Registry-Digest, kein beweglicher Tag. Das verifizierte Volume bleibt erhalten; eine Datenbank wird nur bei nachgewiesener Beschädigung wiederhergestellt.

Nach dem Deployment am exakten öffentlichen Ursprung prüfen:

- `/api/health`, App-Shell sowie lokale und Hosted-Bildoptimierung
- 50 Konvertierungen pro UTC-Tag, 20 MiB pro Datei, Stapelgröße 10 und Lastabweisung
- Deutsch, Englisch und Arabisch einschließlich arabischem RTL
- Datenschutz, Bedingungen, Support, `robots.txt` und Sitemap
- Analytics-Allowlist, DNT-Unterdrückung und vollständige Same-Origin-Prüfung mit Schema, Host und Port
- keine CORS-Freigabe für Analytics-Summary-Antworten, auch nicht bei 401 oder 503
- Sicherheitsheader, sauberer Neustart und Datenpersistenz
- ausschließlich `QUOTA_HASH_SECRET` und `ANALYTICS_ADMIN_TOKEN` als Anwendungs-Secrets

Das [Deployment-Runbook](docs/DEPLOYMENT_RUNBOOK.md) enthält die Release- und Rollback-Gates.

## English summary

Deployment remains pending. Inventory Fly with the exact read-only commands above, configure only `QUOTA_HASH_SECRET` and `ANALYTICS_ADMIN_TOKEN`, deploy an immutable digest only after explicit authorization, and require fresh source-bound release evidence.
