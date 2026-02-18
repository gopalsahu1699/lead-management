const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { scrapeLeads } = require('./scraper');
const { sendAutomatedEmail } = require('./email-service');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Models
const User = require('./models/User');
const Lead = require('./models/Lead');
const EmailTemplate = require('./models/EmailTemplate');
const AIConfig = require('./models/AIConfig');

const app = express();
const PORT = process.env.PORT || 5000;

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/lead_management')
    .then(() => {
        console.log('Connected to MongoDB Atlas');
        seedAdmin();
    })
    .catch(err => console.error('MongoDB connection error:', err));

// Folders
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// Seed Admin
const seedAdmin = async () => {
    try {
        const adminUser = process.env.ADMIN_USERNAME || 'admin';
        const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
        const exists = await User.findOne({ username: adminUser });

        if (!exists) {
            const hash = bcrypt.hashSync(adminPass, 10);
            await User.create({
                username: adminUser,
                password_hash: hash,
                role: 'Admin'
            });
            console.log('Admin user seeded in MongoDB');
        }
    } catch (err) {
        console.error('Seeding error:', err);
    }
};

const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// Auth Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Unauthorized' });

    jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
        if (err) return res.status(403).json({ message: 'Forbidden' });
        req.user = user;
        next();
    });
};

const authorizeRole = (role) => {
    return (req, res, next) => {
        if (req.user.role !== role) {
            return res.status(403).json({ message: 'Requires Admin Privileges' });
        }
        next();
    };
};

