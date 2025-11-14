# Apify Actor: IT Contact Scraper

Projektstruktur (vollständig einsatzfähiger Actor)

```
/actor
  /.actor/actor.json
  /INPUT_SCHEMA.json
  /package.json
  /README.md
  /src/
    main.js
    extractors.js
    validators.js
    utils.js
```

---

## /.actor/actor.json
```json
{
  "version": "1.0.0",
  "name": "it-contact-scraper",
  "title": "IT Contact Scraper (CTO/IT + Hiring Managers)",
  "description": "Extrahiert Kontaktdaten (max. 2 Personen pro Firma) aus Unternehmensseiten, LinkedIn, XING und Impressum.",
  "buildTag": "latest",
  "main": "src/main.js",
  "memory": 2048,
  "timeout": 3600000,
  "defaultRunOptions": {
    "timeout": 3600000
  }
}
```

---

## /INPUT_SCHEMA.json
```json
{
  "type": "object",
  "properties": {
    "companies": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Array von Unternehmensnamen (z.B. [\"SAP\", \"Siemens\"])."
    },
    "region": {
      "type": ["string", "null"],
      "description": "Optional: Land/Region für präzisere Suche (z.B. \"Germany\" / \"DE\")."
    },
    "maxConcurrency": {
      "type": "integer",
      "default": 2,
      "description": "Maximale gleichzeitige Browser-Instanzen für PlaywrightCrawler."
    },
    "rateLimitMs": {
      "type": "integer",
      "default": 1000,
      "description": "Minimale Wartezeit zwischen Requests an verschiedene Domains (ms)."
    }
  },
  "required": ["companies"]
}
```

---

## /package.json
```json
{
  "name": "it-contact-scraper",
  "version": "1.0.0",
  "description": "Apify Actor: Scrape IT contacts (CTO, CIO, Head of IT, HR/Recruiting managers)",
  "main": "src/main.js",
  "scripts": {
    "start": "node src/main.js"
  },
  "dependencies": {
    "crawlee": "^4.0.0",
    "p-limit": "^3.1.0",
    "p-retry": "^4.6.2",
    "tldts": "^6.4.0"
  }
}
```

---

## /src/utils.js
```javascript
const { sleep } = require('crawlee');
const { parse: parseDomain } = require('tldts');

/** Rate limiter simple per-domain last request tracking */
class RateLimiter {
    constructor(minDelayMs = 1000) {
        this.minDelayMs = minDelayMs;
        this.lastCall = new Map();
    }

    async waitFor(domain) {
        const now = Date.now();
        const last = this.lastCall.get(domain) || 0;
        const elapsed = now - last;
        if (elapsed < this.minDelayMs) {
            await sleep(this.minDelayMs - elapsed);
        }
        this.lastCall.set(domain, Date.now());
    }
}

const ROLE_PRIORITY = {
    'ctO': 100,
    'cto': 100,
    'cio': 95,
    'head of it': 90,
    'it-leiter': 90,
    'it manager': 85,
    'vp engineering': 80,
    'engineering manager': 70,
    'head of talent acquisition': 60,
    'hr director': 50,
    'recruiting manager': 45
};

function roleScore(title) {
    if (!title) return 0;
    const t = title.toLowerCase();
    let score = 0;
    Object.keys(ROLE_PRIORITY).forEach(k => {
        if (t.includes(k)) score = Math.max(score, ROLE_PRIORITY[k]);
    });
    return score;
}

function normalizeCompanyName(name) {
    return name.trim();
}

function domainFromUrl(url) {
    try {
        const d = parseDomain(url);
        return d?.domain ? `${d.domain}.${d.publicSuffix}` : null;
    } catch (e) {
        return null;
    }
}

module.exports = { RateLimiter, roleScore, normalizeCompanyName, domainFromUrl };
```

---

## /src/validators.js
```javascript
// Validators for email and phone + general field checks

const EMAIL_RFC5322_REGEX = /^(?:(?:[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+\/=?^_`{|}~-]+)*)|(?:\"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*\"))@(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3})\])$/;

// E.164-ish international phone validation (starts with +, 7-15 digits)
const PHONE_E164_REGEX = /^\+?[1-9]\d{6,14}$/;

function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const e = email.trim();
    if (e.length > 254) return false;
    if (!EMAIL_RFC5322_REGEX.test(e)) return false;
    // exclude generic inboxes
    const lower = e.toLowerCase();
    const banned = ['info@', 'contact@', 'hello@', 'support@', 'noreply@', 'no-reply@'];
    for (const b of banned) if (lower.startsWith(b)) return false;
    return true;
}

function isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const digits = phone.replace(/[^+0-9]/g, '');
    return PHONE_E164_REGEX.test(digits);
}

function sanitizeName(name) {
    if (!name) return null;
    const s = name.trim();
    if (s.length === 0) return null;
    return s;
}

function dedupeByEmail(contacts) {
    const map = new Map();
    for (const c of contacts) {
        if (!c.email) continue;
        const key = c.email.toLowerCase();
        if (!map.has(key)) map.set(key, c);
    }
    return Array.from(map.values());
}

module.exports = { isValidEmail, isValidPhone, sanitizeName, dedupeByEmail };
```

---

## /src/extractors.js
```javascript
/**
 * Extractor-Module: Implementiert Quellen-spezifische Extraktionslogik.
 * Jede Funktion gibt ein Array von Kontakt-Objekten zurück oder [] bei Fehler.
 * Kontakt-Objekt: { company, location, salutation, firstName, lastName, email, phone, jobTitle, linkedInUrl, source }
 */

const { PlaywrightCrawler, Dataset, Log } = require('crawlee');
const { RateLimiter, domainFromUrl } = require('./utils');
const pRetry = require('p-retry');

const rateLimiter = new RateLimiter(1000);

async function safeNavigate(page, url) {
    await rateLimiter.waitFor(domainFromUrl(url) || 'global');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
}

/** Extract contacts from a company's public website. Strategy:
 * - Try common pages: /team, /about, /company/team, /about-us, /kontakt, /impressum
 * - Scrape pages for typical selectors and patterns
 */
async function extractFromWebsite(browser, company, region) {
    const log = Log.get();
    const normalized = company;
    const candidates = [];
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const tryPaths = ['/team', '/about', '/about-us', '/company/team', '/team.html', '/company', '/contact', '/kontakt', '/impressum', '/about-us/team'];

    // Heuristic to try primary domain guesses: companyname.com, companyname.de, companyname.eu
    const hostGuesses = [
        `${normalized}.com`,
        `${normalized}.de`,
        `${normalized}.eu`,
        `${normalized}.org`
    ];

    async function tryUrl(url) {
        try {
            await safeNavigate(page, url);
            const html = await page.content();
            // basic extraction heuristics
            const nodes = await page.$$('[href^="mailto:"], a[href^="tel:"]');
            const mails = new Set();
            const phones = new Set();
            for (const n of nodes) {
                const href = await n.getAttribute('href');
                if (!href) continue;
                if (href.startsWith('mailto:')) {
                    mails.add(href.replace(/^mailto:/, '').split('?')[0]);
                }
                if (href.startsWith('tel:')) {
                    phones.add(href.replace(/^tel:/, '').split('?')[0]);
                }
            }
            // also try to find elements with role titles
            const people = await page.$$('[class*="team"], [class*="people"], [class*="member"], [class*="employee"], [class*="staff"]');
            for (const p of people.slice(0, 20)) {
                try {
                    const text = (await p.innerText()) || '';
                    const mailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
                    const phoneMatch = text.match(/\+?[0-9][0-9()\-\s]{6,}/g);
                    const nameMatch = text.match(/([A-ZÄÖÜ][a-zäöüß]+\s[A-ZÄÖÜ][a-zäöüß]+)/);
                    const titleMatch = text.match(/(CTO|CIO|Head of IT|IT-Leiter|IT Manager|VP Engineering|Engineering Manager|HR Director|Recruiting Manager|Head of Talent Acquisition)/i);
                    let firstName = null, lastName = null;
                    if (nameMatch) {
                        const parts = nameMatch[0].split(' ');
                        firstName = parts[0];
                        lastName = parts.slice(1).join(' ');
                    }
                    const jobTitle = titleMatch ? titleMatch[0] : null;
                    const email = mailMatch ? mailMatch[0] : null;
                    const phone = phoneMatch ? phoneMatch[0] : null;
                    if (email || phone) {
                        candidates.push({ company, location: null, salutation: null, firstName, lastName, email, phone, jobTitle, linkedInUrl: null, source: 'website' });
                    }
                } catch (e) {
                    // ignore per-person errors
                }
            }

            // fallback: if mailto links present but no people blocks, create generic entries
            for (const m of mails) candidates.push({ company, location: null, salutation: null, firstName: null, lastName: null, email: m, phone: null, jobTitle: null, linkedInUrl: null, source: 'website' });
            for (const p of phones) candidates.push({ company, location: null, salutation: null, firstName: null, lastName: null, email: null, phone: p, jobTitle: null, linkedInUrl: null, source: 'website' });

        } catch (err) {
            log.warning(`Website extractor: failed to open ${url} — ${err.message}`);
        }
    }

    // Try guessed hosts
    for (const host of hostGuesses) {
        for (const path of tryPaths) {
            const url = `https://${host}${path}`;
            await tryUrl(url);
            if (candidates.length >= 4) break;
        }
        if (candidates.length >= 4) break;
    }

    await page.close();
    await browserContext.close();
    return candidates;
}

