# IT Leaders & Hiring Managers Contact Extractor

Apify Actor for extracting contact information of IT leaders and hiring managers from companies using multi-source web scraping.

## Features

- **Multi-Source Extraction**: Scrapes contact data from company websites, LinkedIn, Xing, and company registers
- **Intelligent Prioritization**: Prioritizes contacts based on job titles (CTO > CIO > IT Manager > HR Director)
- **Data Validation**: RFC 5322 compliant email validation, international phone format validation
- **Deduplication**: Automatic deduplication by email address
- **Rate Limiting**: Built-in delays to avoid overwhelming target websites
- **Retry Logic**: Automatic retry with exponential backoff for failed requests
- **Proxy Support**: Full Apify proxy integration for reliable scraping

## Use Cases

- **Recruitment**: Find contact information for IT leaders and hiring managers for job opportunities
- **Sales**: Build targeted contact lists for B2B sales campaigns
- **Market Research**: Gather information about company leadership structures
- **Network Building**: Identify key decision-makers in specific companies

## Limitations

### Legal & Ethical

- **Data Privacy**: Always comply with GDPR and local data protection laws
- **Terms of Service**: Some sources (LinkedIn, Xing) prohibit automated scraping
- **Rate Limits**: Excessive scraping may result in IP blocks
- **Personal Data**: This actor collects personal data - ensure you have legal basis for processing

### Technical

- **Login Required**: LinkedIn and Xing require authentication for full access (limited to public profiles only)
- **Email Accuracy**: Constructed emails (from LinkedIn/Xing) are estimates and may not be accurate
- **Success Rate**: Typical success rate is 40-60% depending on company size and online presence
- **Generic Emails**: Filters out generic addresses (info@, contact@, etc.)

## Input Parameters

```json
{
  "companies": ["SAP", "Siemens", "Bosch"],
  "country": "Germany",
  "maxContactsPerCompany": 2,
  "targetRoles": [
    "CTO",
    "CIO",
    "Head of IT",
    "IT-Leiter",
    "VP Engineering",
    "Engineering Manager",
    "HR Director",
    "Recruiting Manager",
    "Head of Talent Acquisition"
  ],
  "enableLinkedIn": true,
  "enableXing": true,
  "enableCompanyWebsite": true,
  "maxRetries": 3,
  "proxyConfiguration": {
    "useApifyProxy": true
  }
}
```

### Parameter Descriptions

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `companies` | Array | Yes | - | List of company names to extract contacts from |
| `country` | String | No | "Germany" | Country/region for more precise search |
| `maxContactsPerCompany` | Integer | No | 2 | Maximum number of contacts per company (1-10) |
| `targetRoles` | Array | No | See above | Prioritized list of job titles to search for |
| `enableLinkedIn` | Boolean | No | true | Enable LinkedIn as data source |
| `enableXing` | Boolean | No | true | Enable Xing as data source (DACH region) |
| `enableCompanyWebsite` | Boolean | No | true | Enable company website scraping |
| `maxRetries` | Integer | No | 3 | Maximum retries for failed requests (0-10) |
| `proxyConfiguration` | Object | No | Apify proxy | Proxy configuration object |

## Output Format

The actor saves contacts to the Apify dataset in the following format:

```json
{
  "company": "SAP SE",
  "location": "Walldorf",
  "salutation": "Herr",
  "firstName": "Thomas",
  "lastName": "Müller",
  "email": "thomas.mueller@sap.com",
  "phone": "+49 6227 7-47474",
  "jobTitle": "CTO",
  "linkedInUrl": "https://linkedin.com/in/thomas-mueller",
  "source": "company_website",
  "scrapedAt": "2025-11-14T10:30:00.000Z"
}
```

### Output Fields

| Field | Type | Description |
|-------|------|-------------|
| `company` | String | Company name (normalized) |
| `location` | String | Location/city |
| `salutation` | String | Salutation (Herr/Frau) |
| `firstName` | String | First name |
| `lastName` | String | Last name |
| `email` | String | Email address (validated) |
| `phone` | String | Phone number (international format) |
| `jobTitle` | String | Job title/position |
| `linkedInUrl` | String | LinkedIn profile URL (if available) |
| `source` | String | Data source (company_website, linkedin, xing, impressum) |
| `scrapedAt` | String | ISO timestamp of extraction |

## Example Runs

### Example 1: Extract IT Leaders from Top 3 German Companies

**Input:**
```json
{
  "companies": ["SAP", "Siemens", "Volkswagen"],
  "country": "Germany",
  "maxContactsPerCompany": 2,
  "targetRoles": ["CTO", "CIO", "Head of IT"]
}
```

**Expected Output:** 4-6 contacts (2 per company if found)

**Runtime:** ~5-10 minutes

**Compute Units:** ~0.1-0.2 CUs

### Example 2: Extract Hiring Managers from Tech Startups

**Input:**
```json
{
  "companies": ["N26", "Delivery Hero", "Celonis"],
  "country": "Germany",
  "maxContactsPerCompany": 2,
  "targetRoles": ["HR Director", "Recruiting Manager", "Head of Talent Acquisition"]
}
```

