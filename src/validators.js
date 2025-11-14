/**
 * Data validation functions for contact information
 */

/**
 * Validate email address according to RFC 5322 (simplified)
 * @param {string} email - Email address to validate
 * @returns {boolean} - True if valid
 */
function isValidEmail(email) {
    if (!email || typeof email !== 'string') {
        return false;
    }

    // Check for generic/invalid email addresses
    const genericPrefixes = ['info', 'contact', 'office', 'hello', 'mail', 'support', 'admin', 'noreply'];
    const emailPrefix = email.split('@')[0].toLowerCase();

    if (genericPrefixes.some(prefix => emailPrefix === prefix || emailPrefix.startsWith(prefix + '.'))) {
        return false;
    }

    // RFC 5322 simplified regex
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

    return emailRegex.test(email);
}

/**
 * Validate phone number (international format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid
 */
function isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') {
        return false;
    }

    // Remove common separators for validation
    const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');

    // Check for placeholder numbers
    const placeholders = ['1234567', '0000000', '9999999', '1111111'];
    if (placeholders.some(p => cleaned.includes(p))) {
        return false;
    }

    // International format: +XX or 00XX followed by at least 8 digits
    const phoneRegex = /^(\+|00)[1-9]\d{1,3}\d{7,14}$/;

    // Also accept local German format: 0XXX... (at least 10 digits)
    const germanLocalRegex = /^0\d{9,14}$/;

    return phoneRegex.test(cleaned) || germanLocalRegex.test(cleaned);
}

/**
 * Validate name (first or last name)
 * @param {string} name - Name to validate
 * @returns {boolean} - True if valid
 */
function isValidName(name) {
    if (!name || typeof name !== 'string') {
        return false;
    }

    const trimmed = name.trim();

    // Check minimum length
    if (trimmed.length < 2) {
        return false;
    }

    // Check for placeholder names
    const placeholders = ['xxx', 'n/a', 'tbd', 'unknown', 'test', 'dummy', 'placeholder', 'name'];
    if (placeholders.some(p => trimmed.toLowerCase() === p)) {
        return false;
    }

    // Should contain only letters, spaces, hyphens, and common special characters
    const nameRegex = /^[a-zA-ZäöüÄÖÜßáéíóúÁÉÍÓÚàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛ\s\-'\.]+$/;

    return nameRegex.test(trimmed);
}

/**
 * Validate salutation
 * @param {string} salutation - Salutation to validate
 * @returns {boolean} - True if valid
 */
function isValidSalutation(salutation) {
    if (!salutation || typeof salutation !== 'string') {
        return false;
    }

    const validSalutations = ['Herr', 'Frau', 'Mr', 'Mrs', 'Ms', 'Dr', 'Prof'];
    return validSalutations.some(s => salutation.toLowerCase().includes(s.toLowerCase()));
}

/**
 * Validate job title
 * @param {string} jobTitle - Job title to validate
 * @returns {boolean} - True if valid
 */
function isValidJobTitle(jobTitle) {
    if (!jobTitle || typeof jobTitle !== 'string') {
        return false;
    }

    const trimmed = jobTitle.trim();

    // Check minimum length
    if (trimmed.length < 3) {
        return false;
    }

    // Check for placeholders
    const placeholders = ['tbd', 'n/a', 'unknown', 'test'];
    if (placeholders.some(p => trimmed.toLowerCase() === p)) {
        return false;
    }

    return true;
}

/**
 * Validate LinkedIn URL
 * @param {string} url - LinkedIn URL to validate
 * @returns {boolean} - True if valid
 */
function isValidLinkedInUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }

    const linkedInRegex = /^https?:\/\/(www\.)?linkedin\.com\/(in|pub)\/[a-zA-Z0-9\-]+\/?$/;
    return linkedInRegex.test(url);
}

/**
 * Validate complete contact object
 * @param {Object} contact - Contact object to validate
 * @returns {Object} - Validation result with isValid flag and errors array
 */
function validateContact(contact) {
    const errors = [];

    // Required fields
    if (!contact.company || contact.company.trim().length === 0) {
        errors.push('Company name is required');
    }

    if (!isValidName(contact.firstName)) {
        errors.push('Invalid or missing first name');
    }

    if (!isValidName(contact.lastName)) {
        errors.push('Invalid or missing last name');
    }

    if (!isValidEmail(contact.email)) {
        errors.push('Invalid or generic email address');
    }

    if (!isValidJobTitle(contact.jobTitle)) {
        errors.push('Invalid or missing job title');
    }

    // Optional but must be valid if present
    if (contact.phone && !isValidPhone(contact.phone)) {
        errors.push('Invalid phone number format');
    }

    if (contact.salutation && !isValidSalutation(contact.salutation)) {
        errors.push('Invalid salutation');
    }

    if (contact.linkedInUrl && !isValidLinkedInUrl(contact.linkedInUrl)) {
        errors.push('Invalid LinkedIn URL');
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Sanitize and normalize contact data
 * @param {Object} contact - Contact object to sanitize
 * @returns {Object} - Sanitized contact object
 */
function sanitizeContact(contact) {
    return {
        company: contact.company?.trim() || '',
        location: contact.location?.trim() || '',
        salutation: contact.salutation?.trim() || '',
        firstName: contact.firstName?.trim() || '',
        lastName: contact.lastName?.trim() || '',
        email: contact.email?.trim().toLowerCase() || '',
        phone: contact.phone?.trim() || '',
        jobTitle: contact.jobTitle?.trim() || '',
        linkedInUrl: contact.linkedInUrl?.trim() || '',
        source: contact.source || 'unknown',
        scrapedAt: contact.scrapedAt || new Date().toISOString()
    };
}

module.exports = {
    isValidEmail,
    isValidPhone,
    isValidName,
    isValidSalutation,
    isValidJobTitle,
    isValidLinkedInUrl,
    validateContact,
    sanitizeContact
};
