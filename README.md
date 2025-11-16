# IT Contact Scraper - Apify Actor

## Überblick
Dieser Apify Actor extrahiert automatisch Kontaktdaten von IT-Entscheidern und Hiring-Verantwortlichen aus verschiedenen Online-Quellen.

### Hauptfunktionen
- Extrahiert **max. 2 Personen pro Firma** mit den relevantesten Positionen
- Unterstützt mehrere Datenquellen: Unternehmens-Websites, LinkedIn, XING, Impressum
- Validiert E-Mail-Adressen und Telefonnummern automatisch
- Priorisiert Kontakte nach Relevanz (CTO > CIO > IT Manager > HR Manager)
- Speichert Ergebnisse strukturiert im Apify Dataset

### Ziel-Rollen
**IT-Bereich:**
- CTO (Chief Technology Officer)
- CIO (Chief Information Officer)
- Head of IT / IT-Leiter
- VP Engineering
- Engineering Manager
- IT Manager

**HR/Recruiting:**
- Head of Talent Acquisition
- HR Director
- Recruiting Manager

## Limitierungen
- LinkedIn und XING zeigen oft nur eingeschränkte öffentliche Informationen ohne Login; Ergebnisse können je nach Region variieren.
- Webseiten-Strukturen sind heterogen — der Actor verwendet Heuristiken, die in einigen Fällen keine vollständigen Daten extrahieren.
- Keine Garantie auf Vollständigkeit oder Rechtmäßigkeit: Stelle sicher, dass du geltende Datenschutz- und Website-Nutzungsbedingungen beachtest (z. B. DSGVO, robots.txt). Dieser Actor macht keine juristische Prüfung.

## Schnellstart

### Minimale Konfiguration
```json
{
  "companies": ["SAP", "Siemens"]
}
```

### Empfohlene Konfiguration
```json
{
  "companies": ["SAP", "Siemens", "Bosch"],
  "region": "Germany",
  "maxConcurrency": 2,
  "rateLimitMs": 1000
}
```

## Input-Parameter

| Parameter | Typ | Erforderlich | Default | Beschreibung |
|-----------|-----|--------------|---------|--------------|
| `companies` | array | ✅ Ja | - | Liste der Unternehmensnamen |
| `region` | string | ❌ Nein | null | Land/Region (z.B. "Germany", "Austria") |
| `maxConcurrency` | integer | ❌ Nein | 2 | Anzahl gleichzeitiger Browser (1-10) |
| `rateLimitMs` | integer | ❌ Nein | 1000 | Wartezeit zwischen Requests (100-5000 ms) |

### Parameter-Details

**companies** (erforderlich)
- Array von Unternehmensnamen als Strings
- Beispiel: `["SAP", "Siemens", "BMW", "Deutsche Bank"]`

**region** (optional)
- Verbessert die Suchgenauigkeit für spezifische Länder
- Beispiele: `"Germany"`, `"DE"`, `"Austria"`, `"Switzerland"`

**maxConcurrency** (optional)
- Höhere Werte = schneller, aber mehr Ressourcen und CUs
- Empfehlung: `2` für kleine Listen, `5-10` für große Listen

**rateLimitMs** (optional)
- Verhindert Rate-Limiting durch Websites
- Empfehlung: `1000` ms (Standard)

## Output

### Datenstruktur
Jeder extrahierte Kontakt wird als JSON-Objekt im Apify Dataset gespeichert:

```json
{
  "company": "SAP SE",
  "location": "Walldorf",
  "salutation": "Herr",
  "firstName": "Max",
  "lastName": "Mustermann",
  "email": "max.mustermann@sap.com",
  "phone": "+49 6227 7-47474",
  "jobTitle": "CTO",
  "linkedInUrl": "https://linkedin.com/in/maxmustermann",
  "source": "linkedin",
  "scrapedAt": "2025-11-16T10:30:00Z"
}
```

### Feldübersicht

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `company` | string | Unternehmensname |
| `location` | string/null | Standort der Person |
| `salutation` | string/null | Anrede (z.B. "Herr", "Frau") |
| `firstName` | string/null | Vorname |
| `lastName` | string/null | Nachname |
| `email` | string/null | E-Mail-Adresse (validiert) |
| `phone` | string/null | Telefonnummer (validiert, E.164 Format) |
| `jobTitle` | string/null | Berufsbezeichnung/Position |
| `linkedInUrl` | string/null | LinkedIn oder XING Profil-URL |
| `source` | string | Datenquelle: `"website"`, `"linkedin"`, `"xing"`, `"impressum"` |
| `scrapedAt` | string | Zeitstempel der Extraktion (ISO 8601) |

