const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'leads.db'));

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize tables
db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        city TEXT,
        state TEXT,
        occupation TEXT,
        source TEXT,
        status TEXT DEFAULT 'New',
        date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        subject TEXT,
        body TEXT,
        trigger_status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT DEFAULT 'import_cleaner',
        system_instructions TEXT DEFAULT '',
        custom_rules TEXT DEFAULT '',
        examples TEXT DEFAULT '',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Handle dynamic column additions for older SQLite databases
const columns = ['phone', 'email', 'address', 'city', 'state', 'occupation', 'source', 'status', 'date'];
for (const col of columns) {
    try {
        db.exec(`ALTER TABLE leads ADD COLUMN ${col} TEXT;`);
    } catch (e) {
        // Column already exists or table doesn't exist yet, ignore
    }
}

module.exports = db;
