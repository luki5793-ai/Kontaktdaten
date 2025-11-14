/**
 * Main entry point for the Contact Extraction Actor
 */

const { Actor } = require('apify');
const {
    extractFromCompanyWebsite,
    extractFromLinkedIn,
    extractFromXing,
    extractFromCompanyRegister
} = require('./extractors');
const {
    deduplicateContacts,
    sortContactsByPriority,
    limitContactsPerCompany,
    sleep
} = require('./utils');
const { validateContact } = require('./validators');

/**
 * Main function
 */
Actor.main(async () => {
    Actor.log.info('Contact Extraction Actor started.');

    // Get input
    const input = await Actor.getInput();

    if (!input) {
        throw new Error('Input is required!');
    }

    // Validate input
    const {
        companies = [],
        country = 'Germany',
        maxContactsPerCompany = 2,
        targetRoles = [
            'CTO',
            'CIO',
            'Head of IT',
            'IT-Leiter',
            'VP Engineering',
            'Engineering Manager',
            'HR Director',
            'Recruiting Manager',
            'Head of Talent Acquisition'
        ],
        enableLinkedIn = true,
        enableXing = true,
        enableCompanyWebsite = true,
        maxRetries = 3,
        proxyConfiguration
    } = input;

    if (!companies || companies.length === 0) {
        throw new Error('At least one company is required!');
    }

    Actor.log.info(`Processing ${companies.length} companies: ${companies.join(', ')}`);
    Actor.log.info(`Target country: ${country}`);
    Actor.log.info(`Max contacts per company: ${maxContactsPerCompany}`);
    Actor.log.info(`Target roles: ${targetRoles.join(', ')}`);
    Actor.log.info(`Sources enabled: Website=${enableCompanyWebsite}, LinkedIn=${enableLinkedIn}, Xing=${enableXing}`);

    // Initialize proxy configuration
    const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);

    // Initialize statistics
    const stats = {
        companiesProcessed: 0,
        contactsFound: 0,
        contactsValid: 0,
        contactsSaved: 0,
        errors: 0
    };

    // Process each company
    for (const company of companies) {
        Actor.log.info(`\n${'='.repeat(60)}`);
        Actor.log.info(`Processing company: ${company}`);
        Actor.log.info(`${'='.repeat(60)}\n`);

        try {
            const allContacts = [];

            // Extract from different sources with fallback mechanism
            const extractionTasks = [];

            // Company website (primary source)
            if (enableCompanyWebsite) {
                extractionTasks.push(
                    extractFromCompanyWebsite(company, targetRoles, proxyConfig)
                        .catch(error => {
                            Actor.log.error(`[${company}] Company website extraction failed: ${error.message}`);
                            return [];
                        })
                );
            }

            // LinkedIn (secondary source)
            if (enableLinkedIn) {
                extractionTasks.push(
                    extractFromLinkedIn(company, targetRoles, proxyConfig)
                        .catch(error => {
                            Actor.log.error(`[${company}] LinkedIn extraction failed: ${error.message}`);
                            return [];
                        })
                );
            }

            // Xing (tertiary source for DACH region)
            if (enableXing && ['Germany', 'Austria', 'Switzerland', 'Deutschland', 'Österreich', 'Schweiz'].includes(country)) {
                extractionTasks.push(
                    extractFromXing(company, targetRoles, proxyConfig)
                        .catch(error => {
                            Actor.log.error(`[${company}] Xing extraction failed: ${error.message}`);
                            return [];
                        })
                );
            }

            // Company register / Impressum (fallback)
            extractionTasks.push(
                extractFromCompanyRegister(company, targetRoles, proxyConfig)
                    .catch(error => {
                        Actor.log.error(`[${company}] Company register extraction failed: ${error.message}`);
                        return [];
                    })
            );

            // Execute all extraction tasks in parallel
            const results = await Promise.all(extractionTasks);

            // Combine results
            for (const contacts of results) {
                allContacts.push(...contacts);
            }

            Actor.log.info(`[${company}] Total contacts extracted: ${allContacts.length}`);

            stats.contactsFound += allContacts.length;

            // Sort by priority
            const sortedContacts = sortContactsByPriority(allContacts, targetRoles);

            // Deduplicate by email
            const uniqueContacts = deduplicateContacts(sortedContacts);

            Actor.log.info(`[${company}] Unique contacts after deduplication: ${uniqueContacts.length}`);

            // Limit to max contacts per company
            const limitedContacts = limitContactsPerCompany(uniqueContacts, maxContactsPerCompany);

            Actor.log.info(`[${company}] Final contacts (limited to ${maxContactsPerCompany}): ${limitedContacts.length}`);

            // Validate and save contacts
            for (const contact of limitedContacts) {
                const validation = validateContact(contact);

                if (validation.isValid) {
                    // Remove internal fields before saving
                    const { _priority, ...cleanContact } = contact;

                    await Actor.pushData(cleanContact);

                    Actor.log.info(
                        `[${company}] ✓ Saved: ${cleanContact.firstName} ${cleanContact.lastName} ` +
                        `(${cleanContact.jobTitle}) - ${cleanContact.email} - Source: ${cleanContact.source}`
                    );

                    stats.contactsValid++;
                    stats.contactsSaved++;
                } else {
                    Actor.log.warning(
                        `[${company}] ✗ Invalid contact: ${contact.firstName} ${contact.lastName} - ` +
                        `Errors: ${validation.errors.join(', ')}`
                    );
                }
            }

            stats.companiesProcessed++;

            // Rate limiting: wait between companies
            if (companies.indexOf(company) < companies.length - 1) {
                Actor.log.info('Rate limiting: waiting 5 seconds before next company...');
                await sleep(5000);
            }
        } catch (error) {
            Actor.log.error(`[${company}] Error processing company: ${error.message}`);
            Actor.log.error(error.stack);
            stats.errors++;
        }
    }

    // Log final statistics
    Actor.log.info(`\n${'='.repeat(60)}`);
    Actor.log.info('FINAL STATISTICS');
    Actor.log.info(`${'='.repeat(60)}`);
    Actor.log.info(`Companies processed: ${stats.companiesProcessed}/${companies.length}`);
    Actor.log.info(`Contacts found: ${stats.contactsFound}`);
    Actor.log.info(`Contacts valid: ${stats.contactsValid}`);
    Actor.log.info(`Contacts saved: ${stats.contactsSaved}`);
    Actor.log.info(`Errors: ${stats.errors}`);
    Actor.log.info(`${'='.repeat(60)}\n`);

    // Save statistics to key-value store
    await Actor.setValue('STATISTICS', stats);

    Actor.log.info('Contact Extraction Actor finished successfully.');
});
