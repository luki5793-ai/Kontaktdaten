/**
 * Extraction functions for different data sources
 */

const { Actor } = require('apify');
const { PlaywrightCrawler } = require('crawlee');
const {
    extractEmailFromText,
    extractPhoneFromText,
    extractSalutation,
    normalizeCompanyName,
    retryWithBackoff,
    sleep
} = require('./utils');
const { sanitizeContact, validateContact } = require('./validators');

/**
 * Extract contacts from company website
 * @param {string} company - Company name
 * @param {Array<string>} targetRoles - Target roles to search for
 * @param {Object} proxyConfiguration - Proxy configuration
 * @returns {Promise<Array<Object>>} - Extracted contacts
 */
async function extractFromCompanyWebsite(company, targetRoles, proxyConfiguration) {
    Actor.log.info(`[${company}] Extracting from company website...`);

    const contacts = [];

    try {
        // Search for company website
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(company + ' official website')}`;

        const crawler = new PlaywrightCrawler({
            proxyConfiguration,
            requestHandlerTimeoutSecs: 60,
            maxRequestRetries: 2,
            async requestHandler({ page, request, enqueueLinks }) {
                Actor.log.info(`Processing: ${request.url}`);

                try {
                    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });

                    // If on Google search page, find and navigate to company website
                    if (request.url.includes('google.com/search')) {
                        const firstLink = await page.$('div#search a[href^="http"]');

                        if (firstLink) {
                            const href = await firstLink.getAttribute('href');
                            Actor.log.info(`Found company website: ${href}`);

                            // Enqueue company website and potential contact pages
                            await enqueueLinks({
                                urls: [
                                    href,
                                    `${href}/team`,
                                    `${href}/about`,
                                    `${href}/about-us`,
                                    `${href}/kontakt`,
                                    `${href}/contact`,
                                    `${href}/impressum`,
                                    `${href}/ueber-uns`,
                                    `${href}/leadership`,
                                    `${href}/management`
                                ]
                            });
                        }

                        return;
                    }

                    // Extract contact information from page
                    const pageContent = await page.content();
                    const textContent = await page.evaluate(() => document.body.innerText);

                    // Look for team members, contacts, or management sections
                    const teamSections = await page.$$('[class*="team"], [class*="about"], [class*="management"], [id*="team"], [id*="about"]');

                    for (const section of teamSections) {
                        const sectionText = await section.innerText().catch(() => '');

                        // Check if section contains target roles
                        const hasTargetRole = targetRoles.some(role =>
                            sectionText.toLowerCase().includes(role.toLowerCase())
                        );

                        if (!hasTargetRole) continue;

                        // Extract contact information
                        const email = extractEmailFromText(sectionText);
                        const phone = extractPhoneFromText(sectionText);

                        if (!email) continue;

                        // Try to extract name and title
                        const lines = sectionText.split('\n').filter(l => l.trim());

                        let firstName = '';
                        let lastName = '';
                        let jobTitle = '';
                        let salutation = '';

                        // Heuristic: find lines with target roles
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i].trim();

                            const matchingRole = targetRoles.find(role =>
                                line.toLowerCase().includes(role.toLowerCase())
                            );

                            if (matchingRole) {
                                jobTitle = line;

                                // Name is usually above or below the title
                                const nameLine = lines[i - 1] || lines[i + 1] || '';
                                const nameParts = nameLine.trim().split(/\s+/);

                                if (nameParts.length >= 2) {
                                    firstName = nameParts[0];
                                    lastName = nameParts.slice(1).join(' ');
                                    salutation = extractSalutation(nameLine);
                                }

                                break;
                            }
                        }

                        // If no structured data, try to extract from full text
                        if (!firstName && email) {
                            const emailPrefix = email.split('@')[0];
                            const nameParts = emailPrefix.split(/[._-]/);

                            if (nameParts.length >= 2) {
                                firstName = nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1);
                                lastName = nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1);
                            }
                        }

                        if (!jobTitle) {
                            const matchingRole = targetRoles.find(role =>
                                sectionText.toLowerCase().includes(role.toLowerCase())
                            );
                            jobTitle = matchingRole || '';
                        }

                        const contact = sanitizeContact({
                            company: normalizeCompanyName(company),
                            location: '',
                            salutation,
                            firstName,
                            lastName,
                            email,
                            phone: phone || '',
                            jobTitle,
                            linkedInUrl: '',
                            source: 'company_website',
                            scrapedAt: new Date().toISOString()
                        });

                        const validation = validateContact(contact);

                        if (validation.isValid) {
                            contacts.push(contact);
                            Actor.log.info(`[${company}] Found valid contact: ${contact.email}`);
                        } else {
                            Actor.log.warning(`[${company}] Invalid contact: ${validation.errors.join(', ')}`);
                        }
                    }

                    // Also check for general email/phone in page
                    const generalEmail = extractEmailFromText(textContent);
                    const generalPhone = extractPhoneFromText(textContent);

                    // Look for management team information
                    const namePatterns = /(?:Herr|Frau|Mr\.|Mrs\.|Ms\.)\s+([A-Z][a-zäöüß]+)\s+([A-Z][a-zäöüß]+)/g;
                    let match;

                    while ((match = namePatterns.exec(textContent)) !== null && contacts.length < 5) {
                        const salutation = match[0].split(' ')[0];
                        const firstName = match[1];
                        const lastName = match[2];

                        // Check if there's a job title nearby
                        const contextStart = Math.max(0, match.index - 100);
                        const contextEnd = Math.min(textContent.length, match.index + 200);
                        const context = textContent.slice(contextStart, contextEnd);

                        const matchingRole = targetRoles.find(role =>
                            context.toLowerCase().includes(role.toLowerCase())
                        );

                        if (matchingRole && generalEmail) {
                            // Try to construct email from name
                            const constructedEmail = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${generalEmail.split('@')[1]}`;

                            const contact = sanitizeContact({
                                company: normalizeCompanyName(company),
                                location: '',
                                salutation,
                                firstName,
                                lastName,
                                email: constructedEmail,
                                phone: generalPhone || '',
                                jobTitle: matchingRole,
                                linkedInUrl: '',
                                source: 'company_website',
                                scrapedAt: new Date().toISOString()
                            });

                            const validation = validateContact(contact);

                            if (validation.isValid) {
                                contacts.push(contact);
                                Actor.log.info(`[${company}] Found contact from text: ${contact.email}`);
                            }
                        }
                    }
                } catch (error) {
                    Actor.log.error(`Error processing ${request.url}: ${error.message}`);
                }
            },
            failedRequestHandler({ request, error }) {
                Actor.log.error(`Request ${request.url} failed: ${error.message}`);
            }
        });

        await crawler.run([searchUrl]);

        Actor.log.info(`[${company}] Company website extraction complete. Found ${contacts.length} contacts.`);
    } catch (error) {
        Actor.log.error(`[${company}] Error extracting from company website: ${error.message}`);
    }

    return contacts;
}

