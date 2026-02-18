const mongoose = require('mongoose');

const NoteSchema = new mongoose.Schema({
    content: { type: String, required: true },
    created_at: { type: Date, default: Date.now }
});

const LeadSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: String,
    email: String,
    address: String,
    city: String,
    state: String,
    occupation: String,
    source: String,
    status: { type: String, default: 'New' },
    date: String,
    notes: [NoteSchema],
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Lead', LeadSchema);