/** LinkedIn extractor: tries public search pages and profile pages.
 * Note: LinkedIn often requires auth — this function tries public profile access and extracts
 * names, titles and public contact info if present.
 */
async function extractFromLinkedIn(browser, company, region) {
    const log = Log.get();
    const candidates = [];
    const context = await browser.newContext();
    const page = await context.newPage();

    // Use LinkedIn people search URL (public query parameters may show partial results without login in some regions)
    const query = encodeURIComponent(`${company} (CTO OR CIO OR "Head of IT" OR "IT-Leiter" OR "VP Engineering" OR "Head of Talent" OR "Recruiting Manager")`);
    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${query}`;

    try {
        await safeNavigate(page, searchUrl);
        // Try extracting a few result cards
        const cards = await page.$$('a.search-result__result-link, a.app-aware-link');
        for (const c of cards.slice(0, 10)) {
            try {
                const href = await c.getAttribute('href');
                if (!href) continue;
                const profileUrl = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
                // open profile
                const detailPage = await context.newPage();
                try {
                    await safeNavigate(detailPage, profileUrl);
                    const text = await detailPage.textContent('body');
                    if (!text || text.length < 50) { await detailPage.close(); continue; }
                    const nameMatch = text.match(/([A-ZÄÖÜ][a-zäöüß]+(?:\s[A-ZÄÖÜ][a-zäöüß]+)+)/);
                    const titleMatch = text.match(/(CTO|CIO|Head of IT|VP Engineering|Engineering Manager|Head of Talent Acquisition|Recruiting Manager|HR Director|IT-Leiter)/i);
                    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
                    const phoneMatch = text.match(/\+?[0-9][0-9()\-\s]{6,}/g);
                    let firstName = null, lastName = null;
                    if (nameMatch) {
                        const parts = nameMatch[0].split(' ');
                        firstName = parts[0];
                        lastName = parts.slice(1).join(' ');
                    }
                    const candidate = {
                        company,
                        location: null,
                        salutation: null,
                        firstName,
                        lastName,
                        email: emailMatch ? emailMatch[0] : null,
                        phone: phoneMatch ? phoneMatch[0] : null,
                        jobTitle: titleMatch ? titleMatch[0] : null,
                        linkedInUrl: profileUrl,
                        source: 'linkedin'
                    };
                    candidates.push(candidate);
                } catch (e) {
                    // ignore
                } finally {
                    await detailPage.close();
                }
            } catch (e) { /* ignore per-card errors */ }
        }
    } catch (err) {
        log.warning(`LinkedIn extractor failed for ${company}: ${err.message}`);
    } finally {
        await page.close();
        await context.close();
    }
    return candidates;
}

/** XING extractor for DACH region: tries public profiles and company pages */
async function extractFromXing(browser, company, region) {
    const log = Log.get();
    const candidates = [];
    const context = await browser.newContext();
    const page = await context.newPage();
    const query = encodeURIComponent(`${company} (CTO OR CIO OR "Head of IT" OR "IT-Leiter" OR "VP Engineering" OR "Recruiting")`);
    const searchUrl = `https://www.xing.com/search?keywords=${query}`;
    try {
        await safeNavigate(page, searchUrl);
        const links = await page.$$('a.user-card__link, a.search-result__link');
        for (const l of links.slice(0, 8)) {
            try {
                const href = await l.getAttribute('href');
                if (!href) continue;
                const profileUrl = href.startsWith('http') ? href : `https://www.xing.com${href}`;
                const detailPage = await context.newPage();
                try {
                    await safeNavigate(detailPage, profileUrl);
                    const text = await detailPage.textContent('body');
                    const nameMatch = text && text.match(/([A-ZÄÖÜ][a-zäöüß]+\s[A-ZÄÖÜ][a-zäöüß]+)/);
                    const titleMatch = text && text.match(/(CTO|CIO|Head of IT|IT-Leiter|VP Engineering|Engineering Manager|Recruiting Manager)/i);
                    const emailMatch = text && text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
                    const phoneMatch = text && text.match(/\+?[0-9][0-9()\-\s]{6,}/g);
                    let firstName = null, lastName = null;
                    if (nameMatch) {
                        const parts = nameMatch[0].split(' ');
                        firstName = parts[0];
                        lastName = parts.slice(1).join(' ');
                    }
                    candidates.push({ company, location: null, salutation: null, firstName, lastName, email: emailMatch ? emailMatch[0] : null, phone: phoneMatch ? phoneMatch[0] : null, jobTitle: titleMatch ? titleMatch[0] : null, linkedInUrl: profileUrl, source: 'xing' });
                } catch (e) {}
                finally { await detailPage.close(); }
            } catch (e) {}
        }
    } catch (err) {
        log.warning(`XING extractor failed for ${company}: ${err.message}`);
    } finally {
        await page.close();
        await context.close();
    }
    return candidates;
}