// Auth API
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (user && bcrypt.compareSync(password, user.password_hash)) {
            const token = jwt.sign(
                { id: user._id, username: user.username, role: user.role },
                process.env.JWT_SECRET || 'secret',
                { expiresIn: '24h' }
            );
            res.json({ token, user: { username: user.username, role: user.role } });
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Leads Routes
app.get('/api/leads', authenticateToken, async (req, res) => {
    try {
        const leads = await Lead.find().sort({ created_at: -1 });
        res.json(leads);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/leads', authenticateToken, async (req, res) => {
    try {
        const lead = new Lead({ ...req.body, status: req.body.status || 'New' });
        const savedLead = await lead.save();
        res.json(savedLead);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

app.put('/api/leads/:id', authenticateToken, async (req, res) => {
    try {
        const id = req.params.id;
        const oldLead = await Lead.findById(id);
        const updatedLead = await Lead.findByIdAndUpdate(id, req.body, { new: true });

        if (oldLead && oldLead.status !== req.body.status) {
            const template = await EmailTemplate.findOne({ trigger_status: req.body.status });
            if (template && req.body.email) {
                sendAutomatedEmail(req.body.email, template, req.body);
                updatedLead.notes.push({ content: `Automated Email Sent: ${template.name}` });
                await updatedLead.save();
            }
        }
        res.json(updatedLead);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

app.delete('/api/leads/bulk', authenticateToken, async (req, res) => {
    try {
        await Lead.deleteMany({ _id: { $in: req.body.ids } });
        res.json({ message: 'Bulk Deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.delete('/api/leads/:id', authenticateToken, async (req, res) => {
    try {
        await Lead.findByIdAndDelete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// File Upload
app.post('/api/upload', authenticateToken, upload.single('file'), (req, res) => {
    const filePath = req.file.path;
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    fs.unlinkSync(filePath);
    res.json(data);
});

app.post('/api/leads/bulk-insert', authenticateToken, async (req, res) => {
    try {
        const leads = req.body;
        if (!Array.isArray(leads)) return res.status(400).json({ message: 'Invalid data format' });

        const formattedLeads = leads.filter(l => l.name).map(l => ({
            ...l,
            status: l.status || 'New',
            date: l.date || new Date().toISOString().split('T')[0]
        }));

        await Lead.insertMany(formattedLeads);
        res.json({ message: 'Bulk Inserted' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to import', error: err.message });
    }
});

// AI Logic
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/api/ai-config', authenticateToken, async (req, res) => {
    try {
        let config = await AIConfig.findOne({ type: 'import_cleaner' });
        if (!config) config = await AIConfig.create({ type: 'import_cleaner' });
        res.json(config);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/ai-config', authenticateToken, async (req, res) => {
    try {
        const config = await AIConfig.findOneAndUpdate(
            { type: 'import_cleaner' },
            { ...req.body, updated_at: Date.now() },
            { upsert: true, new: true }
        );
        res.json(config);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/leads/ai-clean', authenticateToken, async (req, res) => {
    const { leads, mapping } = req.body;
    if (!leads || !Array.isArray(leads)) return res.status(400).json({ message: 'Leads data required' });

    try {
        const config = await AIConfig.findOne({ type: 'import_cleaner' });
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
            You are a Professional Data Extraction AI. 
            Your task is to extract structured data from the provided JSON array of lead data.
            The data may contain raw, messy, or unstructured entries.

            IDENTIFY AND EXTRACT these fields for each entry:
            1. "name": The business or person's name. 
               - **NOISE REMOVAL**: Strip ratings (e.g., "4.5", "5.0") and review counts (e.g., "(123)") from the name.
               - Example: "Raipur Bu - Real esta 4.5" -> "Raipur Bu".
            2. "phone": The most valid Indian mobile number.
               - **PURITY**: Extract ONLY numbers. Strip leading 0. Format as 91 + 10 digits.
               - **IGNORE**: "3+ years", "10+ years", "years in business", "Opens 7", "Closes 8".
            3. "address": The full street address. Include Plus Codes (XXXX+YYY) and areas (e.g., "Piyush Nagar") here.
            4. "occupation": The profession or business type.
            5. "city": Specific city name (TEXT ONLY).
            6. "state": State name (TEXT ONLY).

            ${mapping ? `CRITICAL REFERENCE: The user has manually mapped columns to the following fields:
            ${JSON.stringify(mapping, null, 2)}
            Use these as your primary extraction source.` : ''}

            GOOGLE MAPS LINK RULES:
            - Decode '/maps/dir/' or '/maps/place/' URLs to recover missing Business Names or Addresses.
            - URLs belong in the "location" field, NEVER in "city" or "state".

            CLEANING & NORMALIZATION RULES:
            - **COLUMN NOISE**: Values like "7J2H+HR8 Jai Durga..." contain 'PlusCode + Name'. Move '7J2H + HR8' to address and 'Jai Durga' to name IF the name field is otherwise messy.
            - **SEPARATOR HANDLING**: Use dots (·), pipes (|), and dashes (-) as clues to separate fields, but remove them from the final cleaned values.
            - Convert all text to Proper Case format.
            - If a field is missing, try to infer it from the address text or URL.
            - Mark "junk" or "test" entries with "isJunk: true".

            RULES:
            - Do not hallucinate data. Do not guess phone numbers.
            - Only extract what is available.
            - Ensure no field contains merged data.

            ${config?.systemInstructions || ''}
            ${config?.customRules ? `ADDITIONAL USER RULES:\n${config.customRules}` : ''}
            ${config?.examples ? `EXAMPLES (Messy -> Clean):\n${config.examples}` : ''}

            Return ONLY the extracted and cleaned JSON array with these keys: name, phone, email, address, occupation, city, state, source, location, isJunk.
            
            Data to process: ${JSON.stringify(leads)}
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Extract JSON using regex in case model adds markdown formatting
        const jsonMatch = text.match(/\[.*\]/s);
        if (!jsonMatch) throw new Error('AI failed to return valid JSON');

        const cleanedData = JSON.parse(jsonMatch[0]);
        res.json(cleanedData);
    } catch (err) {
        console.error('AI Cleaning Error:', err);
        res.status(500).json({ message: 'AI processing failed', error: err.message });
    }
});

// Scraper
app.post('/api/scrape', authenticateToken, async (req, res) => {
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
app.get('/api/stats', authenticateToken, async (req, res) => {
    try {
        const total = await Lead.countDocuments();
        const leads = await Lead.find();

        const statusCounts = {};
        const sourceCounts = {};

        leads.forEach(l => {
            statusCounts[l.status] = (statusCounts[l.status] || 0) + 1;
            sourceCounts[l.source] = (sourceCounts[l.source] || 0) + 1;
        });

        res.json({
            total,
            statusCounts: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
            sourceCounts: Object.entries(sourceCounts).map(([source, count]) => ({ source, count }))
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Notes
app.get('/api/leads/:id/details', authenticateToken, async (req, res) => {
    try {
        const lead = await Lead.findById(req.params.id);
        res.json({ lead, notes: lead.notes });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/leads/:id/notes', authenticateToken, async (req, res) => {
    try {
        const lead = await Lead.findById(req.params.id);
        lead.notes.push({ content: req.body.content });
        await lead.save();
        res.json({ message: 'Note added' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Management
app.get('/api/users', authenticateToken, authorizeRole('Admin'), async (req, res) => {
    const users = await User.find({}, 'username role created_at');
    res.json(users);
});

app.post('/api/users', authenticateToken, authorizeRole('Admin'), async (req, res) => {
    const { username, password, role } = req.body;
    try {
        const hash = bcrypt.hashSync(password, 10);
        await User.create({ username, password_hash: hash, role });
        res.json({ message: 'User created' });
    } catch (err) {
        res.status(400).json({ message: 'User already exists' });
    }
});

app.delete('/api/users/:id', authenticateToken, authorizeRole('Admin'), async (req, res) => {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
});

app.get('/api/templates', authenticateToken, authorizeRole('Admin'), async (req, res) => {
    const templates = await EmailTemplate.find();
    res.json(templates);
});

app.post('/api/templates', authenticateToken, authorizeRole('Admin'), async (req, res) => {
    await EmailTemplate.create(req.body);
    res.json({ message: 'Template created' });
});

app.delete('/api/templates/:id', authenticateToken, authorizeRole('Admin'), async (req, res) => {
    await EmailTemplate.findByIdAndDelete(req.params.id);
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
