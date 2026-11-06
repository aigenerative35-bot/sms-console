/**
 * SMS Console — local server
 *
 * Do kaam karta hai:
 *   1. Page serve karta hai (sms-console.html / index.html)
 *   2. /api/send par do providers ko forward karta hai:
 *        - gateway  : aapke Android phone ka SMS Gateway (asli SIM se SMS jata hai)
 *        - fast2sms : Fast2SMS DLT route (header aapka registered hona chahiye)
 *
 * Chalane ka tarika:
 *   node server.js
 *   FAST2SMS_KEY=xxx node server.js        (sirf DLT mode ke liye)
 *
 * Node 18+ chahiye. Koi npm install nahi.
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8000);
const FAST2SMS_KEY = (process.env.FAST2SMS_KEY || '').trim();
const TWILIO_BASE = (process.env.TWILIO_BASE || 'https://api.twilio.com').replace(/\/+$/, '');
const FAST2SMS_BASE = (process.env.FAST2SMS_BASE || 'https://www.fast2sms.com').replace(/\/+$/, '');
const ROOT = __dirname;
const MAX_BODY = 32 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

const lastHit = new Map();
const MIN_GAP_MS = 1200;

function throttled(ip) {
  const now = Date.now();
  const prev = lastHit.get(ip) || 0;
  if (now - prev < MIN_GAP_MS) return true;
  lastHit.set(ip, now);
  if (lastHit.size > 500) lastHit.clear();
  return false;
}

function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ *
 * Provider 1: Android SMS Gateway (own SIM)
 * Cloud  : https://api.sms-gate.app/3rdparty/v1/messages
 * Local  : http://<phone-ip>:8080/message
 * ------------------------------------------------------------------ */
async function sendViaGateway(p) {
  const rawBase = String(p.gatewayUrl || '').trim().replace(/\/+$/, '');
  const user = String(p.username || '');
  const pass = String(p.password || '');
  const text = String(p.message || '').trim();
  const number = String(p.phone || '').trim();

  if (!rawBase) return { code: 400, body: { success: false, error: 'Gateway URL khali hai (e.g. http://192.168.1.5:8080).' } };
  if (!text) return { code: 400, body: { success: false, error: 'Message khali hai.' } };
  if (!/^\+\d{8,15}$/.test(number)) return { code: 400, body: { success: false, error: 'Number E.164 format me chahiye, e.g. +919876543210.' } };

  const payload = { textMessage: { text }, phoneNumbers: [number] };

  // cloud already has /3rdparty/v1 in the domain; local servers answer on /message
  const isCloud = /api\.sms-gate\.app$/i.test(rawBase);
  const candidates = isCloud
    ? ['/3rdparty/v1/messages']
    : ['/message', '/3rdparty/v1/messages'];

  const auth = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
  let lastErr = null;

  for (const suffix of candidates) {
    const url = rawBase + suffix;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });
      const txt = await r.text();
      let data;
      try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

      if (r.status === 404) { lastErr = { status: 404, url, data }; continue; }

      if (r.status === 401 || r.status === 403) {
        return { code: r.status, body: { success: false, error: 'Gateway ne credentials reject kiye — username/password check karo.', raw: data } };
      }

      const ok = r.status >= 200 && r.status < 300;
      return {
        code: ok ? 200 : r.status,
        body: {
          success: ok,
          provider: 'gateway',
          endpoint: url,
          state: data && data.state ? data.state : (ok ? 'Pending' : undefined),
          id: data && data.id ? data.id : undefined,
          error: ok ? undefined : ((data && (data.message || data.error)) || ('HTTP ' + r.status)),
          raw: data
        }
      };
    } catch (err) {
      lastErr = { status: 0, url, message: err.message };
    }
  }

  const hint = (lastErr && lastErr.status === 404)
    ? 'Gateway mil gaya par endpoint nahi — app me "Local Server" mode on hai ya nahi check karo.'
    : 'Phone tak nahi pahunch paya. Phone aur laptop ek hi Wi-Fi par hain? URL me phone ka IP sahi hai? App me server chalu hai?';

  return {
    code: 502,
    body: {
      success: false,
      error: hint,
      detail: lastErr,
      tried: candidates.map((c) => rawBase + c)
    }
  };
}

/* ------------------------------------------------------------------ *
 * Provider 2: Twilio (online route — message seedha SIM par jata hai)
 * Trial: 100 free SMS, sirf verified numbers par, template messages.
 * ------------------------------------------------------------------ */
