/**
 * SMS Console proxy — dependency-free Node.js server.
 *
 * Why this exists: SMS API keys must never sit in browser JavaScript.
 * This server holds the key, serves the HTML page, and forwards
 * /api/send to Fast2SMS.
 *
 * Run:
 *   FAST2SMS_KEY=your_key_here node server.js
 *   (optional) PORT=8000
 *
 * Then open http://localhost:8000/
 *
 * Node 18+ required (uses global fetch). No npm install needed.
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8000);
const FAST2SMS_KEY = (process.env.FAST2SMS_KEY || '').trim();
const ROOT = __dirname;
const MAX_BODY = 16 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

/* --- very small per-IP throttle so a stuck button cannot spam --- */
const lastHit = new Map();
const MIN_GAP_MS = 1500;

function throttled(ip) {
  const now = Date.now();
  const prev = lastHit.get(ip) || 0;
  if (now - prev < MIN_GAP_MS) return true;
  lastHit.set(ip, now);
  if (lastHit.size > 500) lastHit.clear();
  return false;
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* --- Fast2SMS call --- */
async function sendViaFast2SMS(payload) {
  if (!FAST2SMS_KEY) {
    return { code: 500, body: { success: false, error: 'FAST2SMS_KEY env var set nahi hai. Server restart karo key ke saath.' } };
  }

  const route = payload.route === 'dlt' ? 'dlt' : 'q';
  const sender = String(payload.sender_id || '').trim().toUpperCase();
  const numbers = String(payload.numbers || '').replace(/[^\d,]/g, '');

  if (!/^[A-Z]{6}$/.test(sender)) {
    return { code: 400, body: { success: false, error: 'sender_id 6 letters ka hona chahiye (e.g. IXCDIS).' } };
  }
  if (!numbers) {
    return { code: 400, body: { success: false, error: 'numbers khali hai.' } };
  }

  const out = { route, sender_id: sender, numbers };

  if (route === 'dlt') {
    const templateId = String(payload.message || '').trim();
    if (!templateId) {
      return { code: 400, body: { success: false, error: 'DLT route ke liye template ID chahiye.' } };
    }
    out.message = templateId;
    if (payload.variables_values) out.variables_values = String(payload.variables_values);
  } else {
    const text = String(payload.message || '').trim();
    if (!text) {
      return { code: 400, body: { success: false, error: 'message khali hai.' } };
    }
    out.message = text;
    out.language = 'english';
    out.flash = 0;
  }

  let r, data;
  try {
    r = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        authorization: FAST2SMS_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(out)
    });
    const txt = await r.text();
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  } catch (err) {
    return { code: 502, body: { success: false, error: 'Fast2SMS tak nahi pahunch paya: ' + err.message } };
  }

  // Fast2SMS returns {return: true/false, message: [...], request_id}
  const ok = r.ok && data && data.return !== false;
  return {
    code: r.status,
    body: {
      success: !!ok,
      provider: 'fast2sms',
      route,
      sender_id: sender,
      error: ok ? undefined : (Array.isArray(data && data.message) ? data.message.join('; ') : (data && data.message) || 'Fast2SMS ne request reject ki'),
      raw: data
    }
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ip = req.socket.remoteAddress || 'unknown';

  if (url.pathname === '/api/send') {
    if (req.method !== 'POST') return send(res, 405, { success: false, error: 'POST only' });
    if (throttled(ip)) return send(res, 429, { success: false, error: 'Thoda ruko — 1.5 second ka gap rakho.' });

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (err) {
      return send(res, 400, { success: false, error: 'JSON padh nahi paya: ' + err.message });
    }

    if (payload.provider === 'fast2sms') {
      const result = await sendViaFast2SMS(payload);
      return send(res, result.code, result.body);
    }
    return send(res, 400, { success: false, error: 'Unknown provider: ' + payload.provider });
  }

  /* --- static files --- */
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/sms-console.html';
  const filePath = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found: ' + rel);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
});

/* --- open the browser automatically (skip with NO_OPEN=1) --- */
function openBrowser(url) {
  if (process.env.NO_OPEN === '1') return;
  const { spawn } = require('node:child_process');
  let cmd, args;
  if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', url]; }
  else if (process.platform === 'darwin') { cmd = 'open'; args = [url]; }
  else { cmd = 'xdg-open'; args = [url]; }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch { /* browser kholna optional hai */ }
}

server.listen(PORT, () => {
  const url = 'http://localhost:' + PORT + '/';
  console.log('SMS Console chal raha hai: ' + url);
  console.log('Fast2SMS key: ' + (FAST2SMS_KEY ? 'set hai (' + FAST2SMS_KEY.slice(0, 4) + '…) ' : 'SET NAHI HAI — sirf Textbelt free mode chalega'));
  console.log('Band karne ke liye Ctrl+C dabao.');
  setTimeout(() => openBrowser(url), 400);
});
