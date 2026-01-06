const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Determine if we're running on Vercel
const isVercel = process.env.VERCEL === '1' || process.env.NOW_REGION;

// Set database path - use /tmp on Vercel for writable storage
let dbPath;
if (isVercel) {
    dbPath = '/tmp/debate_hub.db';
    console.log('Running on Vercel, using database at:', dbPath);
} else {
    dbPath = path.join(__dirname, '../debate_hub.db');
    console.log('Running locally, using database at:', dbPath);
}

// Ensure uploads directory exists (for local development)
if (!isVercel) {
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
}

// Create database connection
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err);
    } else {
        console.log('Connected to SQLite database at:', dbPath);
    }
});

// Initialize database tables
const initDatabase = () => {
    db.serialize(() => {
        // Resources table
        db.run(`CREATE TABLE IF NOT EXISTS resources (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            originalname TEXT NOT NULL,
            mimetype TEXT,
            size INTEGER,
            category TEXT,
            description TEXT,
            uploader TEXT,
            upload_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            download_count INTEGER DEFAULT 0,
            likes INTEGER DEFAULT 0
        )`);

        // Access statistics table
        db.run(`CREATE TABLE IF NOT EXISTS statistics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page TEXT NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            access_time DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Debate speeches table
        db.run(`CREATE TABLE IF NOT EXISTS speeches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            speaker TEXT NOT NULL,
            content TEXT NOT NULL,
            speech_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            debate_topic TEXT,
            duration INTEGER, -- speech duration in seconds
            likes INTEGER DEFAULT 0
        )`);

        // Debate timer state table
        db.run(`CREATE TABLE IF NOT EXISTS timer_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            is_running BOOLEAN DEFAULT 0,
            remaining_time INTEGER DEFAULT 300, -- remaining time in seconds
            total_time INTEGER DEFAULT 300, -- total time in seconds
            current_speaker TEXT,
            last_update DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Insert default timer state
        db.run(`INSERT OR IGNORE INTO timer_state (id, is_running, remaining_time, total_time) 
                VALUES (1, 0, 300, 300)`);

        // Site visit statistics table
        db.run(`CREATE TABLE IF NOT EXISTS site_stats (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            total_visits INTEGER DEFAULT 0,
            today_visits INTEGER DEFAULT 0,
            last_reset_date DATE DEFAULT CURRENT_DATE
        )`);

        // Insert default site statistics
        db.run(`INSERT OR IGNORE INTO site_stats (id) VALUES (1)`);

        console.log('Database initialized successfully');
    });
};

// Log access statistics
const logAccess = (page, ip, userAgent) => {
    const stmt = db.prepare('INSERT INTO statistics (page, ip_address, user_agent) VALUES (?, ?, ?)');
    stmt.run(page, ip, userAgent);
    stmt.finalize();

    // Update site statistics
    db.run(`UPDATE site_stats SET total_visits = total_visits + 1, today_visits = today_visits + 1 WHERE id = 1`);
};

// Get site statistics
const getSiteStats = (callback) => {
    db.get('SELECT * FROM site_stats WHERE id = 1', (err, row) => {
        if (err) {
            console.error('Error getting site stats:', err);
            callback(err, null);
        } else {
            callback(null, row);
        }
    });
};

// Get latest speeches
const getLatestSpeeches = (limit = 10, callback) => {
    db.all(`SELECT * FROM speeches ORDER BY speech_time DESC LIMIT ?`, [limit], (err, rows) => {
        if (err) {
            console.error('Error getting latest speeches:', err);
            callback(err, null);
        } else {
            callback(null, rows);
        }
    });
};

// Add new speech
const addSpeech = (speaker, content, debateTopic = 'General Debate', duration = 60, callback) => {
    const stmt = db.prepare(`INSERT INTO speeches (speaker, content, debate_topic, duration) VALUES (?, ?, ?, ?)`);
    stmt.run(speaker, content, debateTopic, duration, function(err) {
        if (err) {
            console.error('Error adding speech:', err);
            callback(err, null);
        } else {
            callback(null, { id: this.lastID });
        }
    });
    stmt.finalize();
};

// Get resource list
const getResources = (category = 'all', sort = 'newest', callback) => {
    let query = `SELECT * FROM resources`;
    const params = [];

    if (category !== 'all') {
        query += ` WHERE category = ?`;
        params.push(category);
    }

    switch (sort) {
        case 'newest':
            query += ` ORDER BY upload_time DESC`;
            break;
        case 'popular':
            query += ` ORDER BY download_count DESC`;
            break;
        case 'download':
            query += ` ORDER BY download_count DESC`;
            break;
        case 'likes':
            query += ` ORDER BY likes DESC`;
            break;
        default:
            query += ` ORDER BY upload_time DESC`;
    }

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Error getting resources:', err);
            callback(err, null);
        } else {
            callback(null, rows);
        }
    });
};

// Add resource
const addResource = (resourceData, callback) => {
    const { id, filename, originalname, mimetype, size, category, description, uploader } = resourceData;
    const stmt = db.prepare(`INSERT INTO resources (id, filename, originalname, mimetype, size, category, description, uploader) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(id, filename, originalname, mimetype, size, category, description, uploader, function(err) {
        if (err) {
            console.error('Error adding resource:', err);
            callback(err, null);
        } else {
            callback(null, { id });
        }
    });
    stmt.finalize();
};

// Update resource download count
const incrementDownloadCount = (resourceId, callback) => {
    db.run(`UPDATE resources SET download_count = download_count + 1 WHERE id = ?`, [resourceId], function(err) {
        if (err) {
            console.error('Error incrementing download count:', err);
            callback(err);
        } else {
            callback(null);
        }
    });
};

// Get timer state
const getTimerState = (callback) => {
    db.get('SELECT * FROM timer_state WHERE id = 1', (err, row) => {
        if (err) {
            console.error('Error getting timer state:', err);
            callback(err, null);
        } else {
            callback(null, row);
        }
    });
};

// Update timer state
const updateTimerState = (state, callback) => {
    const { is_running, remaining_time, total_time, current_speaker } = state;
    const stmt = db.prepare(`UPDATE timer_state SET is_running = ?, remaining_time = ?, total_time = ?, current_speaker = ?, last_update = CURRENT_TIMESTAMP WHERE id = 1`);
    stmt.run(is_running, remaining_time, total_time, current_speaker, function(err) {
        if (err) {
            console.error('Error updating timer state:', err);
            callback(err);
        } else {
            callback(null);
        }
    });
    stmt.finalize();
};

// Reset daily statistics if date has changed
const resetDailyStatsIfNeeded = () => {
    db.get('SELECT last_reset_date FROM site_stats WHERE id = 1', (err, row) => {
        if (err) return;
        const today = new Date().toISOString().split('T')[0];
        if (row.last_reset_date !== today) {
            db.run(`UPDATE site_stats SET today_visits = 0, last_reset_date = ? WHERE id = 1`, [today]);
        }
    });
};

// Initialize database
initDatabase();

// Check for daily stats reset every 5 minutes
setInterval(resetDailyStatsIfNeeded, 5 * 60 * 1000);

module.exports = {
    db,
    initDatabase,
    logAccess,
    getSiteStats,
    getLatestSpeeches,
    addSpeech,
    getResources,
    addResource,
    incrementDownloadCount,
    getTimerState,
    updateTimerState,
    resetDailyStatsIfNeeded
};
