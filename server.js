const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { scrapeLeads } = require('./scraper');
const { sendAutomatedEmail } = require('./email-service');
const OpenAI = require('openai');
require('dotenv').config();

// SQLite Database
const db = require('./db');

// AI Setup (NVIDIA NIM)
const openai = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1'
});

const app = express();
const PORT = process.env.PORT || 5000;

// Folders
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// Helper: attach notes to a lead object
const attachNotes = (lead) => {
    if (!lead) return lead;
    const notes = db.prepare('SELECT * FROM notes WHERE lead_id = ? ORDER BY created_at ASC').all(lead.id);
    return { ...lead, _id: lead.id, notes };
};

// Leads Routes
app.get('/api/leads', (req, res) => {
    try {
        const leads = db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();
        const leadsWithNotes = leads.map(l => attachNotes(l));
        res.json(leadsWithNotes);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/leads', (req, res) => {
    try {
        const { name, phone, email, address, city, state, occupation, source, status, date } = req.body;
        const result = db.prepare(
            'INSERT INTO leads (name, phone, email, address, city, state, occupation, source, status, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(name, phone || null, email || null, address || null, city || null, state || null, occupation || null, source || null, status || 'New', date || null);
        const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);
        res.json(attachNotes(lead));
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

app.put('/api/leads/:id', (req, res) => {
    try {
        const id = req.params.id;
        const oldLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
        
        const { name, phone, email, address, city, state, occupation, source, status, date } = req.body;
        db.prepare(
            'UPDATE leads SET name=?, phone=?, email=?, address=?, city=?, state=?, occupation=?, source=?, status=?, date=? WHERE id=?'
        ).run(name, phone || null, email || null, address || null, city || null, state || null, occupation || null, source || null, status || 'New', date || null, id);

        // Check for status change and send automated email
        if (oldLead && oldLead.status !== status) {
            const template = db.prepare('SELECT * FROM email_templates WHERE trigger_status = ?').get(status);
            if (template && email) {
                sendAutomatedEmail(email, template, req.body);
                db.prepare('INSERT INTO notes (lead_id, content) VALUES (?, ?)').run(id, `Automated Email Sent: ${template.name}`);
            }
        }

        const updatedLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
        res.json(attachNotes(updatedLead));
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

app.delete('/api/leads/bulk', (req, res) => {
    try {
        const ids = req.body.ids;
        if (!ids || !Array.isArray(ids)) return res.status(400).json({ message: 'IDs required' });
        const placeholders = ids.map(() => '?').join(',');
        // Delete leads
        db.prepare(`DELETE FROM leads WHERE id IN (${placeholders})`).run(...ids);
        // Delete associated notes
        db.prepare(`DELETE FROM notes WHERE lead_id IN (${placeholders})`).run(...ids);
        res.json({ message: 'Bulk Deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.delete('/api/leads/:id', (req, res) => {
    try {
        const leadId = req.params.id;
        // Delete lead record
        db.prepare('DELETE FROM leads WHERE id = ?').run(leadId);
        // Delete associated notes
        db.prepare('DELETE FROM notes WHERE lead_id = ?').run(leadId);
        res.json({ message: 'Deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// File Upload
app.post('/api/upload', upload.single('file'), (req, res) => {
    const filePath = req.file.path;
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    fs.unlinkSync(filePath);
    res.json(data);
});

app.post('/api/leads/bulk-insert', (req, res) => {
    try {
        let leads = [];
        let skipDuplicates = true;

        if (Array.isArray(req.body)) {
            leads = req.body;
        } else if (req.body && Array.isArray(req.body.leads)) {
            leads = req.body.leads;
            if (req.body.skipDuplicates !== undefined) {
                skipDuplicates = !!req.body.skipDuplicates;
            }
        } else {
            return res.status(400).json({ message: 'Invalid data format' });
        }

        // Helper to normalize phone numbers to a standard format (country code +10 digits)
        const normalizePhone = (phone) => {
            if (!phone) return '';
            const digits = String(phone).replace(/\D/g, '');
            if (digits.length === 10) return '91' + digits;
            if (digits.length === 12 && digits.startsWith('91')) return digits;
            // If longer than 12, take last 10 digits and prepend country code
            if (digits.length > 12) return '91' + digits.slice(-10);
            return '';
        };
        const existingLeads = db.prepare("SELECT phone FROM leads WHERE phone IS NOT NULL AND phone != ''").all();
        const existingPhones = new Set(existingLeads.map(l => normalizePhone(l.phone)).filter(Boolean));

        const insert = db.prepare(
            'INSERT INTO leads (name, phone, email, address, city, state, occupation, source, status, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );

        let insertedCount = 0;
        let skippedCount = 0;
        const seenInBatch = new Set();

        const insertMany = db.transaction((items) => {
            for (const l of items) {
                if (!l.name) continue;
                
                // Normalize the phone number for deduplication checks
                const rawPhone = l.phone ? String(l.phone).trim() : '';
                const phone = normalizePhone(rawPhone);
                
                if (phone && skipDuplicates) {
                    if (seenInBatch.has(phone) || existingPhones.has(phone)) {
                        skippedCount++;
                        continue;
                    }
                    seenInBatch.add(phone);
                } else if (phone) {
                    seenInBatch.add(phone);
                }


                if (phone) {
                    // Use normalized phone for insertion
                    insert.run(
                        l.name,
                        phone,
                        l.email || null,
                        l.address || null,
                        l.city || null,
                        l.state || null,
                        l.occupation || null,
                        l.source || null,
                        l.status || 'New',
                        l.date || new Date().toISOString().split('T')[0]
                    );
                } else {
                    // Insert without phone if unavailable
                    insert.run(
                        l.name,
                        null,
                        l.email || null,
                        l.address || null,
                        l.city || null,
                        l.state || null,
                        l.occupation || null,
                        l.source || null,
                        l.status || 'New',
                        l.date || new Date().toISOString().split('T')[0]
                    );
                }
                insertedCount++;
            }
        });

        insertMany(leads);
        res.json({ message: 'Bulk Inserted', insertedCount, skippedCount });
    } catch (err) {
        console.error('Bulk Insert Error:', err);
        res.status(500).json({ message: 'Failed to import', error: err.message });
    }
});

// AI Logic
app.get('/api/ai-config', (req, res) => {
    try {
        let config = db.prepare("SELECT * FROM ai_config WHERE type = 'import_cleaner'").get();
        if (!config) {
            db.prepare("INSERT INTO ai_config (type) VALUES ('import_cleaner')").run();
            config = db.prepare("SELECT * FROM ai_config WHERE type = 'import_cleaner'").get();
        }
        res.json({
            _id: config.id,
            type: config.type,
            systemInstructions: config.system_instructions,
            customRules: config.custom_rules,
            examples: config.examples,
            updated_at: config.updated_at
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/ai-config', (req, res) => {
    try {
        const { systemInstructions, customRules, examples } = req.body;
        let config = db.prepare("SELECT * FROM ai_config WHERE type = 'import_cleaner'").get();
        if (config) {
            db.prepare("UPDATE ai_config SET system_instructions=?, custom_rules=?, examples=?, updated_at=CURRENT_TIMESTAMP WHERE type='import_cleaner'")
                .run(systemInstructions || '', customRules || '', examples || '');
        } else {
            db.prepare("INSERT INTO ai_config (type, system_instructions, custom_rules, examples) VALUES ('import_cleaner', ?, ?, ?)")
                .run(systemInstructions || '', customRules || '', examples || '');
        }
        config = db.prepare("SELECT * FROM ai_config WHERE type = 'import_cleaner'").get();
        res.json({
            _id: config.id,
            type: config.type,
            systemInstructions: config.system_instructions,
            customRules: config.custom_rules,
            examples: config.examples,
            updated_at: config.updated_at
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

function localCleanLeads(items, mapping) {
    return items.map(item => {
        let rawStr = '';
        if (typeof item === 'string') {
            rawStr = item;
        } else if (item && typeof item === 'object') {
            rawStr = Object.values(item).join(' ');
        }

        let name = '';
        let phone = '';
        let email = '';
        let address = '';
        let occupation = '';
        let city = '';
        let state = '';
        let location = '';
        let isJunk = false;

        if (mapping && typeof item === 'object') {
            if (mapping.name) name = String(item[mapping.name] || '').trim();
            if (mapping.phone) phone = String(item[mapping.phone] || '').trim();
            if (mapping.email) email = String(item[mapping.email] || '').trim();
            if (mapping.address) address = String(item[mapping.address] || '').trim();
            if (mapping.occupation) occupation = String(item[mapping.occupation] || '').trim();
            if (mapping.city) city = String(item[mapping.city] || '').trim();
            if (mapping.state) state = String(item[mapping.state] || '').trim();
            if (mapping.location) location = String(item[mapping.location] || '').trim();
        }

        if (!name && rawStr) {
            let clean = rawStr
                .replace(/https?:\/\/\S+/gi, '')
                .replace(/\b\d\.\d\b/g, '')
                .replace(/\(\d+\)/g, '')
                .replace(/\b\d+\+\s*years?\b/gi, '')
                .replace(/closes?\s+\d+:\d+\s*(?:am|pm)?/gi, '')
                .replace(/[·|,-]+/g, ' ')
                .trim();
            const words = clean.split(/\s+/).slice(0, 4).join(' ');
            name = words;
        }

        const combinedPhoneText = phone || rawStr || '';
        if (combinedPhoneText) {
            const digits = combinedPhoneText.replace(/\D/g, '');
            if (digits.length >= 10) {
                if (digits.length === 12 && digits.startsWith('91')) {
                    phone = digits;
                } else {
                    const last10 = digits.slice(-10);
                    phone = '91' + last10;
                }
            }
        }

        const emailMatch = (email || rawStr || '').match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
        if (emailMatch) {
            email = emailMatch[0];
        }

        const urlMatch = (location || rawStr || '').match(/https?:\/\/(?:www\.)?(?:google\..*?\/maps|maps\..*?)\S+/i);
        if (urlMatch) {
            location = urlMatch[0];
            // Attempt to extract address from Google Maps place URL if address is empty
            if (!address) {
                try {
                    const decoded = decodeURIComponent(location);
                    const placeMatch = decoded.match(/\/place\/([^/]+)/i);
                    if (placeMatch) {
                        // Replace '+' with space and remove any trailing query parameters
                        const rawAddress = placeMatch[1].replace(/\+/g, ' ').split('?')[0];
                        address = rawAddress;
                    }
                } catch (e) { /* ignore decoding errors */ }
            }
        }

        const toProperCase = (str) => {
            if (!str) return '';
            return str.replace(/\b\w+/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
        };

        name = toProperCase(name.trim());
        occupation = toProperCase(occupation.trim());
        city = toProperCase(city.trim());
        state = toProperCase(state.trim());
        address = toProperCase(address.trim());

        const junkKeywords = ['no review', 'unit no', 'opposite', 'piru-2', 'test entry', 'closes', 'open 24 hours'];
        const nameLower = name.toLowerCase();
        if (!name || name.length < 2) {
            isJunk = true;
        } else if (junkKeywords.some(keyword => nameLower.includes(keyword))) {
            isJunk = true;
        }

        return {
            name: name || 'Unnamed Lead',
            phone: phone || '',
            email: email || '',
            address: address || '',
            occupation: occupation || 'Business/Lead',
            city: city || '',
            state: state || '',
            source: 'Local Fallback Cleaner',
            location: location || '',
            isJunk
        };
    });
}

app.post('/api/leads/ai-clean', async (req, res) => {
    const { leads, mapping } = req.body;
    if (!leads || !Array.isArray(leads)) return res.status(400).json({ message: 'Leads data required' });

    try {
        const config = db.prepare("SELECT * FROM ai_config WHERE type = 'import_cleaner'").get();

        const prompt = `
            You are a Professional Data Extraction AI. 
            Your task is to extract structured data from the provided JSON array of lead data.
            The data may contain raw, messy, or unstructured entries.

            IDENTIFY AND EXTRACT these fields for each entry:
            1. "name": The business or person's name. 
               - **NOISE REMOVAL**: Strip ratings (e.g., "4.5"), counts (e.g., "(123)"), and business years.
               - Example: "Raipur Bu - Real esta 4.5" -> "Raipur Bu".
            2. "phone": The most valid Indian mobile number.
               - **PURITY**: Extract ONLY 10 digits. Strip '0', '+91', and spaces. Output as 91 + 10 digits.
               - **STRIP**: Remove all address parts or Plus Codes from this field.
            3. "address": The full street address. Include Plus Codes here.
            4. "occupation": The profession or business type.
            5. "city": Specific city name (TEXT ONLY).
            6. "state": State name (TEXT ONLY).

            GOOGLE MAPS LINK RULES:
            - Decode '/maps/dir/' or '/maps/place/' URLs for Business Names or Addresses.
            - URLs belong ONLY in the "location" field.
            - **CRITICAL ADDRESS RULE**: If you see a full street address or location details (like "7J2H+HR8 Jai Durga", building names, road names, areas, or land marks) in any fields, extract them into the "address" field. Look for it in raw input fields, and extract it completely. Ensure that the "address" field is NOT left empty when address details are present in the input.

            ${mapping ? `CRITICAL REFERENCE: The user has manually mapped columns to the following fields:
            ${JSON.stringify(mapping, null, 2)}
            Use these as your primary extraction source.` : ''}

            JUNK FILTERING (Mark with "isJunk: true"):
            - Entries with NO valid phone number AND no business name.
            - Entries that are just business hours or closing times (e.g., "Closes 8:00 PM").
            - Entries that look like generic placeholders (e.g., "No review", "Unit no", "Opposite", "Piru-2").
            - Entries where the 'name' is just a profession without a specific business name.
            - Duplicate entries in the same batch.

            CLEANING & NORMALIZATION RULES:
            - **COLUMN NOISE**: Values like "7J2H+HR8 Jai Durga..." contain 'PlusCode + Name'. Separate them.
            - Use dots (·), pipes (|), and dashes (-) as clues to separate fields.
            - Convert all text to Proper Case format.
            - If a field is missing, try to infer it. If impossible, return "".

            ${config?.system_instructions || ''}
            ${config?.custom_rules ? `ADDITIONAL USER RULES:\n${config.custom_rules}` : ''}
            ${config?.examples ? `EXAMPLES (Messy -> Clean):\n${config.examples}` : ''}

            RULES:
            - Do not hallucinate. Do not guess numbers.
            - Return ONLY the extracted and cleaned JSON array with these keys: name, phone, email, address, occupation, city, state, source, location, isJunk.
            
            Data to process: ${JSON.stringify(leads)}
        `;

        const completion = await openai.chat.completions.create({
            model: "meta/llama-3.1-70b-instruct",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            top_p: 1,
            max_tokens: 4096,
        });

        const text = completion.choices[0]?.message?.content || "";

        const jsonMatch = text.match(/\[.*\]/s);
        if (!jsonMatch) throw new Error('AI failed to return valid JSON');

        const cleanedData = JSON.parse(jsonMatch[0]);
        res.json(cleanedData);
    } catch (err) {
        console.warn('AI API failed or unauthorized, executing high-fidelity local clean fallback:', err.message);
        try {
            const fallbackCleaned = localCleanLeads(leads, mapping);
            res.json(fallbackCleaned);
        } catch (fallbackErr) {
            console.error('Local clean fallback failed:', fallbackErr);
            res.status(500).json({ message: 'AI processing failed', error: err.message });
        }
    }
});

// Scraper
app.post('/api/scrape', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ message: 'Query is required' });
    try {
        const results = await scrapeLeads(query);
        res.json(results);
    } catch (err) {
        res.status(500).json({ message: 'Scraping failed', error: err.message });
    }
});

// Stats
app.get('/api/stats', (req, res) => {
    try {
        const total = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
        const statusCounts = db.prepare('SELECT status, COUNT(*) as count FROM leads GROUP BY status').all();
        const sourceCounts = db.prepare('SELECT source, COUNT(*) as count FROM leads GROUP BY source').all();

        res.json({
            total,
            statusCounts,
            sourceCounts
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Notes
app.get('/api/leads/:id/details', (req, res) => {
    try {
        const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
        if (!lead) return res.status(404).json({ message: 'Lead not found' });
        const notes = db.prepare('SELECT * FROM notes WHERE lead_id = ? ORDER BY created_at ASC').all(req.params.id);
        res.json({ lead: { ...lead, _id: lead.id, notes }, notes });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/leads/:id/notes', (req, res) => {
    try {
        db.prepare('INSERT INTO notes (lead_id, content) VALUES (?, ?)').run(req.params.id, req.body.content);
        res.json({ message: 'Note added' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Email Templates
app.get('/api/templates', (req, res) => {
    const templates = db.prepare('SELECT * FROM email_templates').all();
    res.json(templates.map(t => ({ ...t, _id: t.id })));
});

app.post('/api/templates', (req, res) => {
    const { name, subject, body, trigger_status } = req.body;
    db.prepare('INSERT INTO email_templates (name, subject, body, trigger_status) VALUES (?, ?, ?, ?)').run(name, subject, body, trigger_status);
    res.json({ message: 'Template created' });
});

app.delete('/api/templates/:id', (req, res) => {
    db.prepare('DELETE FROM email_templates WHERE id = ?').run(req.params.id);
    res.json({ message: 'Template deleted' });
});

// Global JSON Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    res.status(err.status || 500).json({
        message: err.message || 'Internal Server Error',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
