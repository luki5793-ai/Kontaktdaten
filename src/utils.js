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