async function sendViaTwilio(p) {
  const sid = String(p.accountSid || '').trim();
  const token = String(p.authToken || '').trim();
  const from = String(p.from || '').trim();
  const to = String(p.phone || '').trim();
  const text = String(p.message || '').trim();

  if (!/^AC[0-9a-f]{32}$/i.test(sid)) return { code: 400, body: { success: false, error: 'Account SID galat lag raha hai — Twilio console se copy karo (AC se shuru, 34 characters).' } };
  if (!token) return { code: 400, body: { success: false, error: 'Auth Token khali hai.' } };
  if (!/^\+\d{8,15}$/.test(to)) return { code: 400, body: { success: false, error: 'Recipient number E.164 format me chahiye, e.g. +919876543210.' } };
  if (!/^\+?[\dA-Za-z]{3,20}$/.test(from)) return { code: 400, body: { success: false, error: 'From number chahiye — Twilio console se trial number copy karo (+1...).' } };
  if (!text) return { code: 400, body: { success: false, error: 'Message khali hai.' } };

  const url = TWILIO_BASE + '/2010-04-01/Accounts/' + encodeURIComponent(sid) + '/Messages.json';
  const form = new URLSearchParams({ To: to, From: from, Body: text });

  let r, data;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString(),
      signal: AbortSignal.timeout(20000)
    });
    const txt = await r.text();
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  } catch (err) {
    return { code: 502, body: { success: false, error: 'Twilio tak nahi pahunch paya: ' + err.message } };
  }

  const ok = r.status >= 200 && r.status < 300;
  let err = undefined;
  if (!ok) {
    err = (data && (data.message || data.error)) || ('HTTP ' + r.status);
    if (data && data.code === 21608) err = 'Trial account: ye number verified nahi hai. Twilio console → Verified Caller IDs me apna number add karo. ' + err;
    if (data && data.code === 21610) err = 'Trial account: verified number hi allowed hai, aur wahi number recipient bhi hona chahiye.';
    if (data && data.code === 21211) err = 'Recipient number invalid hai. E.164 format check karo (+91...).';
    if (data && data.code === 21659 || (data && data.code === 21612)) err = 'India route: alphanumeric From use kar raha hai — Twilio ka +1 number daalo.';
  }

  return {
    code: ok ? 200 : r.status,
    body: {
      success: ok,
      provider: 'twilio',
      sid: data && data.sid ? data.sid : undefined,
      state: data && data.status ? data.status : undefined,
      error: err,
      raw: data
    }
  };
}

/* ------------------------------------------------------------------ *
 * Provider 3: Fast2SMS DLT
 * ------------------------------------------------------------------ */
