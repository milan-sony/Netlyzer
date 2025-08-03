const express = require('express');
const wifi = require('node-wifi');
const ping = require('ping');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const PDFDocument = require('pdfkit');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'network_logs.db');
const LAST_RUN_FILE = path.join(__dirname, 'last-run.txt');
const sessionStartTime = new Date();

app.use(express.static(path.join(__dirname, 'public')));
wifi.init({ iface: null });

const log = [];

// SQLite setup
const db = new sqlite3.Database(DB_FILE);
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

// Last run time handling
let lastRunTime = null;
if (fs.existsSync(LAST_RUN_FILE)) {
    try {
        const rawTime = fs.readFileSync(LAST_RUN_FILE, 'utf-8');
        lastRunTime = new Date(rawTime).toLocaleString('en-US');
        console.log(`🔁 Last execution was on: ${lastRunTime}`);
    } catch (e) {
        console.error('⚠️ Failed to read last run time:', e.message);
    }
}

function saveLastExecutionTime() {
    const timestamp = new Date().toISOString();
    fs.writeFileSync(LAST_RUN_FILE, timestamp);
}

process.on('exit', saveLastExecutionTime);
process.on('SIGINT', () => { saveLastExecutionTime(); process.exit(); });
process.on('SIGTERM', () => { saveLastExecutionTime(); process.exit(); });

function getFormattedTime() {
    return new Date().toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: true,
    });
}

function saveToDB(entry) {
    db.run(`INSERT INTO logs (time, wifi, ssid, signal, internet, ping)
            VALUES (?, ?, ?, ?, ?, ?)`, [
        entry.time, entry.wifi, entry.ssid, entry.signal, entry.internet, entry.ping
    ], err => {
        if (err) console.error('DB Insert Error:', err.message);
    });
}

function loadLastLogs(callback) {
    db.all(`SELECT * FROM logs ORDER BY id DESC LIMIT 180`, (err, rows) => {
        if (!err && rows) {
            log.length = 0;
            log.push(...rows.reverse());
        }
        callback();
    });
}

async function pollAndLog() {
    const timestamp = getFormattedTime();
    let entry = {
        time: timestamp,
        wifi: 'Disconnected',
        ssid: null,
        signal: null,
        internet: 'Not Reachable',
        ping: null
    };

    try {
        const conn = await wifi.getCurrentConnections();
        if (conn.length > 0) {
            const current = conn[0];
            entry.wifi = 'Connected';
            entry.ssid = current.ssid || 'Unknown';
            entry.signal = parseInt(current.signal_level) || null;

            try {
                const res = await ping.promise.probe('8.8.8.8', { timeout: 2 });
                if (res.alive) {
                    entry.internet = 'Reachable';
                    entry.ping = parseFloat(res.time);
                } else {
                    entry.internet = 'Not Reachable';
                }
            } catch (pingErr) {
                entry.internet = 'Ping Error';
                console.error('Ping error:', pingErr.message);
            }
        }
    } catch (wifiErr) {
        entry.wifi = 'Error';
        entry.internet = 'Unknown';
        console.error('Wi-Fi error:', wifiErr.message);
    }

    log.push(entry);
    if (log.length > 100) log.shift();
    saveToDB(entry);
}

setInterval(pollAndLog, 5000);
loadLastLogs(() => pollAndLog());

app.get('/status', (req, res) => {
    res.json(log[log.length - 1] || {});
});

app.get('/log', (req, res) => {
    res.json(log);
});

app.get('/log.pdf', (req, res) => {
    const doc = new PDFDocument();
    res.setHeader('Content-Disposition', 'attachment; filename="log-report.pdf"');
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);

    doc.fontSize(16).text('📶 Network Log Report', { align: 'center' });
    doc.moveDown();

    log.forEach(e => {
        doc.fontSize(10).text(
            `${e.time} | Wi-Fi: ${e.wifi} | SSID: ${e.ssid || '-'} | Signal: ${e.signal ?? '-'} dBm | Internet: ${e.internet} | Ping: ${e.ping ?? '-'} ms`
        );
    });

    doc.end();
});

app.get('/summary', (req, res) => {
    const total = log.length;
    const reachable = log.filter(e => e.internet === 'Reachable').length;
    const uptimePercent = ((reachable / total) * 100).toFixed(2);

    let longestDown = 0;
    let currentDown = 0;
    for (const e of log) {
        if (e.internet !== 'Reachable') {
            currentDown++;
            longestDown = Math.max(longestDown, currentDown);
        } else {
            currentDown = 0;
        }
    }

    const signalValues = log.map(e => e.signal).filter(v => typeof v === 'number');
    const avgSignal = signalValues.length
        ? (signalValues.reduce((a, b) => a + b) / signalValues.length).toFixed(2)
        : null;

    const pingValues = log.map(e => e.ping).filter(v => typeof v === 'number');
    const avgPing = pingValues.length
        ? (pingValues.reduce((a, b) => a + b) / pingValues.length).toFixed(2)
        : null;

    res.json({
        uptimePercent,
        longestDisconnect: longestDown * 5,
        averageSignal: avgSignal,
        averagePing: avgPing
    });
});

app.get('/last-run', (req, res) => {
    res.json({ lastRunTime });
});

app.get('/session-info', (req, res) => {
    res.json({
        sessionStart: sessionStartTime.toLocaleString('en-US'),
        currentTime: new Date().toLocaleString('en-US')
    });
});

app.get('/download-db', (req, res) => {
    res.download(DB_FILE, 'network_logs.db', err => {
        if (err) {
            console.error('Download error:', err.message);
            res.status(500).send('Error downloading DB');
        }
    });
});

app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});
