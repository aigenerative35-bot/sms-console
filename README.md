# SMS Console

Single-file SMS sender UI — HTML + CSS + JavaScript, no framework, no build step.

## Quick start (local)

```bash
node server.js          # or double-click start.bat (Windows) / ./start.sh
```

Browser khud `http://localhost:8000/` par khul jayega.

`node` na ho to `python3 -m http.server 8000` bhi chalega, phir
`http://localhost:8000/sms-console.html` kholo.

## Providers

| Mode | Kya chahiye | Sender name |
|---|---|---|
| Textbelt free key | kuch nahi | Textbelt route (custom naam nahi) |
| Textbelt own key | paid key | Textbelt route |
| Own SIM gateway | Android phone + app | aapka asli number |
| Fast2SMS DLT | DLT-registered header + API key (proxy) | aapka header, e.g. `BP-IXCDIS-S` |

Textbelt free key se din me **1 SMS** jata hai, IP-based. Message mein link
nahi hona chahiye — Textbelt URLs default block karta hai.

## Files

- `index.html` / `sms-console.html` — the console (identical)
- `server.js` — dependency-free Node proxy; holds the Fast2SMS key in env
- `start.bat`, `start.sh` — one-click launchers
- `DLT-setup-IXCDI.md` — sender ID / DLT registration steps

## Security

API keys kabhi HTML mein na rakho. `FAST2SMS_KEY` environment variable se do:

```bash
FAST2SMS_KEY=your_key node server.js
```

Static-only hosting (GitHub Pages) par sirf Textbelt mode chalega, kyunki
usme koi secret key nahi hoti.

## Limits

`success: true` ka matlab hai provider ne accept kiya — delivery ka final
proof phone par SMS dikhna hai. Bulk/OTP traffic ke liye India mein DLT
registration zaroori hai.
