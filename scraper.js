const puppeteer = require('puppeteer');

async function scrapeLeads(query) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // Search Google Maps/Search results
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}+near+me`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2' });

    // Wait for business listings to appear
    await page.waitForSelector('div[data-async-context]', { timeout: 10000 }).catch(() => {});

    const leads = await page.evaluate(() => {
        const results = [];
        const items = document.querySelectorAll('div.Vkp9Pc, div.u3M99.L7SAtf');

        items.forEach(item => {
            const name = item.querySelector('.OSrXXb, .EllmAc')?.innerText?.trim();
            const location = item.querySelector('.rllt__details a')?.href;

            // Gather all span texts inside the details block
            const spanElements = Array.from(item.querySelectorAll('.rllt__details span'));
            let phone = '';
            let address = '';
            spanElements.forEach(span => {
                const text = span.innerText?.trim();
                if (!text) return;
                const digits = text.replace(/\D/g, '');
                // Identify phone: at least 10 digits and not already captured
                if (digits.length >= 10 && !phone) {
                    phone = text;
                } else if (!address) {
                    // First non‑phone span is treated as address
                    address = text;
                }
            });
            // If address still empty, attempt to derive from location URL (Google Maps place URL)
            if (!address && location) {
                try {
                    const decoded = decodeURIComponent(location);
                    const placeMatch = decoded.match(/\/place\/([^/]+)/i);
                    if (placeMatch) {
                        const rawAddress = placeMatch[1].replace(/\+/g, ' ').split('?')[0];
                        address = rawAddress;
                    }
                } catch (e) { /* ignore */ }
            }

            // Parse city and state from address
            let city = '';
            let state = '';
            if (address) {
                const cleanAddr = address.split('·')[0].trim();
                const parts = cleanAddr.split(',').map(p => p.trim());
                if (parts.length >= 2) {
                    state = parts[parts.length - 1].replace(/\s*\d{5,6}/g, '').trim();
                    city = parts[parts.length - 2].trim();
                } else if (parts.length === 1) {
                    city = parts[0].trim();
                }
            }

            const source = "Web Search";

            if (name) {
                results.push({
                    name,
                    phone: phone || '',
                    address: address || '',
                    city: city || '',
                    state: state || '',
                    location: location || '',
                    source,
                    status: 'New',
                    date: new Date().toISOString().split('T')[0]
                });
            }
        });
        return results;
    });

    await browser.close();
    return leads;
}

module.exports = { scrapeLeads };
