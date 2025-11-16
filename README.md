# IT Contact Scraper - Apify Actor

## Verwendungszweck
Dieser Apify Actor extrahiert Kontaktdaten (max. 2 Personen pro Firma) für IT-Entscheider (z. B. CTO, CIO, Head of IT) und Hiring-/Recruiting-Verantwortliche (z. B. HR Director, Recruiting Manager). Die Extraktion nutzt mehrere Quellen (Unternehmens-Websites, LinkedIn, XING, Impressum) und speichert validierte Ergebnisse im Apify Dataset.

## Limitierungen
- LinkedIn und XING zeigen oft nur eingeschränkte öffentliche Informationen ohne Login; Ergebnisse können je nach Region variieren.
- Webseiten-Strukturen sind heterogen — der Actor verwendet Heuristiken, die in einigen Fällen keine vollständigen Daten extrahieren.
- Keine Garantie auf Vollständigkeit oder Rechtmäßigkeit: Stelle sicher, dass du geltende Datenschutz- und Website-Nutzungsbedingungen beachtest (z. B. DSGVO, robots.txt). Dieser Actor macht keine juristische Prüfung.

## Input-Parameter
Nutze `INPUT_SCHEMA.json`.

Beispiel:
```json
{
  "companies": ["SAP", "Siemens", "Bosch"],
  "region": "Germany",
  "maxConcurrency": 2,
  "rateLimitMs": 1000
}
```

## Output
Das Ergebnis wird als JSON-Objekte im Apify Dataset gespeichert. Schema:
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
  "linkedInUrl": "https://linkedin.com/in/...",
  "source": "linkedin",
  "scrapedAt": "2025-11-14T10:30:00Z"
}
```

## Kostenabschätzung (CUs)
- Browser-Instanzen dominieren die Kosten. Für kleine Listen (10-50 Firmen) mit `maxConcurrency: 2` rechnet man mit moderatem Verbrauch — grob 1-5 CU pro Firma, abhängig von Seitenzahl & Captchas.
- Für größere Runs (100+ Firmen) erhöhe Concurrency und Budget entsprechend. Aktuelle CU-Kosten variieren je nach Plattform und Plan.

## Logging & Error-Handling
- Logging über Crawlee `Log` (INFO, WARNING, ERROR)
- Retry-Strategie: einfache Retries pro Extraktor (p-retry)
- Rate limiting pro Domain (konfigurierbar über `rateLimitMs`)

## Installation & Ausführung
```bash
npm install
node src/main.js
```

Wenn du den Actor auf Apify/Actors ausführst, lade die Dateien hoch und setze `INPUT_SCHEMA.json` per Run-Input.

## Hinweise zur Produktion
- Ergänze Captcha-Handling (z. B. externe Solver) falls nötig.
- Ergänze Proxy-Rotation (Apify/Actor-Proxy) bei größeren Runs oder bei geografisch limitierten Ergebnissen.
- Erweiterte Named-Entity-Recognition (NER) kann die Trefferquote auf Teamseiten verbessern.