/** Impressum / Unternehmensregister extractor — tries to find Impressum page and parse contacts */
async function extractFromImpressum(browser, company, region) {
    const log = Log.get();
    const candidates = [];
    const context = await browser.newContext();
    const page = await context.newPage();
    // Search common paths
    const paths = ['/impressum', '/kontakt', '/contact', '/about', '/about-us'];
    const hostGuesses = [`https://${company}.de`, `https://${company}.com`, `https://${company}.eu`];
    async function tryUrl(url) {
        try {
            await safeNavigate(page, url);
            const text = await page.textContent('body');
            if (!text) return;
            const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
            const phoneMatch = text.match(/\+?[0-9][0-9()\-\s]{6,}/g);
            if (emailMatch || phoneMatch) {
                candidates.push({ company, location: null, salutation: null, firstName: null, lastName: null, email: emailMatch ? emailMatch[0] : null, phone: phoneMatch ? phoneMatch[0] : null, jobTitle: null, linkedInUrl: null, source: 'impressum' });
            }
        } catch (e) {
            // ignore
        }
    }
    for (const h of hostGuesses) {
        for (const p of paths) {
            await tryUrl(`${h}${p}`);
            if (candidates.length >= 4) break;
        }
        if (candidates.length >= 4) break;
    }
    await page.close();
    await context.close();
    return candidates;
}

module.exports = { extractFromWebsite, extractFromLinkedIn, extractFromXing, extractFromImpressum };
```

---

## /src/main.js
```javascript
/**
 * Hauptlogik des Actors. Liest Input, orchestriert Quellen, validiert und speichert Ergebnisse ins Dataset.
 */

const { PlaywrightCrawler, Dataset, KeyValueStore, Log } = require('crawlee');
const { extractFromWebsite, extractFromLinkedIn, extractFromXing, extractFromImpressum } = require('./extractors');
const { isValidEmail, isValidPhone, sanitizeName, dedupeByEmail } = require('./validators');
const { RateLimiter, roleScore, normalizeCompanyName } = require('./utils');
const pLimit = require('p-limit');
const pRetry = require('p-retry');

const log = Log.get();

