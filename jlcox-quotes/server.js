// J.L. Cox Cranes Quotation Maker – server
// Runs on the atstudios home server. It does two jobs:
//   1. hands out the app's files (index.html, icons, the PDF maker)
//   2. keeps the saved quotes and the settings in the PostgreSQL database "jlc",
//      so they show on every phone and computer that opens jlc.atstudios.uk.
//
// Start it with:  node server.js      (the jlc-quotes service does this for you)

const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT) || 3001;
const APP_DIR = __dirname;

// Talk to PostgreSQL on this machine through its local "socket" (a private door
// that only programs on this machine can use). Linux already knows who we are,
// so no password is needed — and there's no secret to leak.
const pool = new Pool({
    host: '/var/run/postgresql',
    database: process.env.PGDATABASE || 'jlc',
    user: os.userInfo().username
});
pool.on('error', err => console.error('Database connection dropped (will reconnect):', err.message));

// Make the tables the first time the server starts. "IF NOT EXISTS" means it's safe
// to run every time: if they're already there, nothing changes.
async function setUpDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS quotes (
            id         text PRIMARY KEY,
            number     text NOT NULL DEFAULT '',
            data       jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS quotes_number_unique ON quotes (number) WHERE number <> '';
        CREATE TABLE IF NOT EXISTS settings (
            id         text PRIMARY KEY,
            data       jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
        );
    `);
}

// The only files anyone may download. Anything else (like this server.js) gets "not found".
const FILES = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
    '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
    '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
    '/icon-192.png': ['icon-192.png', 'image/png'],
    '/icon-512.png': ['icon-512.png', 'image/png'],
    '/jspdf.umd.min.js': ['jspdf.umd.min.js', 'text/javascript; charset=utf-8'],
    '/jspdf.plugin.autotable.min.js': ['jspdf.plugin.autotable.min.js', 'text/javascript; charset=utf-8']
};

async function serveFile(res, pathname) {
    const [file, type] = FILES[pathname];
    let data = await fs.readFile(path.join(APP_DIR, file));
    if (file === 'index.html') {
        // Tell the page it came from this server, so it saves quotes here
        // and not in the browser.
        data = data.toString('utf8').replace('</head>', '<script>window.JLC_SAVE_TO_SERVER = true;</script>\n</head>');
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
}

function sendJson(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(value === undefined ? '' : JSON.stringify(value));
}

// Read the JSON the page sent. Refuse anything over 2 MB (a quote is a few KB).
function readJson(req) {
    return new Promise((resolve, reject) => {
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
            return reject(Object.assign(new Error('JSON only'), { status: 415, code: 'bad_request' }));
        }
        let size = 0;
        const chunks = [];
        req.on('data', chunk => {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) {
                reject(Object.assign(new Error('Too big'), { status: 413, code: 'too_big' }));
                req.destroy();
            } else chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
                resolve(value);
            } catch (e) {
                reject(Object.assign(new Error('Bad JSON'), { status: 400, code: 'bad_request' }));
            }
        });
        req.on('error', reject);
    });
}

// ---------- The API: what the page calls to load and save ----------
//   GET    /api/quotes          → every saved quote
//   PUT    /api/quotes/<id>     → save one quote (new or changed)
//   DELETE /api/quotes/<id>     → delete one quote
//   GET    /api/settings/main   → the settings (or null if never saved)
//   PUT    /api/settings/main   → save the settings
async function handleApi(req, res, pathname) {
    if (pathname === '/api/quotes' && req.method === 'GET') {
        const { rows } = await pool.query('SELECT data FROM quotes ORDER BY updated_at');
        return sendJson(res, 200, rows.map(r => r.data));
    }

    const quoteMatch = pathname.match(/^\/api\/quotes\/([A-Za-z0-9_-]{1,64})$/);
    if (quoteMatch && req.method === 'PUT') {
        const id = quoteMatch[1];
        const quote = await readJson(req);
        quote.id = id;
        const number = typeof quote.number === 'string' ? quote.number.trim() : '';
        try {
            await pool.query(
                `INSERT INTO quotes (id, number, data, updated_at) VALUES ($1, $2, $3, now())
                 ON CONFLICT (id) DO UPDATE SET number = EXCLUDED.number, data = EXCLUDED.data, updated_at = now()`,
                [id, number, quote]
            );
        } catch (e) {
            // 23505 = "that value must be unique": another quote already has this number.
            if (e.code === '23505') return sendJson(res, 409, { code: 'number_taken' });
            throw e;
        }
        return sendJson(res, 200, { ok: true });
    }
    if (quoteMatch && req.method === 'DELETE') {
        await pool.query('DELETE FROM quotes WHERE id = $1', [quoteMatch[1]]);
        return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/settings/main' && req.method === 'GET') {
        const { rows } = await pool.query("SELECT data FROM settings WHERE id = 'main'");
        return sendJson(res, 200, rows.length ? rows[0].data : null);
    }
    if (pathname === '/api/settings/main' && req.method === 'PUT') {
        const settings = await readJson(req);
        await pool.query(
            `INSERT INTO settings (id, data, updated_at) VALUES ('main', $1, now())
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
            [settings]
        );
        return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { code: 'not_found' });
}

const server = http.createServer(async (req, res) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
        return sendJson(res, 400, { code: 'bad_request' });
    }
    try {
        if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
        if (req.method === 'GET' && FILES[pathname]) return await serveFile(res, pathname);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
    } catch (e) {
        if (e.status) return sendJson(res, e.status, { code: e.code });
        console.error(req.method, pathname, e);
        if (!res.headersSent) sendJson(res, 500, { code: 'server_error' });
    }
});

setUpDatabase()
    .then(() => {
        // 127.0.0.1 = only this machine can connect. The Cloudflare tunnel runs here
        // too, and it's the only way in from outside (with the email-code check).
        server.listen(PORT, '127.0.0.1', () => console.log(`JLC Quotes running on http://127.0.0.1:${PORT}`));
    })
    .catch(err => {
        console.error('Could not set up the database:', err.message);
        process.exit(1);
    });
