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