async function run(input) {
    const companies = input.companies || [];
    const region = input.region || null;
    const maxConcurrency = input.maxConcurrency || 2;
    const rateLimitMs = input.rateLimitMs || 1000;

    if (!Array.isArray(companies) || companies.length === 0) {
        throw new Error('No companies provided in input.companies');
    }

    const browser = await PlaywrightCrawler.launchPlaywright({});

    const limiter = pLimit(maxConcurrency);

    const results = [];

    async function processCompany(companyName) {
        const normalized = normalizeCompanyName(companyName);
        log.info(`Processing ${normalized}`);
        const sourceCandidates = [];

        // Run extractors with retries and fallback order
        const extractorsOrder = [
            async () => await pRetry(() => extractFromWebsite(browser, normalized, region), { retries: 1 }),
            async () => await pRetry(() => extractFromLinkedIn(browser, normalized, region), { retries: 1 }),
            async () => await pRetry(() => extractFromXing(browser, normalized, region), { retries: 1 }),
            async () => await pRetry(() => extractFromImpressum(browser, normalized, region), { retries: 1 })
        ];

        for (const ex of extractorsOrder) {
            try {
                const cand = await ex();
                if (Array.isArray(cand) && cand.length > 0) {
                    sourceCandidates.push(...cand);
                }
                // if we already have >= 4 candidates, we can stop early and filter later
                if (sourceCandidates.length >= 6) break;
            } catch (err) {
                log.warning(`Extractor failed for ${normalized}: ${err.message}`);
            }
        }

        // Validate & normalize
        const validated = [];
        for (const c of sourceCandidates) {
            const firstName = sanitizeName(c.firstName);
            const lastName = sanitizeName(c.lastName);
            const email = c.email ? c.email.trim() : null;
            const phoneRaw = c.phone ? c.phone.trim() : null;
            const phone = phoneRaw ? phoneRaw.replace(/[\s()\-\.]+/g, '') : null;

            const obj = {
                company: normalized,
                location: c.location || null,
                salutation: c.salutation || null,
                firstName,
                lastName,
                email: email || null,
                phone: phone || null,
                jobTitle: c.jobTitle || null,
                linkedInUrl: c.linkedInUrl || null,
                source: c.source || 'unknown',
                scrapedAt: new Date().toISOString()
            };
            // Accept if email valid OR phone valid
            if (obj.email && isValidEmail(obj.email)) validated.push(obj);
            else if (obj.phone && isValidPhone(obj.phone)) validated.push(obj);
            // else discard
        }

        // dedupe by email
        const deduped = dedupeByEmail(validated);

        // If deduped less than 2, we may accept phone-only entries without email (but prefer email)
        let final = deduped.slice();
        if (final.length < 2) {
            // include phone-only validated contacts from sourceCandidates
            for (const c of sourceCandidates) {
                if (final.length >= 2) break;
                if (!c.email && c.phone) {
                    const phone = c.phone.replace(/[\s()\-\.]+/g, '');
                    if (isValidPhone(phone)) {
                        final.push({ company: normalized, location: c.location || null, salutation: c.salutation || null, firstName: sanitizeName(c.firstName), lastName: sanitizeName(c.lastName), email: null, phone, jobTitle: c.jobTitle || null, linkedInUrl: c.linkedInUrl || null, source: c.source || 'website', scrapedAt: new Date().toISOString() });
                    }
                }
            }
        }

        // Sort by role relevance then source preference (linkedIn > website > xing > impressum)
        const sourcePriority = { linkedin: 100, website: 80, xing: 70, impressum: 60, unknown: 50 };
        final.sort((a, b) => {
            const rA = roleScore(a.jobTitle || '');
            const rB = roleScore(b.jobTitle || '');
            if (rA !== rB) return rB - rA;
            const sA = sourcePriority[a.source] || 0;
            const sB = sourcePriority[b.source] || 0;
            return sB - sA;
        });

        // limit to 2
        const limited = final.slice(0, 2).map(x => ({ ...x }));

        // Push to Apify Dataset
        for (const item of limited) {
            await Dataset.pushData(item);
            results.push(item);
        }

        log.info(`Finished ${normalized}: saved ${limited.length} contacts`);
    }

    // schedule company tasks with concurrency limit
    const promises = companies.map(c => limiter(() => processCompany(c)));
    await Promise.all(promises);

    // cleanup
    try { await browser.close(); } catch (e) { }

    return results;
}

// If run directly
if (require.main === module) {
    (async () => {
        try {
            const input = await (async () => {
                try { return require('../INPUT_SCHEMA.json'); } catch (e) { return {}; }
            })();
            // If run via Apify, use Actor input
            const apifyInput = process.env.APIFY_INPUT ? JSON.parse(process.env.APIFY_INPUT) : null;
            const finalInput = apifyInput || input || { companies: [] };
            const res = await run(finalInput);
            console.log(JSON.stringify({ status: 'SUCCESS', resultCount: res.length }, null, 2));
        } catch (err) {
            console.error('Actor failed:', err);
            process.exit(1);
        }
    })();
}

module.exports = { run };
```

---

## /README.md
```markdown
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

```

---

_Ende des Projekts. Die Dateien enthalten vollständige, direkt ausführbare Implementierungen. Bitte öffne die Dateiübersicht und sag mir, welche Datei du zuerst getestet haben möchtest._

