# IXCDI — apne naam se SMS bhejne ka legit setup

Aapka goal: SMS phone par `BP-IXCDIS-S` jaisa dikhe (apne brand ke naam se).
Ye possible hai, par sirf **aapke khud ke DLT-registered header** ke saath.

---

## 1. Sender ID ka structure samajh lo

Phone par jo dikhta hai, uske teen hisse hote hain:

```
BP   -   IXCDIS   -   S
│         │           │
│         │           └── category: S = service/transactional
│         │               (promotional ke liye 6 digits use hote hain)
│         └── header / sender ID — 6 alphabetic characters, aap register karte ho
└── operator + circle prefix — network khud lagata hai (BP, AD, BD, VM…)
    isko aap set nahi kar sakte, aur ye circle badalne par badal sakta hai
```

Rules jo operators enforce karte hain:
- Header **6 characters**, sirf A–Z. Digits, dash, space allowed nahi.
- Header aapke **brand / registered entity naam** se related hona chahiye.
- Doosri company ke brand naam, aur generic words (BANK, OFFER, INFO) reject hote hain.
- Header approve hone ke baad hi wahi SMS ja sakta hai — warna operator network level par block karta hai.
- Message ka **content template** bhi alag se approve karana padta hai.

## 2. IXCDI ke liye header options

| Option | Kyun | Notes |
|---|---|---|
| `IXCDIS` | brand + S | Pehla choice. Aapke "S" suffix wale idea se match karta hai |
| `IXCDIT` | brand + T | Agar `IXCDIS` kisi aur ne le rakha ho |
| `IXCDIN` | brand + N | Fallback |
| `IXCDIX` | brand + X | Last resort |

Sab uppercase hi jaate hain. Ek hi samay par ek header request karo — approve hone ke baad hi agla try karo, warna duplicate request reject ho jati hai.

## 3. Steps (order maintain karo)

1. **Entity registration** — kisi bhi operator ka DLT portal kholo (Jio, Airtel, Vi, BSNL) ya Smartping. Chahiye: PAN, GST ya incorporation certificate, authorised signatory ka details. Ek portal par register karne se sab operators par valid ho jata hai.
2. **Header request** — `IXCDIS` daalo, category "Transactional / Service" chuno (OTP, alerts, order updates ke liye). Promotional chunoge to DND numbers par SMS nahi jayega.
3. **Content template** — apna message `{#var#}` placeholders ke saath submit karo, e.g.
   `Dear {#var#}, aapka OTP {#var#} hai. Kisi ko na batayein. - IXCDI`
   Template approve hone par ek **template ID** milega.
4. **Provider account** — Fast2SMS (ya MSG91 / Kaleyra) par signup, DLT entity/header link karo, API key lo.
5. **Is folder ko chalao** — key env me daal ke server start karo, phir page kholo aur Fast2SMS mode chuno.

Timelines: entity, header aur template — har step usually kuch working days leta hai, operator ke load par depend karta hai. Ye main guarantee nahi kar sakta.

Kharcha: DLT portal par registration aam taur par free hota hai (kuch operators nominal fee lete hain — portal par confirm kar lena). SMS ka kharcha per-message hota hai, roughly ₹0.15–0.30 per transactional SMS provider aur volume ke hisaab se — current rate provider se confirm karo.

## 4. Is folder ko chalane ka tarika

```bash
# 1. Node 18+ chahiye
node -v

# 2. Key ke saath server start karo
FAST2SMS_KEY=your_api_key_here node server.js

# 3. Browser me kholo
#    http://localhost:8000/
```

Page par:
- Provider → **Fast2SMS — DLT header (India, proxy)**
- Sender ID → `IXCDIS` (ya jo approve hua ho)
- Route → **DLT**, template ID → approved ID, variables → comma separated values
- Recipient number → country code `+91`, apna number

Pehla test apne hi number par karo. `success: true` ka matlab hai Fast2SMS ne accept kiya — delivery ka final proof phone par SMS dikhna hai.

## 5. Jo nahi hoga

- Kisi aur ke naam se SMS bhejna (bank, company, koi bhi) — DLT header ownership ke bina possible nahi, aur spoofing illegal hai.
- Textbelt free key se custom sender naam — wo field sirf regulatory metadata hai, receiver ko dikhta nahi.
- Bina DLT ke custom header — Fast2SMS ka Quick route chalta hai par usme sender ID **random** hota hai.

## 6. Key safe rakhna

`FAST2SMS_KEY` sirf environment variable me rakho, kabhi `sms-console.html` me nahi.
Key leak ho jaye to Fast2SMS dashboard se regenerate kar dena.
