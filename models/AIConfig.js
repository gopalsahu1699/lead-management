const mongoose = require('mongoose');

const AIConfigSchema = new mongoose.Schema({
    type: { type: String, default: 'import_cleaner' }, // To allow for other AI features later
    systemInstructions: { type: String, default: '' },
    customRules: { type: String, default: '' },
    examples: { type: String, default: '' }, // Stored as a string for simplicity in UI, but could be structured
    updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AIConfig', AIConfigSchema);