/**
 * Extract contacts from LinkedIn
 * @param {string} company - Company name
 * @param {Array<string>} targetRoles - Target roles to search for
 * @param {Object} proxyConfiguration - Proxy configuration
 * @returns {Promise<Array<Object>>} - Extracted contacts
 */
async function extractFromLinkedIn(company, targetRoles, proxyConfiguration) {
    Actor.log.info(`[${company}] Extracting from LinkedIn...`);

    const contacts = [];

    try {
        // Note: LinkedIn scraping requires login and may be blocked
        // This is a simplified implementation that searches for public profiles

        const roleQuery = targetRoles.slice(0, 3).join(' OR ');
        const searchQuery = `site:linkedin.com/in "${company}" (${roleQuery})`;
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;

        const crawler = new PlaywrightCrawler({
            proxyConfiguration,
            requestHandlerTimeoutSecs: 60,
            maxRequestRetries: 2,
            async requestHandler({ page, request }) {
                Actor.log.info(`Processing LinkedIn search: ${request.url}`);

                try {
                    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });

                    // Extract LinkedIn profile URLs from Google results
                    const links = await page.$$('div#search a[href*="linkedin.com/in/"]');

                    for (let i = 0; i < Math.min(links.length, 5); i++) {
                        const href = await links[i].getAttribute('href');

                        if (!href || !href.includes('linkedin.com/in/')) continue;

                        // Extract visible text around the link
                        const parentText = await links[i].evaluate(el => {
                            const parent = el.closest('div.g') || el.parentElement;
                            return parent ? parent.innerText : '';
                        });

                        // Try to extract name and title
                        const lines = parentText.split('\n').filter(l => l.trim());

                        let firstName = '';
                        let lastName = '';
                        let jobTitle = '';

                        // Usually first line is name, second is title
                        if (lines.length >= 2) {
                            const nameParts = lines[0].split(/\s+/).filter(p => p.length > 1);

                            if (nameParts.length >= 2) {
                                firstName = nameParts[0];
                                lastName = nameParts.slice(1).join(' ');
                            }

                            const matchingRole = targetRoles.find(role =>
                                lines[1].toLowerCase().includes(role.toLowerCase())
                            );

                            jobTitle = matchingRole || lines[1];
                        }

                        if (!firstName || !lastName) continue;

                        // Try to construct email (this is a guess)
                        const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`;

                        const contact = sanitizeContact({
                            company: normalizeCompanyName(company),
                            location: '',
                            salutation: extractSalutation(firstName),
                            firstName,
                            lastName,
                            email, // Note: This is a placeholder, not real
                            phone: '',
                            jobTitle,
                            linkedInUrl: href.split('?')[0], // Clean URL
                            source: 'linkedin',
                            scrapedAt: new Date().toISOString()
                        });

                        Actor.log.info(`[${company}] Found LinkedIn profile: ${contact.firstName} ${contact.lastName}`);

                        // Don't validate email since it's constructed
                        // Store for potential enrichment later
                        contacts.push(contact);
                    }
                } catch (error) {
                    Actor.log.error(`Error processing LinkedIn search: ${error.message}`);
                }
            },
            failedRequestHandler({ request, error }) {
                Actor.log.error(`LinkedIn request ${request.url} failed: ${error.message}`);
            }
        });

        await crawler.run([searchUrl]);

        Actor.log.info(`[${company}] LinkedIn extraction complete. Found ${contacts.length} profiles.`);
    } catch (error) {
        Actor.log.error(`[${company}] Error extracting from LinkedIn: ${error.message}`);
    }

    return contacts;
}

/**
 * Extract contacts from Xing
 * @param {string} company - Company name
 * @param {Array<string>} targetRoles - Target roles to search for
 * @param {Object} proxyConfiguration - Proxy configuration
 * @returns {Promise<Array<Object>>} - Extracted contacts
 */
async function extractFromXing(company, targetRoles, proxyConfiguration) {
    Actor.log.info(`[${company}] Extracting from Xing...`);

    const contacts = [];

    try {
        // Similar to LinkedIn, Xing requires login
        // This implementation searches for public profiles via Google

        const roleQuery = targetRoles.slice(0, 3).join(' OR ');
        const searchQuery = `site:xing.com/profile "${company}" (${roleQuery})`;
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;

        const crawler = new PlaywrightCrawler({
            proxyConfiguration,
            requestHandlerTimeoutSecs: 60,
            maxRequestRetries: 2,
            async requestHandler({ page, request }) {
                Actor.log.info(`Processing Xing search: ${request.url}`);

                try {
                    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });

                    // Extract Xing profile URLs from Google results
                    const links = await page.$$('div#search a[href*="xing.com/profile/"]');

                    for (let i = 0; i < Math.min(links.length, 5); i++) {
                        const href = await links[i].getAttribute('href');

                        if (!href || !href.includes('xing.com/profile/')) continue;

                        const parentText = await links[i].evaluate(el => {
                            const parent = el.closest('div.g') || el.parentElement;
                            return parent ? parent.innerText : '';
                        });

                        const lines = parentText.split('\n').filter(l => l.trim());

                        let firstName = '';
                        let lastName = '';
                        let jobTitle = '';

                        if (lines.length >= 2) {
                            const nameParts = lines[0].split(/\s+/).filter(p => p.length > 1);

                            if (nameParts.length >= 2) {
                                firstName = nameParts[0];
                                lastName = nameParts.slice(1).join(' ');
                            }

                            const matchingRole = targetRoles.find(role =>
                                lines[1].toLowerCase().includes(role.toLowerCase())
                            );

                            jobTitle = matchingRole || lines[1];
                        }

                        if (!firstName || !lastName) continue;

                        const contact = sanitizeContact({
                            company: normalizeCompanyName(company),
                            location: '',
                            salutation: extractSalutation(firstName),
                            firstName,
                            lastName,
                            email: '', // Xing doesn't expose emails publicly
                            phone: '',
                            jobTitle,
                            linkedInUrl: href.split('?')[0],
                            source: 'xing',
                            scrapedAt: new Date().toISOString()
                        });

                        Actor.log.info(`[${company}] Found Xing profile: ${contact.firstName} ${contact.lastName}`);

                        contacts.push(contact);
                    }
                } catch (error) {
                    Actor.log.error(`Error processing Xing search: ${error.message}`);
                }
            },
            failedRequestHandler({ request, error }) {
                Actor.log.error(`Xing request ${request.url} failed: ${error.message}`);
            }
        });

        await crawler.run([searchUrl]);

        Actor.log.info(`[${company}] Xing extraction complete. Found ${contacts.length} profiles.`);
    } catch (error) {
        Actor.log.error(`[${company}] Error extracting from Xing: ${error.message}`);
    }

    return contacts;
}

/**
 * Extract contacts from company register / Impressum
 * @param {string} company - Company name
 * @param {Array<string>} targetRoles - Target roles to search for
 * @param {Object} proxyConfiguration - Proxy configuration
 * @returns {Promise<Array<Object>>} - Extracted contacts
 */
async function extractFromCompanyRegister(company, targetRoles, proxyConfiguration) {
    Actor.log.info(`[${company}] Extracting from company register / Impressum...`);

    const contacts = [];

    try {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(company + ' Impressum')}`;

        const crawler = new PlaywrightCrawler({
            proxyConfiguration,
            requestHandlerTimeoutSecs: 60,
            maxRequestRetries: 2,
            async requestHandler({ page, request }) {
                Actor.log.info(`Processing: ${request.url}`);

                try {
                    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });

                    const textContent = await page.evaluate(() => document.body.innerText);

                    // Look for Geschäftsführer, CEO, management information
                    const managementKeywords = ['Geschäftsführer', 'CEO', 'Vorstand', 'Managing Director', 'Geschäftsführung'];

                    const hasManagement = managementKeywords.some(kw =>
                        textContent.includes(kw)
                    );

                    if (!hasManagement) return;

                    // Extract contact information
                    const email = extractEmailFromText(textContent);
                    const phone = extractPhoneFromText(textContent);

                    // Extract names and titles
                    const patterns = [
                        /(?:Geschäftsführer|CEO|Vorstand):\s*([A-ZÄÖÜ][a-zäöüß]+\s+[A-ZÄÖÜ][a-zäöüß]+)/g,
                        /(?:Herr|Frau)\s+([A-ZÄÖÜ][a-zäöüß]+)\s+([A-ZÄÖÜ][a-zäöüß]+)/g
                    ];

                    for (const pattern of patterns) {
                        let match;

                        while ((match = pattern.exec(textContent)) !== null && contacts.length < 3) {
                            const fullMatch = match[0];
                            const namePart = match[1];

                            let firstName = '';
                            let lastName = '';
                            let salutation = '';
                            let jobTitle = '';

                            if (fullMatch.includes('Herr') || fullMatch.includes('Frau')) {
                                salutation = fullMatch.split(' ')[0];
                                firstName = match[1];
                                lastName = match[2];
                            } else {
                                const names = namePart.split(/\s+/);
                                firstName = names[0];
                                lastName = names.slice(1).join(' ');
                            }

                            // Determine job title from context
                            if (fullMatch.includes('Geschäftsführer') || fullMatch.includes('CEO')) {
                                jobTitle = 'CEO';
                            } else if (fullMatch.includes('Vorstand')) {
                                jobTitle = 'Vorstand';
                            }

                            if (email && firstName && lastName) {
                                const contact = sanitizeContact({
                                    company: normalizeCompanyName(company),
                                    location: '',
                                    salutation,
                                    firstName,
                                    lastName,
                                    email,
                                    phone: phone || '',
                                    jobTitle,
                                    linkedInUrl: '',
                                    source: 'impressum',
                                    scrapedAt: new Date().toISOString()
                                });

                                const validation = validateContact(contact);

                                if (validation.isValid) {
                                    contacts.push(contact);
                                    Actor.log.info(`[${company}] Found contact from Impressum: ${contact.email}`);
                                }
                            }
                        }
                    }
                } catch (error) {
                    Actor.log.error(`Error processing company register: ${error.message}`);
                }
            },
            failedRequestHandler({ request, error }) {
                Actor.log.error(`Company register request ${request.url} failed: ${error.message}`);
            }
        });

        await crawler.run([searchUrl]);

        Actor.log.info(`[${company}] Company register extraction complete. Found ${contacts.length} contacts.`);
    } catch (error) {
        Actor.log.error(`[${company}] Error extracting from company register: ${error.message}`);
    }

    return contacts;
}

module.exports = {
    extractFromCompanyWebsite,
    extractFromLinkedIn,
    extractFromXing,
    extractFromCompanyRegister
};
