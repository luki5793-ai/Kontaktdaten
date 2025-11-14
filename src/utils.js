/**
 * Utility functions for the contact extraction actor
 */

const { Actor } = require('apify');

/**
 * Calculate role priority score
 * @param {string} jobTitle - Job title to score
 * @param {Array<string>} targetRoles - List of target roles
 * @returns {number} - Priority score (higher is better)
 */
function calculateRolePriority(jobTitle, targetRoles) {
    if (!jobTitle || !targetRoles) return 0;

    const normalizedTitle = jobTitle.toLowerCase();

    // Find exact or partial match with target roles
    for (let i = 0; i < targetRoles.length; i++) {
        const targetRole = targetRoles[i].toLowerCase();

        // Exact match gets highest priority
        if (normalizedTitle === targetRole) {
            return 1000 - i;
        }

        // Partial match gets lower priority
        if (normalizedTitle.includes(targetRole) || targetRole.includes(normalizedTitle)) {
            return 500 - i;
        }
    }

    // Bonus for leadership keywords
    const leadershipKeywords = ['head', 'director', 'chief', 'vp', 'vice president', 'c-level', 'leiter', 'lead'];
    const hasLeadership = leadershipKeywords.some(kw => normalizedTitle.includes(kw));

    if (hasLeadership) {
        return 100;
    }

    return 0;
}

/**
 * Deduplicate contacts by email
 * @param {Array<Object>} contacts - Array of contact objects
 * @returns {Array<Object>} - Deduplicated contacts
 */
function deduplicateContacts(contacts) {
    const seen = new Map();

    for (const contact of contacts) {
        const email = contact.email?.toLowerCase();

        if (!email) continue;

        // Keep the contact with higher priority or first occurrence
        if (!seen.has(email)) {
            seen.set(email, contact);
        } else {
            const existing = seen.get(email);
            const existingPriority = existing._priority || 0;
            const newPriority = contact._priority || 0;

            if (newPriority > existingPriority) {
                seen.set(email, contact);
            }
        }
    }

    return Array.from(seen.values());
}

/**
 * Sort contacts by priority
 * @param {Array<Object>} contacts - Array of contact objects
 * @param {Array<string>} targetRoles - List of target roles
 * @returns {Array<Object>} - Sorted contacts
 */
function sortContactsByPriority(contacts, targetRoles) {
    return contacts.map(contact => {
        const priority = calculateRolePriority(contact.jobTitle, targetRoles);
        return { ...contact, _priority: priority };
    }).sort((a, b) => b._priority - a._priority);
}

/**
 * Limit contacts per company
 * @param {Array<Object>} contacts - Array of contact objects
 * @param {number} maxPerCompany - Maximum contacts per company
 * @returns {Array<Object>} - Limited contacts
 */
function limitContactsPerCompany(contacts, maxPerCompany = 2) {
    const companyGroups = {};

    for (const contact of contacts) {
        const company = contact.company;

        if (!companyGroups[company]) {
            companyGroups[company] = [];
        }

        companyGroups[company].push(contact);
    }

    const result = [];

    for (const company in companyGroups) {
        const companyContacts = companyGroups[company];
        result.push(...companyContacts.slice(0, maxPerCompany));
    }

    return result;
}

/**
 * Extract salutation from name or text
 * @param {string} text - Text to extract salutation from
 * @returns {string} - Extracted salutation or empty string
 */
function extractSalutation(text) {
    if (!text) return '';

    const normalized = text.toLowerCase();

    if (normalized.includes('herr') && !normalized.includes('frau')) {
        return 'Herr';
    }

    if (normalized.includes('frau')) {
        return 'Frau';
    }

    if (normalized.includes('mr.') || normalized.includes('mr ')) {
        return 'Herr';
    }

    if (normalized.includes('mrs.') || normalized.includes('mrs ') || normalized.includes('ms.') || normalized.includes('ms ')) {
        return 'Frau';
    }

    // Guess based on first name (German names)
    const maleNames = ['thomas', 'michael', 'andreas', 'peter', 'christian', 'stefan', 'markus', 'daniel', 'frank', 'alexander'];
    const femaleNames = ['sabine', 'petra', 'andrea', 'martina', 'claudia', 'nicole', 'sandra', 'julia', 'katrin', 'anna'];

    const lowerText = text.toLowerCase();

    for (const name of maleNames) {
        if (lowerText.includes(name)) {
            return 'Herr';
        }
    }

    for (const name of femaleNames) {
        if (lowerText.includes(name)) {
            return 'Frau';
        }
    }

    return '';
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} initialDelay - Initial delay in milliseconds
 * @returns {Promise<any>} - Result of function
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const delay = initialDelay * Math.pow(2, i);

            Actor.log.warning(`Retry ${i + 1}/${maxRetries} after ${delay}ms: ${error.message}`);

            if (i < maxRetries - 1) {
                await sleep(delay);
            }
        }
    }

    throw lastError;
}

/**
 * Extract email from text
 * @param {string} text - Text to extract email from
 * @returns {string|null} - Extracted email or null
 */
function extractEmailFromText(text) {
    if (!text) return null;

    const emailRegex = /([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)/g;
    const matches = text.match(emailRegex);

    return matches ? matches[0] : null;
}

/**
 * Extract phone from text
 * @param {string} text - Text to extract phone from
 * @returns {string|null} - Extracted phone or null
 */
function extractPhoneFromText(text) {
    if (!text) return null;

    // International format
    const intlRegex = /(\+|00)[1-9]\d{1,3}[\s\-\.]?\d{1,4}[\s\-\.]?\d{1,4}[\s\-\.]?\d{1,9}/g;
    let matches = text.match(intlRegex);

    if (matches) {
        return matches[0].replace(/[\s\-\.]/g, '');
    }

    // Local German format
    const germanRegex = /0\d{2,5}[\s\-\.]?\d{3,9}/g;
    matches = text.match(germanRegex);

    if (matches) {
        return matches[0].replace(/[\s\-\.]/g, '');
    }

    return null;
}

/**
 * Normalize company name
 * @param {string} companyName - Company name to normalize
 * @returns {string} - Normalized company name
 */
function normalizeCompanyName(companyName) {
    if (!companyName) return '';

    let normalized = companyName.trim();

    // Remove legal suffixes
    const suffixes = ['GmbH', 'AG', 'SE', 'KG', 'OHG', 'GbR', 'UG', 'e.V.', 'Inc.', 'LLC', 'Ltd.', 'Corp.'];

    for (const suffix of suffixes) {
        const regex = new RegExp(`\\s+${suffix}\\s*$`, 'i');
        normalized = normalized.replace(regex, '');
    }

    return normalized.trim();
}

/**
 * Create Google search query for company contacts
 * @param {string} company - Company name
 * @param {Array<string>} roles - Target roles
 * @param {string} country - Country/region
 * @returns {string} - Search query
 */
function createSearchQuery(company, roles, country = '') {
    const roleQuery = roles.slice(0, 3).join(' OR ');
    const countryPart = country ? ` ${country}` : '';

    return `"${company}" (${roleQuery}) email${countryPart}`;
}

module.exports = {
    calculateRolePriority,
    deduplicateContacts,
    sortContactsByPriority,
    limitContactsPerCompany,
    extractSalutation,
    sleep,
    retryWithBackoff,
    extractEmailFromText,
    extractPhoneFromText,
    normalizeCompanyName,
    createSearchQuery
};
