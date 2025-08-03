const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./network_logs.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT,
    wifi TEXT,
    ssid TEXT,
    signal INTEGER,
    internet TEXT,
    ping REAL
)`);
});

module.exports = db;
