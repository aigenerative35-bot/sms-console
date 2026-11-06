# Online route se SIM par SMS — kya kaam karta hai

Aapka goal: message **online API ke through** jaye aur aapke mobile (SIM) par aaye.
Textbelt free key India me reliable nahi hai, isliye neeche do raaste hain jo actually deliver karte hain.

---

## Option A — Twilio trial (free, 100 SMS, sabse pehle ye try karo)

Twilio ka trial account **bina credit card** banta hai: 30 din, 100 free SMS units [cite:1049d138].
India ke liye international route use hota hai, isliye **DLT ki zarurat nahi** padti — par sender ID
aapka naam nahi hoga, receiver ke phone par random short code dikhega [cite:f0552a9a].

Steps:

1. https://www.twilio.com/try-twilio par account banao (email + phone verification).
2. Console ke home page se **Account SID** aur **Auth Token** copy karo.
3. **Phone Numbers → Buy a number** — trial me ek free Twilio number milta hai (usually +1 US).
   Wahi number "From" field me jayega.
4. **Phone Numbers → Verified Caller IDs** me **apna Indian number add karo** aur OTP se verify karo.
   Trial me sirf verified numbers par SMS ja sakta hai — ye step skip karoge to error 21608 aayega.
5. `start.bat` (Windows) ya `./start.sh` chalao, browser khulega.
6. Page me **Advanced → Provider → Twilio**, SID / Token / From daalo, apna number aur message likho, Send.

Trial ki limits jo pehle se pata honi chahiye:

- Sirf **verified numbers** par bhej sakte ho (max 5 numbers).
- Trial accounts par kabhi-kabhi custom message body ki jagah **pre-approved templates** use karne padte hain —
  Console → Messaging → Templates section check kar lo. Agar body reject ho to template se bhejo.
- 30 din baad trial expire ho jata hai.

## Option B — Fast2SMS Quick SMS (India-native, paid par DLT nahi)

Fast2SMS ka **Quick SMS** route (`route=q`) DLT entity, sender ID aur template approval ke **bina** chalta hai,
aur DND + non-DND dono numbers par deliver hota hai [cite:ac366f19]. Ye international gateway se jata hai.

- Quick SMS unlock karne ke liye ek baar **₹100 recharge** karna padta hai, phir per SMS charge hota hai
  (approx ₹7/SMS — current rate panel par confirm karo) [cite:ac366f19].
- Sender ID aapka nahi hoga, random hota hai.
- Setup: fast2sms.com par signup → API key copy → `server.js` ko key ke saath chalao:

```bash
FAST2SMS_KEY=your_key node server.js
```

Phir page me Provider → Fast2SMS, Route → **Quick SMS**.

## Jo kaam nahi karta

- **Textbelt free key** India me: request accept hoti hai (`success: true`) par zyadatar SMS deliver nahi hote.
  Delivery status `https://textbelt.com/status/<textId>` par `FAILED` ya `SENT` milega.
- **Kisi aur ke naam se** SMS bhejna — DLT header ownership ke bina possible nahi, aur spoofing illegal hai.
- **Bina recharge** Fast2SMS Quick SMS — ₹100 recharge ke baad hi route active hota hai.

## Ek line me

Free chahiye → **Twilio trial** (100 SMS, verified number par).
India-native aur apna header chahiye → **DLT + Fast2SMS DLT route** (paid, registration zaroori).
Bilkul free unlimited → **apne phone ki SIM ka gateway** (`server.js` + android-sms-gateway app).
