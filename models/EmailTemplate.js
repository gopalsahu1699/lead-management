const mongoose = require('mongoose');

const TemplateSchema = new mongoose.Schema({
    name: { type: String, required: true },
    subject: String,
    body: String,
    trigger_status: String,
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('EmailTemplate', TemplateSchema);
