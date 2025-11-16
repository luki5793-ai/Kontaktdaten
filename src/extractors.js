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
