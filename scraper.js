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
    await page.waitForSelector('div[data-async-context]', { timeout: 10000 }).catch(() => { });

    const leads = await page.evaluate(() => {
        const results = [];
        const items = document.querySelectorAll('div.Vkp9Pc, div.u3M99.L7SAtf');

        items.forEach(item => {
            const name = item.querySelector('.OSrXXb, .EllmAc')?.innerText;
            const phone = item.querySelector('.rllt__details span:nth-child(3)')?.innerText;
            const address = item.querySelector('.rllt__details span:last-child')?.innerText;
            const source = "Web Search";

            if (name) {
                results.push({
                    name,
                    phone: phone || '',
                    address: address || '',
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