async function sendViaFast2SMS(p) {
  const key = String(p.apiKey || '').trim() || FAST2SMS_KEY;
  if (!key) {
    return { code: 500, body: { success: false, error: 'Fast2SMS key nahi mili — page me daalo ya FAST2SMS_KEY env var set karo.' } };
  }

  const route = p.route === 'dlt' ? 'dlt' : 'q';
  const sender = String(p.sender_id || '').trim().toUpperCase();
  const numbers = String(p.numbers || '').replace(/[^\d,]/g, '');

  if (!/^[A-Z]{6}$/.test(sender)) return { code: 400, body: { success: false, error: 'sender_id 6 letters ka hona chahiye (e.g. IXCDIS).' } };
  if (!numbers) return { code: 400, body: { success: false, error: 'numbers khali hai.' } };

  const out = { route, sender_id: sender, numbers };

  if (route === 'dlt') {
    const templateId = String(p.message || '').trim();
    if (!templateId) return { code: 400, body: { success: false, error: 'DLT route ke liye template ID chahiye.' } };
    out.message = templateId;
    if (p.variables_values) out.variables_values = String(p.variables_values);
  } else {
    const text = String(p.message || '').trim();
    if (!text) return { code: 400, body: { success: false, error: 'message khali hai.' } };
    out.message = text;
    out.language = 'english';
    out.flash = 0;
  }

  let r, data;
  try {
    r = await fetch(FAST2SMS_BASE + '/dev/bulkV2', {
      method: 'POST',
      headers: { authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(out),
      signal: AbortSignal.timeout(20000)
    });
    const txt = await r.text();
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  } catch (err) {
    return { code: 502, body: { success: false, error: 'Fast2SMS tak nahi pahunch paya: ' + err.message } };
  }

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

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ip = req.socket.remoteAddress || 'unknown';

  if (url.pathname === '/api/ping') {
    return send(res, 200, {
      ok: true,
      proxy: true,
      providers: ['gateway', 'twilio', 'fast2sms'],
      fast2smsKey: !!FAST2SMS_KEY,
      version: 3
    });
  }

  /* credential check — bhejne se pehle key valid hai ya nahi */
  if (url.pathname === '/api/verify') {
    if (req.method !== 'POST') return send(res, 405, { success: false, error: 'POST only' });
    let p;
    try { p = JSON.parse(await readBody(req)); } catch { return send(res, 400, { success: false, error: 'JSON padh nahi paya' }); }

    if (p.provider === 'twilio') {
      const sid = String(p.accountSid || '').trim();
      const token = String(p.authToken || '').trim();
      if (!/^AC[0-9a-f]{32}$/i.test(sid)) return send(res, 400, { success: false, error: 'Account SID ka format galat hai (AC + 32 hex characters).' });
      if (!token) return send(res, 400, { success: false, error: 'Auth Token khali hai.' });
      try {
        const r = await fetch(TWILIO_BASE + '/2010-04-01/Accounts/' + encodeURIComponent(sid) + '.json', {
          headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64') },
          signal: AbortSignal.timeout(15000)
        });
        const d = await r.json().catch(() => ({}));
        if (r.status === 200) {
          return send(res, 200, { success: true, provider: 'twilio', account: d.friendly_name, status: d.status, type: d.type });
        }
        if (r.status === 401) return send(res, 401, { success: false, error: 'SID ya Auth Token galat hai (401). Console se dobara copy karo.' });
        return send(res, r.status, { success: false, error: (d && d.message) || ('HTTP ' + r.status) });
      } catch (err) {
        return send(res, 502, { success: false, error: 'Twilio tak nahi pahunch paya: ' + err.message });
      }
    }

    if (p.provider === 'fast2sms') {
      const key = String(p.apiKey || '').trim() || FAST2SMS_KEY;
      if (!key) return send(res, 400, { success: false, error: 'Fast2SMS API key khali hai.' });
      try {
        const r = await fetch(FAST2SMS_BASE + '/dev/wallet', { headers: { authorization: key }, signal: AbortSignal.timeout(15000) });
        const d = await r.json().catch(() => ({}));
        if (r.status === 200) return send(res, 200, { success: true, provider: 'fast2sms', wallet: d });
        return send(res, r.status, { success: false, error: 'Key reject ho gayi (HTTP ' + r.status + ').', raw: d });
      } catch (err) {
        return send(res, 502, { success: false, error: 'Fast2SMS tak nahi pahunch paya: ' + err.message });
      }
    }

    return send(res, 400, { success: false, error: 'Unknown provider: ' + p.provider });
  }

  if (url.pathname === '/api/send') {
    if (req.method !== 'POST') return send(res, 405, { success: false, error: 'POST only' });
    if (throttled(ip)) return send(res, 429, { success: false, error: 'Thoda ruko — 1.2 second ka gap rakho.' });

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (err) {
      return send(res, 400, { success: false, error: 'JSON padh nahi paya: ' + err.message });
    }

    let result;
    if (payload.provider === 'gateway') result = await sendViaGateway(payload);
    else if (payload.provider === 'twilio') result = await sendViaTwilio(payload);
    else if (payload.provider === 'fast2sms') result = await sendViaFast2SMS(payload);
    else return send(res, 400, { success: false, error: 'Unknown provider: ' + payload.provider });

    return send(res, result.code, result.body);
  }

  /* static files */
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, buf) => {
    if (err && rel === '/index.html') {
      // index.html na ho to sms-console.html serve karo
      return fs.readFile(path.join(ROOT, 'sms-console.html'), (e2, b2) => {
        if (e2) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found: ' + rel); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(b2);
      });
    }
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

function openBrowser(target) {
  if (process.env.NO_OPEN === '1') return;
  const { spawn } = require('node:child_process');
  let cmd, args;
  if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', target]; }
  else if (process.platform === 'darwin') { cmd = 'open'; args = [target]; }
  else { cmd = 'xdg-open'; args = [target]; }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch { /* optional */ }
}

server.listen(PORT, () => {
  const target = 'http://localhost:' + PORT + '/';
  console.log('SMS Console chal raha hai: ' + target);
  console.log('Fast2SMS key: ' + (FAST2SMS_KEY ? 'set hai' : 'set nahi (sirf gateway/Textbelt mode chalega)'));
  console.log('Twilio mode: Account SID + Auth Token + From number page me daalo (trial = 100 free SMS)');
  console.log('Band karne ke liye Ctrl+C dabao.');
  setTimeout(() => openBrowser(target), 400);
});