### Export-Formate
Das Apify Dataset kann in verschiedenen Formaten exportiert werden:
- JSON
- CSV
- Excel (XLSX)
- HTML
- XML

## Kosten und Performance

### Compute Units (CUs) Schätzung
| Listengröße | maxConcurrency | Geschätzte CUs | Geschätzte Laufzeit |
|-------------|----------------|----------------|---------------------|
| 10 Firmen | 2 | 10-50 CUs | 5-15 Minuten |
| 50 Firmen | 2 | 50-250 CUs | 25-60 Minuten |
| 100 Firmen | 5 | 100-500 CUs | 20-40 Minuten |
| 500 Firmen | 10 | 500-2500 CUs | 60-120 Minuten |

**Hinweis:** Browser-Instanzen dominieren die Kosten. Faktoren:
- Anzahl der durchsuchten Seiten pro Firma
- CAPTCHAs und Zugangsbeschränkungen
- Netzwerk-Latenz und Antwortzeiten

### Performance-Tipps
- **Kleine Listen (< 50):** `maxConcurrency: 2`, `rateLimitMs: 1000`
- **Mittlere Listen (50-200):** `maxConcurrency: 5`, `rateLimitMs: 800`
- **Große Listen (> 200):** `maxConcurrency: 10`, `rateLimitMs: 500`

## Technische Details

### Datenquellen-Strategie
Der Actor durchsucht in folgender Reihenfolge:
1. **Unternehmens-Website** - Team-Seiten, Kontakt-Seiten
2. **LinkedIn** - Personensuche und öffentliche Profile
3. **XING** - Personensuche (primär DACH-Region)
4. **Impressum** - Fallback für allgemeine Kontakte

### Validierung
- **E-Mail:** RFC 5322 konform, generische Adressen ausgeschlossen (`info@`, `contact@`)
- **Telefon:** E.164 Format, 7-15 Ziffern
- **Duplikate:** Deduplizierung nach E-Mail-Adresse

### Priorisierung
Kontakte werden nach zwei Kriterien sortiert:
1. **Rollenwichtigkeit:** CTO (100) > CIO (95) > Head of IT (90) > ...
2. **Quellenqualität:** LinkedIn (100) > Website (80) > XING (70) > Impressum (60)

### Logging & Error-Handling
- **Logging:** Crawlee Log-System (INFO, WARNING, ERROR)
- **Retry-Strategie:** Automatische Wiederholungen bei temporären Fehlern
- **Rate Limiting:** Konfigurierbare Wartezeiten pro Domain

## Installation & Lokale Entwicklung

### Voraussetzungen
- Node.js 18+
- npm oder yarn

### Lokale Installation
```bash
# Repository klonen
git clone https://github.com/luki5793-ai/Kontaktdaten.git
cd Kontaktdaten

# Dependencies installieren
npm install

# Actor lokal ausführen
npm start
```

### Auf Apify Platform deployen
1. Erstelle einen neuen Actor auf [console.apify.com](https://console.apify.com)
2. Verbinde dein GitHub Repository
3. Wähle Branch: `claude/fix-actor-dependency-0116MnwMuiaam2CYQ51CdeGn`
4. Build und Deploy

## Best Practices

### Datenschutz & Compliance
⚠️ **Wichtig:** Dieser Actor extrahiert öffentlich verfügbare Daten. Beachte:
- **DSGVO/GDPR** - Stelle sicher, dass die Nutzung gesetzeskonform ist
- **robots.txt** - Respektiere Website-Richtlinien
- **Terms of Service** - Beachte Nutzungsbedingungen von LinkedIn, XING, etc.
- **Verwendungszweck** - Nutze Daten nur für legitime Geschäftszwecke

### Empfehlungen
- Verwende Proxies für große Runs (Apify Proxy)
- Implementiere Captcha-Handling bei Bedarf
- Teste zunächst mit kleinen Listen (5-10 Firmen)
- Überwache Logs auf Fehler und Warnungen

## Technologie-Stack
- **Framework:** [Crawlee 4.x](https://crawlee.dev/)
- **Browser:** Playwright mit Chromium
- **Runtime:** Node.js 20
- **Container:** Docker (Apify Base Image)

## Support & Beitrag
Bei Fragen oder Problemen öffne ein Issue auf GitHub.

## Lizenz
Dieses Projekt ist für den privaten und kommerziellen Gebrauch lizenziert. Beachte die Nutzungsbedingungen der durchsuchten Plattformen.
