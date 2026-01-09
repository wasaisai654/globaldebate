const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// 确保uploads目录存在
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// 创建数据库连接
const db = new sqlite3.Database(path.join(__dirname, '../debate_hub.db'));

// 初始化数据库表
const initDatabase = () => {
    db.serialize(() => {
        // 资源表
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

        // 访问统计表
        db.run(`CREATE TABLE IF NOT EXISTS statistics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page TEXT NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            access_time DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 辩论发言表
        db.run(`CREATE TABLE IF NOT EXISTS speeches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            speaker TEXT NOT NULL,
            content TEXT NOT NULL,
            speech_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            debate_topic TEXT,
            duration INTEGER, -- 发言时长（秒）
            likes INTEGER DEFAULT 0
        )`);

        // 辩论计时器状态表
        db.run(`CREATE TABLE IF NOT EXISTS timer_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            is_running BOOLEAN DEFAULT 0,
            remaining_time INTEGER DEFAULT 300, -- 剩余时间（秒）
            total_time INTEGER DEFAULT 300, -- 总时间（秒）
            current_speaker TEXT,
            last_update DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 插入默认计时器状态
        db.run(`INSERT OR IGNORE INTO timer_state (id, is_running, remaining_time, total_time) 
                VALUES (1, 0, 300, 300)`);

        // 网站访问统计表
        db.run(`CREATE TABLE IF NOT EXISTS site_stats (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            total_visits INTEGER DEFAULT 0,
            today_visits INTEGER DEFAULT 0,
            last_reset_date DATE DEFAULT CURRENT_DATE
        )`);

        // 插入默认网站统计
        db.run(`INSERT OR IGNORE INTO site_stats (id) VALUES (1)`);

        console.log('Database initialized successfully');
    });
};

// 记录访问统计
const logAccess = (page, ip, userAgent) => {
    const stmt = db.prepare('INSERT INTO statistics (page, ip_address, user_agent) VALUES (?, ?, ?)');
    stmt.run(page, ip, userAgent);
    stmt.finalize();

    // 更新网站统计
    db.run(`UPDATE site_stats SET total_visits = total_visits + 1, today_visits = today_visits + 1 WHERE id = 1`);
};

// 获取网站统计
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

// 获取最新发言
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

// 添加新发言
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

// 获取资源列表
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

// 添加资源
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

// 更新资源下载次数
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

// 获取计时器状态
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

// 更新计时器状态
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

// 重置每日访问统计（如果日期变化）
const resetDailyStatsIfNeeded = () => {
    db.get('SELECT last_reset_date FROM site_stats WHERE id = 1', (err, row) => {
        if (err) return;
        const today = new Date().toISOString().split('T')[0];
        if (row.last_reset_date !== today) {
            db.run(`UPDATE site_stats SET today_visits = 0, last_reset_date = ? WHERE id = 1`, [today]);
        }
    });
};

// 初始化数据库
initDatabase();

// 每5分钟检查是否需要重置每日统计
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