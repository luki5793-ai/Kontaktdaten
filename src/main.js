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