**Expected Output:** 3-6 contacts

**Runtime:** ~5-8 minutes

**Compute Units:** ~0.1-0.15 CUs

### Example 3: Large Scale Extraction

**Input:**
```json
{
  "companies": ["Company1", "Company2", ..., "Company50"],
  "maxContactsPerCompany": 2
}
```

**Expected Output:** 40-100 contacts (depending on success rate)

**Runtime:** ~40-60 minutes

**Compute Units:** ~1.5-2.5 CUs

## Cost Estimation

### Compute Units (CUs)

| Companies | Avg. Runtime | Est. CUs | Cost (at $0.25/CU) |
|-----------|--------------|----------|---------------------|
| 1-5 | 3-10 min | 0.05-0.15 | $0.01-$0.04 |
| 5-10 | 10-20 min | 0.15-0.35 | $0.04-$0.09 |
| 10-25 | 20-40 min | 0.35-0.80 | $0.09-$0.20 |
| 25-50 | 40-80 min | 0.80-1.80 | $0.20-$0.45 |
| 50-100 | 80-150 min | 1.80-3.50 | $0.45-$0.88 |

**Note:** Costs vary based on:
- Number of sources enabled (website, LinkedIn, Xing)
- Website complexity and response time
- Proxy usage
- Number of retries needed

### Optimization Tips

1. **Disable unused sources**: If you don't need LinkedIn/Xing, disable them to save time
2. **Reduce maxContactsPerCompany**: Use 1 instead of 2 if you only need top executives
3. **Target specific roles**: Fewer target roles = faster execution
4. **Batch processing**: Process companies in batches to monitor costs

## Data Quality

### Validation Rules

- **Email**: Must be RFC 5322 compliant, no generic addresses (info@, contact@)
- **Phone**: International format (+XX...) or German local format (0XXX...)
- **Names**: Minimum 2 characters, no placeholders (xxx, n/a, test)
- **Job Title**: Minimum 3 characters, no placeholders

### Expected Success Rates

| Source | Availability | Email Accuracy | Phone Accuracy |
|--------|--------------|----------------|----------------|
| Company Website | 60-80% | 80-95% | 60-80% |
| LinkedIn | 40-60% | 20-40%* | 5-10% |
| Xing | 30-50% | 20-30%* | 5-10% |
| Impressum | 70-90% | 60-80% | 80-95% |

*Emails from LinkedIn/Xing are often constructed/estimated

## Troubleshooting

### No contacts found

- Check if company name is spelled correctly
- Try different company name variations (e.g., "SAP SE" vs "SAP")
- Enable all sources for better coverage
- Check if company has online presence

### Invalid contacts

- Check validation errors in logs
- Verify target roles match actual job titles at the company
- Some companies use non-standard email formats

### Actor timeout

- Reduce number of companies per run
- Disable slow sources (LinkedIn, Xing)
- Increase actor timeout in settings

### Rate limiting / IP blocks

- Reduce batch size
- Increase delays between requests
- Use residential proxies instead of datacenter proxies

## Development

### Local Testing

```bash
# Install dependencies
npm install

# Run locally
npm start
```

### File Structure

```
/
├── .actor/
│   ├── actor.json          # Actor metadata
│   └── INPUT_SCHEMA.json   # Input schema definition
├── src/
│   ├── main.js             # Main entry point
│   ├── extractors.js       # Source-specific extraction logic
│   ├── validators.js       # Data validation functions
│   └── utils.js            # Utility functions
├── package.json            # Node.js dependencies
└── README.md              # This file
```

### Key Dependencies

- **apify**: Apify SDK for actor development
- **crawlee**: Web scraping and crawling framework
- **playwright**: Browser automation

## Compliance & Ethics

### Legal Compliance

This actor is designed for legitimate business purposes only. Users must:

- Comply with GDPR, CCPA, and other data protection regulations
- Have legal basis for processing personal data (e.g., legitimate interest)
- Provide privacy notices to data subjects
- Honor data subject rights (access, deletion, etc.)
- Not use data for spam or unsolicited marketing without consent

### Ethical Use

- Respect website terms of service
- Implement reasonable rate limiting
- Do not use for malicious purposes
- Be transparent about data collection
- Provide opt-out mechanisms

### Disclaimer

Users are solely responsible for ensuring their use of this actor complies with all applicable laws and regulations. The actor developer assumes no liability for misuse.

## Support

For issues, questions, or feature requests:

1. Check the [Apify Documentation](https://docs.apify.com)
2. Review the [Crawlee Documentation](https://crawlee.dev)
3. Open an issue on GitHub
4. Contact Apify support

## License

Apache-2.0

## Changelog

### Version 1.0.0 (2025-11-14)

- Initial release
- Multi-source extraction (websites, LinkedIn, Xing, Impressum)
- Data validation and deduplication
- Priority-based sorting
- Rate limiting and retry logic
- Comprehensive error handling
